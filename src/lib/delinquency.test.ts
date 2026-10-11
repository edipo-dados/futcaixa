import { describe, expect, it } from "vitest";

import {
  aggregateDelinquents,
  type OverdueCharge,
} from "@/lib/delinquency";

/** Helper para montar uma cobrança atrasada com defaults enxutos. */
function charge(overrides: Partial<OverdueCharge> = {}): OverdueCharge {
  return {
    playerId: "p1",
    playerName: "Alice",
    playerNickname: null,
    amountCents: 1000,
    dueDate: "2024-01-10",
    period: null,
    ...overrides,
  };
}

describe("aggregateDelinquents", () => {
  it("retorna lista vazia quando não há cobranças", () => {
    expect(aggregateDelinquents([])).toEqual([]);
  });

  it("agrupa cobranças por jogador", () => {
    const rows = aggregateDelinquents([
      charge({ playerId: "p1", playerName: "Alice" }),
      charge({ playerId: "p1", playerName: "Alice" }),
      charge({ playerId: "p2", playerName: "Bruno" }),
    ]);

    expect(rows).toHaveLength(2);
    const alice = rows.find((r) => r.playerId === "p1");
    const bruno = rows.find((r) => r.playerId === "p2");
    expect(alice?.chargeCount).toBe(2);
    expect(bruno?.chargeCount).toBe(1);
  });

  it("soma o total devido por jogador", () => {
    const rows = aggregateDelinquents([
      charge({ playerId: "p1", amountCents: 2500 }),
      charge({ playerId: "p1", amountCents: 1500 }),
      charge({ playerId: "p1", amountCents: 1000 }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].totalCents).toBe(5000);
  });

  it("conta como 1 mês quando duas cobranças são do mesmo período", () => {
    const rows = aggregateDelinquents([
      charge({ playerId: "p1", period: "2024-01" }),
      charge({ playerId: "p1", period: "2024-01" }),
    ]);

    expect(rows[0].monthsOverdue).toBe(1);
    expect(rows[0].chargeCount).toBe(2);
  });

  it("conta como 2 meses quando as cobranças são de períodos diferentes", () => {
    const rows = aggregateDelinquents([
      charge({ playerId: "p1", period: "2024-01" }),
      charge({ playerId: "p1", period: "2024-02" }),
    ]);

    expect(rows[0].monthsOverdue).toBe(2);
    expect(rows[0].chargeCount).toBe(2);
  });

  it("deriva o mês do dueDate quando não há period", () => {
    const rows = aggregateDelinquents([
      charge({ playerId: "p1", period: null, dueDate: "2024-03-05" }),
      charge({ playerId: "p1", period: null, dueDate: "2024-03-20" }),
      charge({ playerId: "p1", period: null, dueDate: "2024-04-01" }),
    ]);

    // Mar/Mar/Abr → 2 meses distintos, 3 cobranças.
    expect(rows[0].monthsOverdue).toBe(2);
    expect(rows[0].chargeCount).toBe(3);
  });

  it("combina period e dueDate ao contar meses distintos", () => {
    const rows = aggregateDelinquents([
      charge({ playerId: "p1", period: "2024-01" }),
      charge({ playerId: "p1", period: null, dueDate: "2024-01-25" }),
      charge({ playerId: "p1", period: null, dueDate: "2024-02-10" }),
    ]);

    // 2024-01 (period) + 2024-01 (dueDate) → mesmo mês; 2024-02 → outro.
    expect(rows[0].monthsOverdue).toBe(2);
    expect(rows[0].chargeCount).toBe(3);
  });

  it("ordena por total devido em ordem decrescente", () => {
    const rows = aggregateDelinquents([
      charge({ playerId: "p1", playerName: "Alice", amountCents: 1000 }),
      charge({ playerId: "p2", playerName: "Bruno", amountCents: 5000 }),
      charge({ playerId: "p3", playerName: "Carla", amountCents: 3000 }),
    ]);

    expect(rows.map((r) => r.playerId)).toEqual(["p2", "p3", "p1"]);
  });

  it("desempata por nome quando o total é igual", () => {
    const rows = aggregateDelinquents([
      charge({ playerId: "p2", playerName: "Bruno", amountCents: 2000 }),
      charge({ playerId: "p1", playerName: "Alice", amountCents: 2000 }),
    ]);

    expect(rows.map((r) => r.playerName)).toEqual(["Alice", "Bruno"]);
  });

  it("preserva o apelido (ou null) do jogador", () => {
    const rows = aggregateDelinquents([
      charge({ playerId: "p1", playerNickname: "Ali" }),
      charge({ playerId: "p2", playerNickname: undefined }),
    ]);

    expect(rows.find((r) => r.playerId === "p1")?.playerNickname).toBe("Ali");
    expect(rows.find((r) => r.playerId === "p2")?.playerNickname).toBeNull();
  });
});
