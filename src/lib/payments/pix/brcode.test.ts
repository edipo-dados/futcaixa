import { describe, expect, it } from "vitest";

import {
  buildPixPayload,
  CITY_MAX,
  formatAmount,
  normalizeText,
  RECEIVER_NAME_MAX,
  tlv,
  truncate,
} from "@/lib/payments/pix/brcode";
import { crc16ccitt } from "@/lib/payments/pix/crc16";

/**
 * Testes unitários da montagem do BR Code / EMV estático (Requisitos 6.1, 6.2).
 */

describe("tlv", () => {
  it("formata id + tamanho (2 dígitos) + valor", () => {
    // Exemplo canônico do campo Payload Format Indicator.
    expect(tlv("00", "01")).toBe("000201");
  });

  it("preenche o tamanho com zero à esquerda para valores curtos", () => {
    // "BR" tem 2 caracteres → tamanho "02".
    expect(tlv("58", "BR")).toBe("5802BR");
  });

  it("usa o comprimento em caracteres do valor para valores longos", () => {
    const valor = "br.gov.bcb.pix"; // 14 caracteres
    expect(tlv("00", valor)).toBe(`0014${valor}`);
  });

  it("formata valor vazio como tamanho '00'", () => {
    expect(tlv("54", "")).toBe("5400");
  });
});

describe("normalizeText", () => {
  it("remove acentos e converte para maiúsculas", () => {
    expect(normalizeText("São Paulo")).toBe("SAO PAULO");
  });

  it("remove caracteres não permitidos preservando letras, dígitos e espaço", () => {
    expect(normalizeText("Futebol & Cia. 2024!")).toBe("FUTEBOL CIA 2024");
  });

  it("colapsa espaços repetidos e remove espaços nas pontas", () => {
    expect(normalizeText("  José   da   Silva  ")).toBe("JOSE DA SILVA");
  });

  it("normaliza acentuações diversas", () => {
    expect(normalizeText("Ação Coração Município")).toBe(
      "ACAO CORACAO MUNICIPIO",
    );
  });
});

describe("truncate", () => {
  it("não altera textos dentro do limite", () => {
    expect(truncate("RECEBEDOR", 25)).toBe("RECEBEDOR");
  });

  it("trunca o nome do recebedor para no máximo 25 caracteres", () => {
    const nome = normalizeText("Associação Atlética Futebol do Bairro Central");
    const truncado = truncate(nome, RECEIVER_NAME_MAX);

    expect(truncado.length).toBeLessThanOrEqual(RECEIVER_NAME_MAX);
    expect(truncado).toBe("ASSOCIACAO ATLETICA FUTEB");
  });

  it("trunca a cidade para no máximo 15 caracteres", () => {
    const cidade = normalizeText("São José dos Campos");
    const truncada = truncate(cidade, CITY_MAX);

    expect(truncada.length).toBeLessThanOrEqual(CITY_MAX);
    expect(truncada).toBe("SAO JOSE DOS CA");
  });
});

describe("formatAmount", () => {
  it("formata centavos exatos com 2 casas decimais", () => {
    expect(formatAmount(2500)).toBe("25.00");
  });

  it("formata valores com milhar sem separador de milhar", () => {
    expect(formatAmount(123456)).toBe("1234.56");
  });

  it("formata valores abaixo de um real", () => {
    expect(formatAmount(99)).toBe("0.99");
  });

  it("formata zero", () => {
    expect(formatAmount(0)).toBe("0.00");
  });
});

describe("buildPixPayload", () => {
  const base = {
    pixKey: "clube@exemplo.com",
    receiverName: "Futebol do Bairro",
    city: "São Paulo",
    amountCents: 2500,
    txid: "COB123",
  };

  it("começa com o Payload Format Indicator '000201'", () => {
    const payload = buildPixPayload(base);
    expect(payload.startsWith("000201")).toBe(true);
  });

  it("contém o GUI do Pix e a chave configurada", () => {
    const payload = buildPixPayload(base);
    expect(payload).toContain("br.gov.bcb.pix");
    expect(payload).toContain(base.pixKey);
  });

  it("contém a moeda BRL (5303986) e o país (5802BR)", () => {
    const payload = buildPixPayload(base);
    expect(payload).toContain("5303986");
    expect(payload).toContain("5802BR");
  });

  it("contém o campo de valor formatado com 2 casas (54...)", () => {
    const payload = buildPixPayload(base);
    // tlv("54", "25.00") === "540525.00"
    expect(payload).toContain("540525.00");
  });

  it("contém o nome e a cidade normalizados", () => {
    const payload = buildPixPayload(base);
    expect(payload).toContain(tlv("59", "FUTEBOL DO BAIRRO"));
    expect(payload).toContain(tlv("60", "SAO PAULO"));
  });

  it("contém o txid dentro do campo Additional Data (62 → 05)", () => {
    const payload = buildPixPayload(base);
    expect(payload).toContain(tlv("62", tlv("05", "COB123")));
  });

  it("termina com '6304' seguido de 4 caracteres hexadecimais do CRC", () => {
    const payload = buildPixPayload(base);
    expect(payload).toMatch(/6304[0-9A-F]{4}$/);
  });

  it("o CRC final confere ao recalcular sobre o payload sem os 4 últimos chars", () => {
    const payload = buildPixPayload(base);

    const semCrc = payload.slice(0, -4); // tudo até "...6304"
    const crcInformado = payload.slice(-4);

    expect(semCrc.endsWith("6304")).toBe(true);
    expect(crc16ccitt(semCrc)).toBe(crcInformado);
  });

  it("inclui a descrição no campo 26 quando informada e normalizada", () => {
    const payload = buildPixPayload({
      ...base,
      description: "Mensalidade Jan",
    });
    expect(payload).toContain(tlv("02", "MENSALIDADE JAN"));
  });

  it("muda o payload e o CRC quando o txid varia", () => {
    const payloadA = buildPixPayload({ ...base, txid: "COBAAA" });
    const payloadB = buildPixPayload({ ...base, txid: "COBBBB" });

    expect(payloadA).not.toBe(payloadB);
    // Os 4 últimos caracteres são o CRC; devem diferir.
    expect(payloadA.slice(-4)).not.toBe(payloadB.slice(-4));
  });
});
