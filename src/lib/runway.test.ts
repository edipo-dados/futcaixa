import { describe, expect, it } from "vitest";

import { computeRunwayMonths } from "@/lib/runway";

describe("computeRunwayMonths", () => {
  it("calcula o runway no caso normal (saldo / média de despesas)", () => {
    // Média = (1000 + 2000 + 3000) / 3 = 2000; saldo 10000 → 5 meses.
    expect(computeRunwayMonths(10000, [1000, 2000, 3000])).toBe(5);
  });

  it("retorna um valor fracionário quando não é exato", () => {
    // Média = 2000; saldo 5000 → 2,5 meses.
    expect(computeRunwayMonths(5000, [1000, 2000, 3000])).toBeCloseTo(2.5, 10);
  });

  it("tira a média sobre a quantidade de meses fornecida (menos de 3)", () => {
    // Dois meses: média = (1000 + 3000) / 2 = 2000; saldo 4000 → 2 meses.
    expect(computeRunwayMonths(4000, [1000, 3000])).toBe(2);
  });

  it("retorna null quando a média é zero (divisão por zero)", () => {
    // Sem despesas no período → média 0 → runway indefinido.
    expect(computeRunwayMonths(10000, [0, 0, 0])).toBeNull();
  });

  it("retorna null quando o array de despesas está vazio", () => {
    expect(computeRunwayMonths(10000, [])).toBeNull();
  });

  it("retorna null quando a média é negativa (sem despesas efetivas)", () => {
    // Média negativa (dados atípicos) também é tratada como divisão por zero.
    expect(computeRunwayMonths(10000, [-1000, -2000, 0])).toBeNull();
  });

  it("limita a 0 quando o saldo é zero", () => {
    expect(computeRunwayMonths(0, [1000, 2000, 3000])).toBe(0);
  });

  it("limita a 0 quando o saldo é negativo (caixa no vermelho)", () => {
    // Saldo negativo renderizaria runway negativo; limitamos a 0.
    expect(computeRunwayMonths(-5000, [1000, 2000, 3000])).toBe(0);
  });

  it("funciona com um único mês de despesa", () => {
    // Média = 2500; saldo 5000 → 2 meses.
    expect(computeRunwayMonths(5000, [2500])).toBe(2);
  });
});
