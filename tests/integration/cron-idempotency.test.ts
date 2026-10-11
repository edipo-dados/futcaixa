/**
 * Teste de INTEGRAÇÃO — idempotência dos crons (mensalidades e recorrentes),
 * multi-tenant.
 *
 * Cobre os Requisitos:
 *   - 11.2: se a geração mensal já criou a cobrança do jogador no período, não
 *     duplica (idempotência por `club_id` + jogador + período, via índice único
 *     parcial).
 *   - 10.3: rodar a geração de recorrentes mais de uma vez no mesmo período NÃO
 *     duplica o lançamento (idempotência via `last_generated_period`).
 *
 * As funções do cron (`generateMensalidadesForPeriod` e
 * `generateRecurringForPeriod`) iteram por TODOS os clubes ativos e operam
 * sobre o cliente Supabase recebido por parâmetro — não criam cliente próprio.
 * Por isso são chamadas aqui com o cliente service-role de teste (contorna a
 * RLS). Elas importam `server-only`, resolvido para um stub (vitest.config.ts).
 *
 * Multi-tenant: criamos um CLUBE de teste ATIVO (com `settings`, necessárias
 * para a geração de mensalidades) e jogadores/recorrências COM `club_id`. As
 * asserções validam SOMENTE os ids criados pelo teste — o cron processa todos
 * os clubes do projeto, mas nunca cruzamos dados nem assumimos o total global.
 *
 * ── Quando este teste roda ───────────────────────────────────────────────
 * Só executa contra um projeto de teste já migrado (`hasTestDb`). Em dev, as
 * variáveis vêm do `.env.local` via `tests/integration/setup-env.ts`.
 *
 * ── Isolamento ────────────────────────────────────────────────────────────
 * Usamos períodos de teste no futuro distante ("2999-01"/"2999-02") para não
 * colidir com dados de seed/reais, e um clube próprio por execução (`runId`).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateMensalidadesForPeriod } from "@/lib/cron/gerar-mensalidades";
import { generateRecurringForPeriod } from "@/lib/cron/gerar-recorrentes";

import {
  createTestClient,
  createTestClub,
  createTestPlayer,
  createTestRecurringExpense,
  hasTestDb,
  newCreatedRows,
  resolveClubCategoryId,
  teardown,
  uniqueRunId,
  type ClubRow,
  type CreatedRows,
} from "./helpers";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Período de teste no futuro distante — evita colisão com seed/dados reais. */
const MENSALIDADES_PERIOD = "2999-01";
const RECORRENTES_PERIOD = "2999-02";

describe.skipIf(!hasTestDb)(
  "idempotência dos crons (integração multi-tenant)",
  () => {
    let client: SupabaseClient;
    let tracked: CreatedRows;
    let runId: string;
    let club: ClubRow;

    beforeAll(async () => {
      client = createTestClient();
      tracked = newCreatedRows();
      runId = uniqueRunId();
      // Clube ATIVO com settings (necessárias p/ o cron de mensalidades).
      club = await createTestClub(client, tracked, runId, {
        defaultMonthlyCents: 0,
      });
    });

    afterAll(async () => {
      await teardown(client, tracked);
    });

    it("mensalidades: não duplica cobrança por clube + jogador + período (Req 11.2)", { timeout: 60_000 }, async () => {
      const CUSTOM_MONTHLY_CENTS = 7500;

      // ── Arrange: dois mensalistas ativos do clube com valor cobrável ────
      const playerIdA = await createTestPlayer(client, tracked, runId, {
        clubId: club.id,
        suffix: "mensA",
        customMonthlyCents: CUSTOM_MONTHLY_CENTS,
      });
      const playerIdB = await createTestPlayer(client, tracked, runId, {
        clubId: club.id,
        suffix: "mensB",
        customMonthlyCents: CUSTOM_MONTHLY_CENTS,
      });
      const testPlayerIds = [playerIdA, playerIdB];

      // Rastreia, para teardown, as cobranças que surgirem para nossos jogadores.
      const trackChargesForPeriod = async (): Promise<void> => {
        const { data } = await client
          .from("charges")
          .select("id")
          .in("player_id", testPlayerIds)
          .eq("period", MENSALIDADES_PERIOD);
        for (const row of (data ?? []) as { id: string }[]) {
          if (!tracked.chargeIds.includes(row.id)) {
            tracked.chargeIds.push(row.id);
          }
        }
      };

      // ── Act: primeira execução gera as cobranças dos nossos jogadores ────
      const first = await generateMensalidadesForPeriod(
        client,
        MENSALIDADES_PERIOD,
      );
      await trackChargesForPeriod();

      expect(first.period).toBe(MENSALIDADES_PERIOD);
      // Pelo menos nossos dois jogadores foram gerados (pode haver outros clubes).
      expect(first.generated).toBeGreaterThanOrEqual(testPlayerIds.length);

      const countChargesPerPlayer = async (): Promise<Map<string, number>> => {
        const { data, error } = await client
          .from("charges")
          .select("id, player_id")
          .in("player_id", testPlayerIds)
          .eq("period", MENSALIDADES_PERIOD)
          .eq("kind", "mensalidade")
          .is("deleted_at", null);

        expect(error).toBeNull();
        const counts = new Map<string, number>();
        for (const row of (data ?? []) as { player_id: string }[]) {
          counts.set(row.player_id, (counts.get(row.player_id) ?? 0) + 1);
        }
        return counts;
      };

      {
        const counts = await countChargesPerPlayer();
        for (const id of testPlayerIds) {
          expect(counts.get(id)).toBe(1);
        }
      }

      // ── Act: segunda execução no MESMO período (idempotência, Req 11.2) ──
      const second = await generateMensalidadesForPeriod(
        client,
        MENSALIDADES_PERIOD,
      );
      await trackChargesForPeriod();

      // Nossos jogadores NÃO geram segunda cobrança: caem como "skipped".
      // (Pode haver outros clubes; comparamos o delta, não o global.)
      expect(second.generated).toBeLessThanOrEqual(
        Math.max(first.generated - testPlayerIds.length, 0),
      );

      // Assert final: continua exatamente UMA cobrança por jogador de teste.
      {
        const counts = await countChargesPerPlayer();
        for (const id of testPlayerIds) {
          expect(counts.get(id)).toBe(1);
        }
      }
    });

    it("recorrentes: não duplica lançamento no mesmo período (Req 10.3)", { timeout: 60_000 }, async () => {
      const AMOUNT_CENTS = 12000;
      const DAY_OF_MONTH = 5;

      // ── Arrange: uma despesa recorrente ativa do clube, ainda não gerada ─
      const categoryId = await resolveClubCategoryId(client, club.id, "despesa");
      const recurringId = await createTestRecurringExpense(client, tracked, {
        clubId: club.id,
        amountCents: AMOUNT_CENTS,
        categoryId,
        description: `${runId} recorrente aluguel`,
        dayOfMonth: DAY_OF_MONTH,
        isActive: true,
        lastGeneratedPeriod: null,
      });

      const occurredOn = `${RECORRENTES_PERIOD}-${String(DAY_OF_MONTH).padStart(
        2,
        "0",
      )}`;

      const countTransactions = async (): Promise<number> => {
        const { data, error } = await client
          .from("transactions")
          .select("id, amount_cents, kind, occurred_on")
          .eq("recurring_id", recurringId)
          .eq("occurred_on", occurredOn)
          .is("deleted_at", null);

        expect(error).toBeNull();
        return (data ?? []).length;
      };

      const readLastGeneratedPeriod = async (): Promise<string | null> => {
        const { data, error } = await client
          .from("recurring_expenses")
          .select("last_generated_period")
          .eq("id", recurringId)
          .single<{ last_generated_period: string | null }>();

        expect(error).toBeNull();
        return data?.last_generated_period ?? null;
      };

      // ── Act: primeira execução gera exatamente um lançamento ─────────────
      await generateRecurringForPeriod(client, RECORRENTES_PERIOD);

      expect(await countTransactions()).toBe(1);
      expect(await readLastGeneratedPeriod()).toBe(RECORRENTES_PERIOD);

      {
        const { data } = await client
          .from("transactions")
          .select("amount_cents, kind, club_id")
          .eq("recurring_id", recurringId)
          .eq("occurred_on", occurredOn)
          .is("deleted_at", null)
          .single<{ amount_cents: number; kind: string; club_id: string }>();

        expect(data?.kind).toBe("despesa");
        expect(data?.amount_cents).toBe(AMOUNT_CENTS);
        expect(data?.club_id).toBe(club.id);
      }

      // ── Act: segunda execução no MESMO período (idempotência, Req 10.3) ──
      await generateRecurringForPeriod(client, RECORRENTES_PERIOD);

      expect(await countTransactions()).toBe(1);
      expect(await readLastGeneratedPeriod()).toBe(RECORRENTES_PERIOD);
    });
  },
);
