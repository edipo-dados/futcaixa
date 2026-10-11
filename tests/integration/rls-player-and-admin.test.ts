/**
 * Teste de INTEGRAÇÃO — ESCOPO DO JOGADOR e BYPASS DO system_admin (tarefa 25.2).
 *
 * Complementa a 25.1 (isolamento entre clubes do ponto de vista de um GESTOR)
 * cobrindo as duas pontas que faltavam:
 *   1. O JOGADOR comum, restrito aos PRÓPRIOS dados e aos agregados do seu
 *      clube, SEM acesso direto a `transactions` e SEM bypass de tenant.
 *   2. O system_admin, única exceção ao escopo por tenant (bypass de `club_id`),
 *      que enxerga TODOS os clubes e seus dados.
 *
 * Requisitos:
 *   - 6.6: o jogador fica restrito aos agregados do seu clube e às próprias
 *     cobranças/pagamentos (`player_id = my_player_id(club_id)`), sem acesso ao
 *     detalhe financeiro de terceiros nem acesso direto a `transactions`.
 *   - 6.7: o system_admin é a ÚNICA exceção ao escopo por tenant (bypass de
 *     `club_id`) para administrar a plataforma.
 *   - 14.8: os dashboards leem das VIEWS agregadas (o jogador lê as views do seu
 *     clube sem erro) e um jogador NUNCA acessa dados individuais de terceiros
 *     nem de outro futebol.
 *
 * ── Cenário ───────────────────────────────────────────────────────────────
 * Clube A (com PRESIDENTE):
 *   - presidente/gestor (created_by, membership presidente ativa);
 *   - jogador J1 — usuário de auth com membership `jogador` ativa, vinculada ao
 *     player P1 (memberships.player_id = P1);
 *   - um segundo player P2 (sem usuário), com uma cobrança própria.
 * Clube B (separado): um gestor ativo + player + cobrança + lançamento.
 * system_admin S: usuário com `profiles.is_system_admin = true`.
 *
 * ── Por que exige cliente AUTENTICADO ──────────────────────────────────────
 * A RLS é avaliada no Postgres via `auth.uid()` e os helpers tenant-aware
 * (`club_role`, `my_player_id`, `is_system_admin`). A service role CONTORNA a
 * RLS e NÃO serve para exercê-la. Montamos o cenário com a service role e
 * exercemos a RLS com clientes anon autenticados (`signInAsUser`): um como J1 e
 * outro como o system_admin S.
 *
 * ── TEARDOWN (clube-first) ─────────────────────────────────────────────────
 * O clube A tem um PRESIDENTE ativo. O `teardown` padrão do helper apaga as
 * memberships ANTES do clube; para um clube ATIVO com presidente isso
 * dispararia o trigger `guard_last_president` (não é possível remover o último
 * presidente de um clube ativo). A migration 20250101000030 corrigiu o guard
 * para DISPENSAR a guarda quando o próprio clube está sendo removido — ou seja,
 * apagar o CLUBE funciona em cascata mesmo com presidente ativo. Por isso, no
 * teardown deste teste, apagamos os CLUBES PRIMEIRO (cascade remove memberships,
 * players, charges, transactions, etc.) e só então chamamos o `teardown` padrão
 * para limpar o resto e os usuários de auth. Não modificamos o helper.
 *
 * ── Como roda ─────────────────────────────────────────────────────────────
 * Exige `hasRlsTestEnv` (URL + service role + anon). Em dev, essas variáveis
 * vêm do `.env.local` via `tests/integration/setup-env.ts`. Cria/apaga usuários
 * de auth e clubes REAIS no projeto; o teardown remove tudo o que criar.
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
  "RLS — escopo do jogador e bypass do system_admin (integração multi-tenant, 25.2)",
  () => {
    let service: SupabaseClient;
    let tracked: CreatedRows;
    let runId: string;

    // Clube A (com presidente) e suas entidades.
    let clubAId: string;
    let chargeOwnId: string; // cobrança do próprio jogador J1 (player P1)
    let chargeOtherId: string; // cobrança de outro player P2 do MESMO clube A
    let transactionAId: string; // lançamento do clube A (invisível ao jogador)

    // Clube B (separado) e suas entidades.
    let clubBId: string;
    let chargeBId: string;
    let transactionBId: string;

    // Clientes autenticados que exercem a RLS.
    let jogadorClient: SupabaseClient; // J1 (jogador comum do clube A)
    let adminClient: SupabaseClient; // S (system_admin, bypass de tenant)

    beforeAll(async () => {
      service = createTestClient();
      tracked = newCreatedRows();
      runId = uniqueRunId();

      // ── Clube A com PRESIDENTE ────────────────────────────────────────
      const presidente = await createTestAuthUserWithProfile(service, tracked, {
        suffix: "a-pres",
      });
      const clubA = await createTestClub(service, tracked, runId, {
        suffix: "a",
        createdBy: presidente.userId,
      });
      clubAId = clubA.id;
      await createTestMembership(service, tracked, {
        userId: presidente.userId,
        clubId: clubA.id,
        role: "presidente",
        status: "ativo",
      });

      // Dois players do MESMO clube A: P1 (vinculado a J1) e P2 (de terceiro).
      const player1 = await createTestPlayer(service, tracked, runId, {
        clubId: clubA.id,
        suffix: "a-p1",
      });
      const player2 = await createTestPlayer(service, tracked, runId, {
        clubId: clubA.id,
        suffix: "a-p2",
      });

      // Usuário jogador J1 vinculado a P1 (membership jogador/ativo).
      const j1 = await createTestAuthUserWithProfile(service, tracked, {
        suffix: "a-jog",
      });
      await createTestMembership(service, tracked, {
        userId: j1.userId,
        clubId: clubA.id,
        role: "jogador",
        status: "ativo",
        playerId: player1,
      });

      // Cobrança própria (J1 → P1) e de terceiro (P2), mesmo clube A.
      const cOwn = await createTestCharge(service, tracked, {
        clubId: clubA.id,
        playerId: player1,
        amountCents: 2500,
        kind: "avulso",
        description: `${runId} A propria (P1)`,
        dueDate: todayISO(),
        status: "pendente",
        txid: txidFrom(`${runId}aown`),
      });
      chargeOwnId = cOwn.id;

      const cOther = await createTestCharge(service, tracked, {
        clubId: clubA.id,
        playerId: player2,
        amountCents: 3600,
        kind: "avulso",
        description: `${runId} A terceiro (P2)`,
        dueDate: todayISO(),
        status: "pendente",
        txid: txidFrom(`${runId}aother`),
      });
      chargeOtherId = cOther.id;

      // Lançamento do clube A (service role) — o jogador NÃO deve enxergá-lo.
      const categoryA = await resolveClubCategoryId(service, clubA.id, "despesa");
      transactionAId = await createTestTransaction(service, tracked, {
        clubId: clubA.id,
        kind: "despesa",
        amountCents: 4200,
        categoryId: categoryA,
        description: `${runId} A despesa oculta ao jogador`,
      });

      // ── Clube B (separado) com um gestor + entidades próprias ─────────
      const gestorB = await createTestAuthUserWithProfile(service, tracked, {
        suffix: "b-gestor",
      });
      const clubB = await createTestClub(service, tracked, runId, {
        suffix: "b",
        createdBy: gestorB.userId,
      });
      clubBId = clubB.id;
      await createTestMembership(service, tracked, {
        userId: gestorB.userId,
        clubId: clubB.id,
        role: "presidente",
        status: "ativo",
      });

      const playerB = await createTestPlayer(service, tracked, runId, {
        clubId: clubB.id,
        suffix: "b-p1",
      });
      const cB = await createTestCharge(service, tracked, {
        clubId: clubB.id,
        playerId: playerB,
        amountCents: 7000,
        kind: "avulso",
        description: `${runId} B cobranca`,
        dueDate: todayISO(),
        status: "pendente",
        txid: txidFrom(`${runId}bcharge`),
      });
      chargeBId = cB.id;

      const categoryB = await resolveClubCategoryId(service, clubB.id, "despesa");
      transactionBId = await createTestTransaction(service, tracked, {
        clubId: clubB.id,
        kind: "despesa",
        amountCents: 9100,
        categoryId: categoryB,
        description: `${runId} B lancamento`,
      });

      // ── system_admin S (bypass de tenant) ─────────────────────────────
      const s = await createTestAuthUserWithProfile(service, tracked, {
        suffix: "sysadmin",
        isSystemAdmin: true,
      });

      // ── Autentica como J1 e como S (anon key, exercitando a RLS) ──────
      jogadorClient = await signInAsUser(j1.email, j1.password);
      adminClient = await signInAsUser(s.email, s.password);
    });

    afterAll(async () => {
      // Encerra sessões para não vazar tokens entre execuções.
      await jogadorClient?.auth.signOut().catch(() => undefined);
      await adminClient?.auth.signOut().catch(() => undefined);

      // TEARDOWN CLUBE-FIRST: o clube A tem presidente ativo. Apagar o CLUBE
      // antes das memberships usa o ON DELETE CASCADE e DISPENSA o guard do
      // último presidente (migration 20250101000030), removendo em cascata
      // memberships/players/charges/transactions/goals/settings/categorias. Só
      // então o teardown padrão limpa o que restou e os usuários de auth. Isso
      // garante ZERO lixo mesmo com presidente ativo, sem tocar no helper.
      const clubIds = [clubAId, clubBId].filter(Boolean) as string[];
      if (clubIds.length) {
        await service.from("clubs").delete().in("id", clubIds);
      }
      await teardown(service, tracked);
    });

    // ── 1. Jogador só lê as PRÓPRIAS cobranças ──────────────────────────
    it("J1 só lê as PRÓPRIAS cobranças (P1); nunca as de P2 nem de outro clube (Req 6.6/14.8)", async () => {
      const { data, error } = await jogadorClient
        .from("charges")
        .select("id, club_id, player_id");

      // A policy do jogador não gera erro; apenas FILTRA as linhas.
      expect(error).toBeNull();

      const ids = (data ?? []).map((row) => row.id);
      expect(ids).toContain(chargeOwnId); // própria (P1)
      expect(ids).not.toContain(chargeOtherId); // terceiro P2 do mesmo clube A
      expect(ids).not.toContain(chargeBId); // cobrança de OUTRO clube (B)

      // Nenhuma linha de outro clube escapa pelo escopo do jogador.
      const clubIds = (data ?? []).map((row) => row.club_id);
      expect(clubIds).not.toContain(clubBId);
    });

    // ── 2. Jogador SEM acesso direto a transactions; COM acesso às views ─
    it("J1 NÃO acessa transactions diretamente (retorna vazio) — Req 6.6/14.8", async () => {
      const { data, error } = await jogadorClient
        .from("transactions")
        .select("id");

      // Sem policy de jogador em transactions, a RLS filtra TODAS as linhas:
      // o SELECT retorna conjunto vazio (não erro) no Supabase.
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
      const ids = (data ?? []).map((row) => row.id);
      expect(ids).not.toContain(transactionAId);
    });

    it("J1 lê as views agregadas do próprio clube A sem erro (Req 14.8)", async () => {
      // As views são `security_invoker=false` (definer) e com SELECT liberado a
      // todo usuário autenticado. O dashboard do jogador filtra pelo clube ativo
      // (A); verificamos que a leitura filtrada funciona e NUNCA traz o clube B.
      for (const view of [
        "v_monthly_summary",
        "v_category_breakdown",
        "v_balance_history",
        "v_delinquency_rate",
      ]) {
        const { data, error } = await jogadorClient
          .from(view)
          .select("club_id")
          .eq("club_id", clubAId);
        expect(error, `view ${view} não deve erro para o jogador`).toBeNull();
        for (const row of (data ?? []) as { club_id: string }[]) {
          expect(
            row.club_id,
            `view ${view} filtrada pelo clube do jogador só retorna o próprio clube`,
          ).toBe(clubAId);
        }
      }
    });

    // ── 3. system_admin enxerga TODOS os clubes e seus dados (bypass) ────
    it("S (system_admin) enxerga os clubes A e B em `clubs` (bypass de tenant, Req 6.7)", async () => {
      const { data, error } = await adminClient
        .from("clubs")
        .select("id")
        .in("id", [clubAId, clubBId]);

      expect(error).toBeNull();
      const ids = new Set((data ?? []).map((row) => row.id));
      expect(ids.has(clubAId)).toBe(true);
      expect(ids.has(clubBId)).toBe(true);
    });

    it("S (system_admin) lê dados de AMBOS os clubes — charges e transactions (Req 6.7)", async () => {
      // charges de A e de B (incluindo a de terceiro P2 em A).
      {
        const { data, error } = await adminClient
          .from("charges")
          .select("id")
          .in("id", [chargeOwnId, chargeOtherId, chargeBId]);
        expect(error).toBeNull();
        const ids = new Set((data ?? []).map((row) => row.id));
        expect(ids.has(chargeOwnId)).toBe(true);
        expect(ids.has(chargeOtherId)).toBe(true);
        expect(ids.has(chargeBId)).toBe(true);
      }

      // transactions de A e de B (acesso direto que o jogador não tem).
      {
        const { data, error } = await adminClient
          .from("transactions")
          .select("id")
          .in("id", [transactionAId, transactionBId]);
        expect(error).toBeNull();
        const ids = new Set((data ?? []).map((row) => row.id));
        expect(ids.has(transactionAId)).toBe(true);
        expect(ids.has(transactionBId)).toBe(true);
      }
    });

    // ── 4. O jogador comum NÃO tem bypass (não vê o clube B) ─────────────
    it("J1 (jogador comum) NÃO vê o clube B nem seus dados — sem bypass (Req 6.7)", async () => {
      // `clubs`: J1 só é membro do clube A; não enxerga o clube B.
      {
        const { data, error } = await jogadorClient
          .from("clubs")
          .select("id")
          .in("id", [clubAId, clubBId]);
        expect(error).toBeNull();
        const ids = new Set((data ?? []).map((row) => row.id));
        expect(ids.has(clubAId)).toBe(true);
        expect(ids.has(clubBId)).toBe(false);
      }

      // charges do clube B: mesmo filtrando explicitamente, retorna vazio.
      {
        const { data, error } = await jogadorClient
          .from("charges")
          .select("id")
          .eq("club_id", clubBId);
        expect(error).toBeNull();
        expect(data ?? []).toHaveLength(0);
      }
    });
  },
);
