import { describe, expect, it } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  generateRecurringForPeriod,
  occurredOnFor,
} from "@/lib/cron/gerar-recorrentes";

describe("occurredOnFor", () => {
  it("compõe a data YYYY-MM-DD a partir do período e do dia", () => {
    expect(occurredOnFor("2024-03", 7)).toBe("2024-03-07");
    expect(occurredOnFor("2024-12", 28)).toBe("2024-12-28");
  });

  it("preenche o dia com zero à esquerda", () => {
    expect(occurredOnFor("2024-01", 1)).toBe("2024-01-01");
    expect(occurredOnFor("2024-01", 9)).toBe("2024-01-09");
  });

  it("rejeita período fora do formato YYYY-MM", () => {
    expect(() => occurredOnFor("2024-3", 7)).toThrow();
    expect(() => occurredOnFor("2024/03", 7)).toThrow();
    expect(() => occurredOnFor("abc", 7)).toThrow();
  });

  it("rejeita dia do mês fora de 1..28", () => {
    expect(() => occurredOnFor("2024-03", 0)).toThrow();
    expect(() => occurredOnFor("2024-03", 29)).toThrow();
    expect(() => occurredOnFor("2024-03", 1.5)).toThrow();
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Iteração por clube e isolamento de falha (tarefa 21.10 — Req 10.2/11.1/17.6)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Validamos, sem banco, que `generateRecurringForPeriod`:
 *   - percorre todos os clubes ATIVOS (deleted_at is null);
 *   - escopa recurring_expenses/transactions por `club_id` em cada iteração
 *     (não cruza dados entre clubes);
 *   - isola a falha de um clube (um erro NÃO aborta os demais).
 */

/** Recorrência de teste de um clube. */
interface RecurringFixture {
  id: string;
  amount_cents: number;
  category_id: string;
  description: string;
  day_of_month: number;
}

/** Fixture de um clube de teste. */
interface ClubFixture {
  id: string;
  recurring: RecurringFixture[];
  /** Erro simulado ao carregar as recorrências (para testar isolamento). */
  loadError?: { message: string };
}

/** Transaction inserida, capturada para asserções de não-cruzamento. */
interface InsertedTransaction {
  club_id: string;
  recurring_id: string;
  amount_cents: number;
  kind: string;
}

/** Cliente Supabase falso para o cron de recorrentes. */
function createFakeSupabase(clubs: ClubFixture[]) {
  const inserted: InsertedTransaction[] = [];

  const client = {
    from(table: string) {
      if (table === "clubs") {
        return {
          select() {
            return {
              is() {
                return Promise.resolve({
                  data: clubs.map((c) => ({ id: c.id })),
                  error: null,
                });
              },
            };
          },
        };
      }

      if (table === "recurring_expenses") {
        let clubId: string | null = null;
        let headCount = false;
        const builder = {
          select(_cols?: unknown, opts?: { count?: string; head?: boolean }) {
            headCount = Boolean(opts?.head);
            return builder;
          },
          eq(column: string, value: string) {
            if (column === "club_id") clubId = value;
            return builder;
          },
          update() {
            // `.update(...).eq("id", ...).eq("club_id", ...)` → thenable
            return {
              eq() {
                return {
                  eq() {
                    return Promise.resolve({ error: null });
                  },
                };
              },
            };
          },
          or() {
            // Carregamento das recorrências pendentes do clube (thenable).
            return builder;
          },
          then<R>(
            onfulfilled: (value: {
              data: RecurringFixture[] | null;
              error: { message: string } | null;
              count: number | null;
            }) => R,
          ) {
            const club = clubs.find((c) => c.id === clubId);
            if (headCount) {
              // Contagem de já-geradas: nos fakes, nenhuma pré-existente.
              return Promise.resolve(onfulfilled({ data: [], error: null, count: 0 }));
            }
            if (club?.loadError) {
              return Promise.resolve(
                onfulfilled({ data: null, error: club.loadError, count: null }),
              );
            }
            return Promise.resolve(
              onfulfilled({ data: club?.recurring ?? [], error: null, count: null }),
            );
          },
        };
        return builder;
      }

      if (table === "transactions") {
        return {
          insert(payload: InsertedTransaction) {
            inserted.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }

      throw new Error(`Tabela inesperada no fake: ${table}`);
    },
  };

  return { client: client as unknown as SupabaseClient, inserted };
}

describe("generateRecurringForPeriod — iteração por clube", () => {
  it("processa todos os clubes ativos e escopa as transactions por club_id (Req 10.2/11.1)", async () => {
    const { client, inserted } = createFakeSupabase([
      {
        id: "club-A",
        recurring: [
          {
            id: "ra1",
            amount_cents: 12000,
            category_id: "cat-A",
            description: "Aluguel A",
            day_of_month: 5,
          },
        ],
      },
      {
        id: "club-B",
        recurring: [
          {
            id: "rb1",
            amount_cents: 8000,
            category_id: "cat-B",
            description: "Aluguel B",
            day_of_month: 10,
          },
          {
            id: "rb2",
            amount_cents: 3000,
            category_id: "cat-B2",
            description: "Água B",
            day_of_month: 15,
          },
        ],
      },
    ]);

    const summary = await generateRecurringForPeriod(client, "2024-03");

    expect(summary.period).toBe("2024-03");
    expect(summary.clubsProcessed).toBe(2);
    expect(summary.generated).toBe(3);
    expect(summary.clubErrors).toEqual([]);

    // Não-cruzamento: cada transaction carrega o club_id do seu clube.
    const byClub = (clubId: string) =>
      inserted.filter((t) => t.club_id === clubId).map((t) => t.recurring_id);
    expect(byClub("club-A")).toEqual(["ra1"]);
    expect(byClub("club-B").sort()).toEqual(["rb1", "rb2"]);
    // Todas são despesas.
    expect(inserted.every((t) => t.kind === "despesa")).toBe(true);
  });

  it("isola a falha de um clube: um erro não aborta os demais (Req 17.6/19.4)", async () => {
    const { client, inserted } = createFakeSupabase([
      {
        id: "club-ok1",
        recurring: [
          {
            id: "ok1-r",
            amount_cents: 5000,
            category_id: "c1",
            description: "ok1",
            day_of_month: 3,
          },
        ],
      },
      {
        id: "club-broken",
        recurring: [],
        loadError: { message: "boom ao carregar recorrentes" },
      },
      {
        id: "club-ok2",
        recurring: [
          {
            id: "ok2-r",
            amount_cents: 4000,
            category_id: "c2",
            description: "ok2",
            day_of_month: 7,
          },
        ],
      },
    ]);

    const summary = await generateRecurringForPeriod(client, "2024-03");

    expect(summary.clubsProcessed).toBe(3);
    expect(summary.generated).toBe(2);
    expect(summary.clubErrors).toHaveLength(1);
    expect(summary.clubErrors[0].clubId).toBe("club-broken");
    expect(summary.clubErrors[0].message).toContain(
      "boom ao carregar recorrentes",
    );

    const clubIds = inserted.map((t) => t.club_id);
    expect(clubIds).toContain("club-ok1");
    expect(clubIds).toContain("club-ok2");
    expect(clubIds).not.toContain("club-broken");
  });
});
