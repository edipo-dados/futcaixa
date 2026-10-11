import { describe, expect, it } from "vitest";

import { computeGoalProgress } from "@/lib/goals";

describe("computeGoalProgress", () => {
  it("calcula o percentual no caso normal", () => {
    // 500 / 800 = 62,5%.
    const result = computeGoalProgress(50000, 80000);
    expect(result.percent).toBeCloseTo(62.5, 10);
    expect(result.currentCents).toBe(50000);
    expect(result.targetCents).toBe(80000);
  });

  it("devolve exatamente 100% quando o alvo é atingido", () => {
    expect(computeGoalProgress(80000, 80000).percent).toBe(100);
  });

  it("limita a 100% quando ultrapassa o alvo", () => {
    // Arrecadou além do previsto; a barra não passa de 100%.
    expect(computeGoalProgress(120000, 80000).percent).toBe(100);
  });

  it("devolve 0% quando nada foi acumulado", () => {
    expect(computeGoalProgress(0, 80000).percent).toBe(0);
  });

  it("devolve 0% (sem dividir por zero) quando o alvo é zero", () => {
    const result = computeGoalProgress(50000, 0);
    expect(result.percent).toBe(0);
    expect(result.currentCents).toBe(50000);
    expect(result.targetCents).toBe(0);
  });

  it("devolve 0% quando o alvo é negativo (defensivo)", () => {
    expect(computeGoalProgress(50000, -100).percent).toBe(0);
  });

  it("limita a 0% quando o acumulado é negativo (defensivo)", () => {
    expect(computeGoalProgress(-50000, 80000).percent).toBe(0);
  });
});
