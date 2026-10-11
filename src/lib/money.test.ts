import { describe, expect, it } from "vitest";

import { fromCents, toCents } from "@/lib/money";

describe("toCents", () => {
  it("converte inteiros simples (reais) para centavos", () => {
    expect(toCents("25")).toBe(2500);
    expect(toCents("0")).toBe(0);
  });

  it("converte formato pt-BR com milhar e decimal", () => {
    expect(toCents("1.234,56")).toBe(123456);
    expect(toCents("1.000.000,00")).toBe(100000000);
  });

  it("converte valores com decimal por vírgula", () => {
    expect(toCents("25,00")).toBe(2500);
    expect(toCents("25,5")).toBe(2550);
    expect(toCents("0,99")).toBe(99);
  });

  it("tolera símbolo de moeda e espaços", () => {
    expect(toCents("R$ 1.234,56")).toBe(123456);
    expect(toCents(" R$25,00 ")).toBe(2500);
    expect(toCents("R$\u00a01.000,00")).toBe(100000);
  });

  it("trata ponto como decimal quando não há vírgula", () => {
    expect(toCents("25.50")).toBe(2550);
    expect(toCents("0.1")).toBe(10);
  });

  it("suporta valores negativos", () => {
    expect(toCents("-25,00")).toBe(-2500);
    expect(toCents("-1.234,56")).toBe(-123456);
  });

  it("evita erro de ponto flutuante no arredondamento", () => {
    // 0.1 + 0.2 = 0.30000000000000004 em float; aqui deve ser exato.
    expect(toCents("1,10")).toBe(110);
    expect(toCents("29,99")).toBe(2999);
  });

  it("lança erro para entrada vazia ou inválida", () => {
    expect(() => toCents("")).toThrow();
    expect(() => toCents("abc")).toThrow();
    expect(() => toCents("R$")).toThrow();
    expect(() => toCents("12,ab")).toThrow();
  });
});

describe("fromCents", () => {
  it("formata centavos em BRL (pt-BR)", () => {
    expect(fromCents(123456)).toBe("R$\u00a01.234,56");
    expect(fromCents(2500)).toBe("R$\u00a025,00");
    expect(fromCents(0)).toBe("R$\u00a00,00");
    expect(fromCents(99)).toBe("R$\u00a00,99");
  });

  it("formata valores negativos", () => {
    expect(fromCents(-2500)).toBe("-R$\u00a025,00");
  });

  it("lança erro quando o valor não é inteiro", () => {
    expect(() => fromCents(25.5)).toThrow();
  });
});

describe("toCents ↔ fromCents (ida e volta)", () => {
  it("mantém o valor em uma ida e volta", () => {
    const casos = ["25,00", "1.234,56", "0,99", "1.000.000,00"];
    for (const c of casos) {
      const cents = toCents(c);
      // fromCents produz com NBSP; reconvertendo deve bater os centavos.
      expect(toCents(fromCents(cents))).toBe(cents);
    }
  });
});
