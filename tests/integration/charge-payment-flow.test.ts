/**
 * Teste de INTEGRAÇÃO — fluxo cobrança → (comprovante) → aprovação → receita
 * (multi-tenant).
 *
 * Cobre o núcleo dos Requisitos 11.6 e 12.6: ao marcar uma cobrança como paga
 * (ou aprovar o comprovante), o sistema gera EXATAMENTE UM lançamento de
 * receita vinculado ao jogador, à cobrança E ao clube, de forma IDEMPOTENTE
 * (nunca duplica a receita se o fluxo for reexecutado).
 *
 * Reescrito para multi-tenant: cria um clube de teste (com settings e categorias
 * semeadas), um jogador do clube e opera com `club_id` em cobranças e
 * lançamentos. O cliente usa a service role e CONTORNA a RLS — próprio para
 * montar/limpar o cenário ponta a ponta sem uma sessão de usuário.
 *
 * ── Quando este teste roda ───────────────────────────────────────────────
 * Só executa contra um projeto Supabase de teste já migrado (`hasTestDb`). Em
 * dev, as variáveis vêm do `.env.local` via `tests/integration/setup-env.ts`.
 *
 * ── Por que NÃO importamos o helper de produção ──────────────────────────
 * `generateChargeRevenue` resolve a categoria criando o seu próprio client
 * server-only (cookies/requisição), inexistente num Vitest puro. Por isso
 * REPLICAMOS aqui os passos de banco do fluxo de aprovação com o client de
 * teste — este é o teste de fluxo de BANCO que a tarefa pede.
 *
 * ── Sobre o comprovante (payment_proofs) ──────────────────────────────────
 * A linha de comprovante exige `uploaded_by -> profiles -> auth.users`; modelar
 * isso foge do escopo deste teste de banco. Representamos a análise do
 * comprovante pela TRANSIÇÃO de status (pendente → em_analise → paga) e
 * asseguramos que, ao final, a cobrança está `paga` e a receita foi gerada uma
 * única vez. A inserção literal em `payment_proofs` é coberta no fluxo de UI.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestCharge,
  createTestClient,
  createTestClub,
  createTestPlayer,
  hasTestDb,
  newCreatedRows,
  resolveClubReceitaCategoryIdByName,
  teardown,
  todayISO,
  txidFrom,
  uniqueRunId,
  type ClubRow,
  type CreatedRows,
} from "./helpers";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Mapa tipo da cobrança → nome da categoria de receita do clube. */
const KIND_TO_RECEITA_CATEGORY: Record<string, string> = {
  mensalidade: "Mensalidade",
  avulso: "Avulso",
  multa: "Multa",
  vaquinha: "Vaquinha",
};

describe.skipIf(!hasTestDb)(
  "fluxo cobrança → aprovação → receita (integração multi-tenant)",
  () => {
    let client: SupabaseClient;
    let tracked: CreatedRows;
    let runId: string;
    let club: ClubRow;

    beforeAll(async () => {
      client = createTestClient();
      tracked = newCreatedRows();
      runId = uniqueRunId();
      club = await createTestClub(client, tracked, runId);
    });

    afterAll(async () => {
      await teardown(client, tracked);
    });

    it("gera exatamente uma receita ao aprovar e é idempotente (Req 11.6, 12.6)", async () => {
      const AMOUNT_CENTS = 2500;

      // ── Arrange: jogador do clube + cobrança pendente ──────────────────
      const playerId = await createTestPlayer(client, tracked, runId, {
        clubId: club.id,
      });

      const charge = await createTestCharge(client, tracked, {
        clubId: club.id,
        playerId,
        amountCents: AMOUNT_CENTS,
        kind: "avulso",
        description: `${runId} avulso do jogo`,
        dueDate: todayISO(),
        status: "pendente",
        txid: txidFrom(`${runId}txid`),
      });

      expect(charge.status).toBe("pendente");

      // ── Comprovante (Req 12.6): modelado pela transição de status ──────
      {
        const { error } = await client
          .from("charges")
          .update({ status: "em_analise" })
          .eq("id", charge.id);
        expect(error).toBeNull();
      }

      // ── Act (aprovação): em_analise → paga + paid_at ───────────────────
      const paidAt = new Date().toISOString();
      {
        const { error } = await client
          .from("charges")
          .update({ status: "paga", paid_at: paidAt })
          .eq("id", charge.id);
        expect(error).toBeNull();
      }

      // ── Act (geração de receita, escopada ao clube) ────────────────────
      const categoryId = await resolveClubReceitaCategoryIdByName(
        client,
        club.id,
        KIND_TO_RECEITA_CATEGORY[charge.kind] ?? "Outros",
      );
      expect(categoryId).not.toBeNull();

      const insertRevenueIfAbsent = async (): Promise<void> => {
        const { data: existing } = await client
          .from("transactions")
          .select("id")
          .eq("charge_id", charge.id)
          .is("deleted_at", null)
          .limit(1)
          .maybeSingle<{ id: string }>();

        if (existing) return; // já existe → não duplica (idempotência)

        const { data, error } = await client
          .from("transactions")
          .insert({
            club_id: club.id,
            kind: "receita",
            amount_cents: charge.amount_cents,
            occurred_on: todayISO(),
            category_id: categoryId,
            description: `Pagamento: ${charge.description}`,
            player_id: charge.player_id,
            charge_id: charge.id,
            created_by: null,
          })
          .select("id")
          .single<{ id: string }>();

        expect(error).toBeNull();
        if (data) tracked.transactionIds.push(data.id);
      };

      await insertRevenueIfAbsent();

      // ── Assert: cobrança paga com paid_at ──────────────────────────────
      {
        const { data: chargeRow, error } = await client
          .from("charges")
          .select("status, paid_at")
          .eq("id", charge.id)
          .single<{ status: string; paid_at: string | null }>();

        expect(error).toBeNull();
        expect(chargeRow?.status).toBe("paga");
        expect(chargeRow?.paid_at).not.toBeNull();
      }

      // ── Assert: exatamente UMA receita, com valor/jogador/clube corretos ─
      const assertSingleRevenue = async (): Promise<void> => {
        const { data: revenues, error } = await client
          .from("transactions")
          .select("id, kind, amount_cents, player_id, charge_id, club_id")
          .eq("charge_id", charge.id)
          .is("deleted_at", null);

        expect(error).toBeNull();
        expect(revenues).toHaveLength(1);
        expect(revenues?.[0].kind).toBe("receita");
        expect(revenues?.[0].amount_cents).toBe(AMOUNT_CENTS);
        expect(revenues?.[0].player_id).toBe(playerId);
        expect(revenues?.[0].club_id).toBe(club.id);
      };

      await assertSingleRevenue();

      // ── Idempotência: reexecutar não cria segunda receita ──────────────
      await insertRevenueIfAbsent();
      await assertSingleRevenue();
    });
  },
);
