/**
 * Teste de INTEGRAÇÃO — RLS por PAPEL dentro de um clube (multi-tenant).
 *
 * Reescrito do modelo single-tenant para o multi-tenant: o papel do usuário é
 * resolvido POR CLUBE via `memberships` (helpers `club_role`/`my_player_id`),
 * e todas as tabelas de domínio carregam `club_id`.
 *
 * Cobre, dentro de UM clube:
 *   - Req 14.9 / 6.6: "Meu extrato" mostra apenas as cobranças/pagamentos do
 *     próprio jogador — um jogador NUNCA enxerga as cobranças de outro jogador
 *     do mesmo clube (`player_id = my_player_id(club_id)`).
 *   - Req 6.3 / 14.8: os dashboards leem das VIEWS agregadas; o jogador não tem
 *     acesso direto a `transactions` (não há policy de jogador nessa tabela).
 *   - Req 6.2: RLS habilitada em todas as tabelas, com políticas por papel.
 *
 * ── Por que precisa de um cliente AUTENTICADO ─────────────────────────────
 * A RLS é avaliada no Postgres via `auth.uid()` e os helpers tenant-aware
 * (`club_role`, `my_player_id`). A service role CONTORNA a RLS, logo NÃO serve
 * para exercê-la. Montamos o cenário com a service role e exercemos a RLS com
 * um cliente anon autenticado como o jogador (`signInAsUser`).
 *
 * ── Quando este teste roda ────────────────────────────────────────────────
 * Só executa quando `hasRlsTestEnv` é verdadeiro (SUPABASE_TEST_URL +
 * SERVICE_ROLE + ANON). Em dev, essas variáveis são carregadas do `.env.local`
 * por `tests/integration/setup-env.ts`.
 *
 * ATENÇÃO: cria e apaga usuários REAIS de auth e clubes no projeto configurado.
 * O teardown remove tudo o que o teste criou.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestAuthUserWithProfile,
  createTestCharge,
  createTestClient,
  createTestClub,
  createTestMembership,
  createTestPlayer,
  createTestTransaction,
  hasRlsTestEnv,
  newCreatedRows,
  resolveClubCategoryId,
  signInAsUser,
  teardown,
  todayISO,
  txidFrom,
  uniqueRunId,
  type CreatedRows,
} from "./helpers";

import type { SupabaseClient } from "@supabase/supabase-js";

describe.skipIf(!hasRlsTestEnv)(
  "RLS por papel — jogador em um clube (integração multi-tenant)",
  () => {
    let service: SupabaseClient;
    let tracked: CreatedRows;
    let runId: string;

    // Cenário compartilhado.
    let jogadorClient: SupabaseClient;
    let chargeOwnId: string; // cobrança do próprio jogador (P1)
    let chargeOtherId: string; // cobrança de outro jogador do MESMO clube (P2)
    let transactionId: string; // lançamento do clube, invisível ao jogador

    beforeAll(async () => {
      service = createTestClient();
      tracked = newCreatedRows();
      runId = uniqueRunId();

      // ── Clube de teste + um gestor (created_by) ───────────────────────
      // Usamos um gestor `tesoureiro` ATIVO (não presidente) para permitir
      // teardown limpo: o trigger guard_last_president (migration 29) impede
      // remover o último presidente de um clube, o que tornaria o clube de
      // teste indelével via API. O papel do gestor é irrelevante para o que
      // este teste exercita (escopo do JOGADOR).
      const gestor = await createTestAuthUserWithProfile(service, tracked, {
        suffix: "gestor",
      });
      const club = await createTestClub(service, tracked, runId, {
        createdBy: gestor.userId,
      });
      await createTestMembership(service, tracked, {
        userId: gestor.userId,
        clubId: club.id,
        role: "tesoureiro",
        status: "ativo",
      });

      // ── Dois jogadores do MESMO clube ─────────────────────────────────
      const player1 = await createTestPlayer(service, tracked, runId, {
        clubId: club.id,
        suffix: "p1",
      });
      const player2 = await createTestPlayer(service, tracked, runId, {
        clubId: club.id,
        suffix: "p2",
      });

      // Usuário jogador U1 vinculado a P1 (membership ativa, role=jogador).
      const u1 = await createTestAuthUserWithProfile(service, tracked, {
        suffix: "jog",
      });
      await createTestMembership(service, tracked, {
        userId: u1.userId,
        clubId: club.id,
        role: "jogador",
        status: "ativo",
        playerId: player1,
      });

      // Cobrança própria (C1 → P1) e de terceiro (C2 → P2), mesmo clube.
      const c1 = await createTestCharge(service, tracked, {
        clubId: club.id,
        playerId: player1,
        amountCents: 2500,
        kind: "avulso",
        description: `${runId} propria (P1)`,
        dueDate: todayISO(),
        status: "pendente",
        txid: txidFrom(`${runId}c1`),
      });
      chargeOwnId = c1.id;

      const c2 = await createTestCharge(service, tracked, {
        clubId: club.id,
        playerId: player2,
        amountCents: 3600,
        kind: "avulso",
        description: `${runId} terceiro (P2)`,
        dueDate: todayISO(),
        status: "pendente",
        txid: txidFrom(`${runId}c2`),
      });
      chargeOtherId = c2.id;

      // Lançamento do clube (service role) — o jogador NÃO deve enxergá-lo.
      const categoryId = await resolveClubCategoryId(service, club.id, "despesa");
      transactionId = await createTestTransaction(service, tracked, {
        clubId: club.id,
        kind: "despesa",
        amountCents: 4200,
        categoryId,
        description: `${runId} despesa oculta ao jogador`,
      });

      // ── Autentica como o jogador U1 (anon key) ────────────────────────
      jogadorClient = await signInAsUser(u1.email, u1.password);
    });

    afterAll(async () => {
      // Encerra sessões para não vazar tokens entre execuções.
      await jogadorClient?.auth.signOut().catch(() => undefined);
      await teardown(service, tracked);
    });

    it("jogador só lê as PRÓPRIAS cobranças, nunca as de terceiros (Req 14.9)", async () => {
      const { data, error } = await jogadorClient
        .from("charges")
        .select("id, player_id, description");

      // A policy do jogador não gera erro; apenas FILTRA as linhas.
      expect(error).toBeNull();

      const ids = (data ?? []).map((row) => row.id);
      expect(ids).toContain(chargeOwnId);
      expect(ids).not.toContain(chargeOtherId);
    });

    it("jogador NÃO acessa transactions diretamente (Req 6.3/14.8)", async () => {
      const { data, error } = await jogadorClient
        .from("transactions")
        .select("id");

      // Sem policy de jogador em transactions, a RLS filtra TODAS as linhas:
      // o SELECT retorna conjunto vazio (não erro) no Supabase.
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
      const ids = (data ?? []).map((row) => row.id);
      expect(ids).not.toContain(transactionId);
    });

    it("jogador lê as views agregadas do próprio clube (Req 14.8)", async () => {
      // As views são `security_invoker=false` (definer) e liberadas a todo
      // usuário autenticado. A asserção é lenient: basta não haver erro.
      const { error } = await jogadorClient
        .from("v_monthly_summary")
        .select("*")
        .limit(1);

      expect(error).toBeNull();
    });
  },
);
