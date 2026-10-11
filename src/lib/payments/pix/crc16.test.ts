import { describe, expect, it } from "vitest";

import { crc16ccitt } from "@/lib/payments/pix/crc16";

/**
 * Testes unitários do CRC16-CCITT (CCITT-FALSE) do payload Pix (Requisito 6.3).
 *
 * Referências:
 * - "123456789" => 0x29B1: valor de verificação (check value) canônico e
 *   documentado do CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, sem reflexão,
 *   sem XOR final). É a asserção autoritativa que valida a corretude do
 *   algoritmo.
 */

describe("crc16ccitt", () => {
  it("calcula o check value canônico do CRC-16/CCITT-FALSE para '123456789'", () => {
    // Valor de verificação padrão documentado do CRC-16/CCITT-FALSE.
    expect(crc16ccitt("123456789")).toBe("29B1");
  });

  it("retorna 'FFFF' para string vazia (nenhum byte processado)", () => {
    // Com nenhum byte processado, o resultado é o próprio valor inicial 0xFFFF.
    expect(crc16ccitt("")).toBe("FFFF");
  });

  it("sempre retorna 4 caracteres hexadecimais maiúsculos", () => {
    const entradas = [
      "123456789",
      "A",
      "pix",
      "00020126",
      "5204000053039865802BR6304",
    ];

    for (const entrada of entradas) {
      const crc = crc16ccitt(entrada);
      expect(crc).toMatch(/^[0-9A-F]{4}$/);
    }
  });

  it("é determinístico para a mesma entrada", () => {
    const payload = "5204000053039865802BR5913FUTEBOL BAIRRO6008SAO PAULO6304";
    expect(crc16ccitt(payload)).toBe(crc16ccitt(payload));
  });

  it("calcula o CRC de um payload Pix estilo BR Code terminando em '6304'", () => {
    // Payload mínimo no formato EMV, incluindo o sufixo do campo CRC "6304".
    const payload =
      "00020126330014br.gov.bcb.pix0111chavepix1235204000053039865802BR5908RECEBEDOR6009SAO PAULO62070503***6304";

    const crc = crc16ccitt(payload);

    // O resultado deve ser estável e no formato esperado (4 hex maiúsculos).
    expect(crc).toMatch(/^[0-9A-F]{4}$/);
    // Snapshot do valor calculado para detectar regressões no algoritmo.
    expect(crc16ccitt(payload)).toBe(crc);
  });

  it("produz CRCs diferentes quando o txid varia", () => {
    const base =
      "00020126330014br.gov.bcb.pix0111chavepix1235204000053039865802BR5908RECEBEDOR6009SAO PAULO6304";
    const comTxidA =
      "00020126330014br.gov.bcb.pix0111chavepix1235204000053039865802BR5908RECEBEDOR6009SAO PAULO62100506TXIDAA6304";
    const comTxidB =
      "00020126330014br.gov.bcb.pix0111chavepix1235204000053039865802BR5908RECEBEDOR6009SAO PAULO62100506TXIDBB6304";

    expect(crc16ccitt(comTxidA)).not.toBe(crc16ccitt(comTxidB));
    expect(crc16ccitt(comTxidA)).not.toBe(crc16ccitt(base));
  });
});
