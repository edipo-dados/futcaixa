import { describe, expect, it } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  dueDateForPeriod,
  generateMensalidadesForPeriod,
  resolveMonthlyAmount,
} from "@/lib/cron/gerar-mensalidades";

describe("dueDateForPeriod", () => {
  it("compõe o vencimento YYYY-MM-DD dentro do próprio período", () => {
    expect(dueDateForPeriod("2024-03", 10)).toBe("2024-03-10");
    expect(dueDateForPeriod("2024-12", 28)).toBe("2024-12-28");
  });

  it("preenche o dia com zero à esquerda", () => {
    expect(dueDateForPeriod("2024-01", 1)).toBe("2024-01-01");
    expect(dueDateForPeriod("2024-01", 5)).toBe("2024-01-05");
  });

  it("rejeita período fora do formato YYYY-MM", () => {
    expect(() => dueDateForPeriod("2024-3", 10)).toThrow();
    expect(() => dueDateForPeriod("2024/03", 10)).toThrow();
    expect(() => dueDateForPeriod("abc", 10)).toThrow();
  });

  it("rejeita dia de vencimento fora de 1..28", () => {
    expect(() => dueDateForPeriod("2024-03", 0)).toThrow();
    expect(() => dueDateForPeriod("2024-03", 29)).toThrow();
    expect(() => dueDateForPeriod("2024-03", 10.5)).toThrow();
  });
});

describe("resolveMonthlyAmount", () => {
  it("usa o valor personalizado quando houver (Req 2.3)", () => {
    expect(resolveMonthlyAmount(7000, 5000)).toBe(7000);
  });

  it("aplica o valor padrão quando não há personalizado (Req 2.4)", () => {
    expect(resolveMonthlyAmount(null, 5000)).toBe(5000);
    expect(resolveMonthlyAmount(undefined, 5000)).toBe(5000);
  });

  it("prefere o personalizado mesmo quando o padrão é zero", () => {
    expect(resolveMonthlyAmount(4500, 0)).toBe(4500);
  });

  it("retorna null quando não há valor cobrável (sem personalizado, padrão <= 0)", () => {
    expect(resolveMonthlyAmount(null, 0)).toBeNull();
    expect(resolveMonthlyAmount(undefined, -100)).toBeNull();
  });

  it("retorna null quando o valor personalizado não é cobrável (<= 0)", () => {
    expect(resolveMonthlyAmount(0, 5000)).toBeNull();
    expect(resolveMonthlyAmount(-1, 5000)).toBeNull();
  });

  it("retorna null para valores não inteiros (centavos devem ser inteiros)", () => {
    expect(resolveMonthlyAmount(12.5, 5000)).toBeNull();
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Iteração por clube e isolamento de falha (tarefa 21.10 — Req 10.2/11.1/17.6)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Validamos, sem banco, que `generateMensalidadesForPeriod`:
 *   - percorre todos os clubes ATIVOS (deleted_at is null);
 *   - escopa settings/players/charges por `club_id` em cada iteração (nunca
 *     cruza dados entre clubes);
 *   - isola a falha de um clube (um erro NÃO aborta os demais).
 *
 * Para isso, montamos um cliente Supabase falso dirigido por "fixtures" por
 * clube: cada clube tem a sua settings e os seus players; as inserts de charges
 * são roteadas para o clube do payload (`club_id`), provando o não-cruzamento.
 */

/** Fixture de um clube de teste. */
interface ClubFixture {
  id: string;
  settings: { default_monthly_cents: number; due_day: number } | null;
  /** Erro simulado ao carregar settings (para testar isolamento). */
  settingsError?: { message: string };
  players: Array<{ id: string; custom_monthly_cents: number | null }>;
}

/** Charge inserida, capturada por clube para asserções de não-cruzamento. */
interface InsertedCharge {
  club_id: string;
  player_id: string;
  amount_cents: number;
}

/** Cliente Supabase falso para o cron de mensalidades. */
function createFakeSupabase(clubs: ClubFixture[]) {
  const inserted: InsertedCharge[] = [];
  const activeClubs = clubs;

  const client = {
    from(table: string) {
      if (table === "clubs") {
        return {
          select() {
            return {
              is() {
                return Promise.resolve({
                  data: activeClubs.map((c) => ({ id: c.id })),
                  error: null,
                });
              },
            };
          },
        };
      }

      if (table === "settings") {
        // `.select(...).eq("club_id", clubId).single()`
        let clubId: string | null = null;
        const builder = {
          select() {
            return builder;
          },
          eq(column: string, value: string) {
            if (column === "club_id") clubId = value;
            return builder;
          },
          single() {
            const club = activeClubs.find((c) => c.id === clubId);
            if (club?.settingsError) {
              return Promise.resolve({ data: null, error: club.settingsError });
            }
            return Promise.resolve({
              data: club?.settings ?? null,
              error: null,
            });
          },
        };
        return builder;
      }

      if (table === "players") {
        // `.select(...)` então filtros `eq`/`is`, capturando `club_id`.
        let clubId: string | null = null;
        const result = () => {
          const club = activeClubs.find((c) => c.id === clubId);
          return { data: club?.players ?? [], error: null };
        };
        const builder = {
          select() {
            return builder;
          },
          eq(column: string, value: string) {
            if (column === "club_id") clubId = value;
            return builder;
          },
          is() {
            return builder;
          },
          then<R>(onfulfilled: (value: ReturnType<typeof result>) => R) {
            return Promise.resolve(result()).then(onfulfilled);
          },
        };
        return builder;
      }

      if (table === "charges") {
        return {
          insert(payload: InsertedCharge) {
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

describe("generateMensalidadesForPeriod — iteração por clube", () => {
  it("processa todos os clubes ativos e escopa as charges por club_id (Req 10.2/11.1)", async () => {
    const { client, inserted } = createFakeSupabase([
      {
        id: "club-A",
        settings: { default_monthly_cents: 5000, due_day: 10 },
        players: [
          { id: "a1", custom_monthly_cents: null },
          { id: "a2", custom_monthly_cents: 7000 },
        ],
      },
      {
        id: "club-B",
        settings: { default_monthly_cents: 3000, due_day: 5 },
        players: [{ id: "b1", custom_monthly_cents: null }],
      },
    ]);

    const summary = await generateMensalidadesForPeriod(client, "2024-03");

    expect(summary.period).toBe("2024-03");
    expect(summary.clubsProcessed).toBe(2);
    expect(summary.generated).toBe(3);
    expect(summary.clubErrors).toEqual([]);

    // Não-cruzamento: cada charge carrega o club_id do seu clube.
    const byClub = (clubId: string) =>
      inserted.filter((c) => c.club_id === clubId).map((c) => c.player_id);
    expect(byClub("club-A").sort()).toEqual(["a1", "a2"]);
    expect(byClub("club-B")).toEqual(["b1"]);

    // E os valores respeitam a settings DAQUELE clube (padrão vs. personalizado).
    const a1 = inserted.find((c) => c.player_id === "a1");
    const a2 = inserted.find((c) => c.player_id === "a2");
    const b1 = inserted.find((c) => c.player_id === "b1");
    expect(a1?.amount_cents).toBe(5000); // padrão do clube A
    expect(a2?.amount_cents).toBe(7000); // personalizado
    expect(b1?.amount_cents).toBe(3000); // padrão do clube B
  });

  it("isola a falha de um clube: um erro não aborta os demais (Req 17.6/19.4)", async () => {
    const { client, inserted } = createFakeSupabase([
      {
        id: "club-ok1",
        settings: { default_monthly_cents: 5000, due_day: 10 },
        players: [{ id: "ok1-p", custom_monthly_cents: null }],
      },
      {
        id: "club-broken",
        settings: null,
        settingsError: { message: "boom ao ler settings" },
        players: [{ id: "broken-p", custom_monthly_cents: null }],
      },
      {
        id: "club-ok2",
        settings: { default_monthly_cents: 4000, due_day: 15 },
        players: [{ id: "ok2-p", custom_monthly_cents: null }],
      },
    ]);

    const summary = await generateMensalidadesForPeriod(client, "2024-03");

    // Todos os clubes foram visitados.
    expect(summary.clubsProcessed).toBe(3);
    // Os dois clubes saudáveis geraram normalmente.
    expect(summary.generated).toBe(2);
    // O clube com erro foi registrado, mas não derrubou a execução.
    expect(summary.clubErrors).toHaveLength(1);
    expect(summary.clubErrors[0].clubId).toBe("club-broken");
    expect(summary.clubErrors[0].message).toContain("boom ao ler settings");

    // Nenhuma charge do clube quebrado foi inserida; as dos sãos, sim.
    const clubIds = inserted.map((c) => c.club_id);
    expect(clubIds).toContain("club-ok1");
    expect(clubIds).toContain("club-ok2");
    expect(clubIds).not.toContain("club-broken");
  });
});
