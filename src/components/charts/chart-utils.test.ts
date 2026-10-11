import { describe, expect, it } from "vitest";

import {
  categoryColor,
  CATEGORY_COLORS,
  centsToReais,
  formatAxisBRL,
  formatMonthLabel,
  reaisToBRL,
} from "./chart-utils";

describe("centsToReais", () => {
  it("converte centavos (inteiro) para reais (number)", () => {
    expect(centsToReais(123456)).toBe(1234.56);
    expect(centsToReais(0)).toBe(0);
  });
});

describe("reaisToBRL", () => {
  it("formata reais em BRL", () => {
    expect(reaisToBRL(1234.56)).toBe("R$\u00a01.234,56");
  });

  it("arredonda ruído de ponto flutuante ao centavo", () => {
    // 123456 centavos → 1234.56 reais; sem o arredondamento interno,
    // 1234.56 * 100 pode cair em 1234.5600000000002.
    expect(reaisToBRL(centsToReais(123456))).toBe("R$\u00a01.234,56");
  });
});

describe("formatMonthLabel", () => {
  it("transforma YYYY-MM em MM/YYYY", () => {
    expect(formatMonthLabel("2025-03")).toBe("03/2025");
  });

  it("devolve a entrada inalterada quando não casa com o formato", () => {
    expect(formatMonthLabel("abril")).toBe("abril");
  });
});

describe("formatAxisBRL", () => {
  it("abrevia milhares com sufixo 'mil'", () => {
    expect(formatAxisBRL(1200)).toBe("R$ 1,2 mil");
  });

  it("mostra valores abaixo de mil sem abreviação", () => {
    expect(formatAxisBRL(850)).toBe("R$ 850");
  });
});

describe("categoryColor", () => {
  it("é circular sobre a paleta", () => {
    expect(categoryColor(0)).toBe(CATEGORY_COLORS[0]);
    expect(categoryColor(CATEGORY_COLORS.length)).toBe(CATEGORY_COLORS[0]);
  });
});
