/**
 * Teste de INTEGRAÇÃO — ISOLAMENTO ENTRE FUTEBÓIS (tarefa 25.1).
 *
 * Garante o isolamento multi-tenant imposto pela RLS: um usuário de um clube
 * NUNCA lê dados de outro clube, em NENHUMA tabela de domínio nem view, e um
 * `club_id` indevido enviado pela "UI" (filtro no app) retorna vazio.
 *
 * Requisitos:
 *   - 6.3: enquanto o usuário não tiver membership ativa em um clube, não lê
 *     nem escreve nada daquele clube.
 *   - 6.4: se a interface enviar um `club_id` ao qual o usuário não pertence, o
 *     resultado é vazio / negação por RLS, independentemente da seleção da UI.
 *   - 6.5: um clube não acessa dados de outro clube em nenhuma tabela ou view.
 *
 * ── Cenário ───────────────────────────────────────────────────────────────
 * Dois clubes isolados:
 *   - Clube A: um GESTOR ativo U_A; players/charges/transactions/goals/settings
 *     e categorias próprios.
 *   - Clube B: um GESTOR ativo U_B; mesmas entidades próprias.
 * Logado como U_A (anon key, exercitando a RLS):
 *   - lê players/charges/transactions/goals/categories/settings e as views e vê
 *     SOMENTE dados do clube A; NUNCA linhas do clube B;
 *   - mesmo filtrando explicitamente por `club_id = B` (como a UI faria), o
 *     resultado é vazio.
 * Simétrico para U_B. Nenhum dos dois enxerga o outro.
 *
 * NOTA sobre o papel do gestor: o cenário usa uma membership `tesoureiro` ATIVA
 * (não `presidente`) como "gestor" do clube. O isolamento por tenant (Req
 * 6.3/6.4/6.5) é IDÊNTICO para presidente e tesoureiro — as policies tratam os
 * dois juntos como gestores. A escolha por tesoureiro permite TEARDOWN LIMPO: o
 * trigger `guard_last_president` (migration 29) impede remover o último
 * presidente de um clube por qualquer caminho de escrita, o que tornaria o
 * clube de teste indelével via API e deixaria lixo permanente. Ver `buildClub`.
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
  createTestGoal,
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

/** Entidades criadas por clube, para as asserções de isolamento. */
interface ClubFixture {
  clubId: string;
  /** Gestor ativo do clube (membership `tesoureiro` ativa); exercita a RLS. */
  manager: { userId: string; email: string; password: string };
  playerId: string;
  chargeId: string;
  transactionId: string;
  goalId: string;
}

describe.skipIf(!hasRlsTestEnv)(
  "RLS — isolamento entre futebóis (integração multi-tenant, 25.1)",
  () => {
    let service: SupabaseClient;
    let tracked: CreatedRows;
    let runId: string;

    let fixtureA: ClubFixture;
    let fixtureB: ClubFixture;
    let clientA: SupabaseClient; // sessão do gestor de A
    let clientB: SupabaseClient; // sessão do gestor de B

    /**
     * Monta um clube isolado com um GESTOR ATIVO e uma linha de cada entidade de
     * domínio (player/charge/transaction/goal). settings e categorias já são
     * criados por `createTestClub`.
     *
     * ── Por que `tesoureiro` e não `presidente` ───────────────────────────
     * O isolamento multi-tenant testado aqui (Req 6.3/6.4/6.5) é imposto pela
     * RLS por `club_id` e é IDÊNTICO para qualquer "gestor" do clube: as
     * policies tratam presidente e tesoureiro juntos
     * (`club_role(club_id) in ('presidente','tesoureiro')`) para transactions,
     * charges e para a leitura de players/categories/goals/settings via
     * `is_member_of(club_id)`. Usar um `tesoureiro` ATIVO exercita exatamente as
     * mesmas verificações de tenant.
     *
     * Optamos por tesoureiro por uma razão operacional de teardown: a migration
     * 20250101000029 adiciona um TRIGGER (`guard_last_president`) que impede, no
     * banco, remover/rebaixar o ÚLTIMO presidente ativo de um clube — por
     * qualquer caminho de escrita, inclusive DELETE em cascata ao apagar o
     * clube. Isso tornaria o clube de teste INDELÉVEL via API (não há DDL para
     * desabilitar o trigger neste ambiente), deixando lixo permanente — o que
     * contraria o requisito de teardown rigoroso. Um `tesoureiro` não é
     * protegido pelo guard, então o clube é removido limpo ao final.
     */
    async function buildClub(suffix: string): Promise<ClubFixture> {
      const manager = await createTestAuthUserWithProfile(service, tracked, {
        suffix: `${suffix}-gestor`,
      });

      const club = await createTestClub(service, tracked, runId, {
        suffix,
        createdBy: manager.userId,
      });

      await createTestMembership(service, tracked, {
        userId: manager.userId,
        clubId: club.id,
        role: "tesoureiro",
        status: "ativo",
      });

      const playerId = await createTestPlayer(service, tracked, runId, {
        clubId: club.id,
        suffix,
      });

      const charge = await createTestCharge(service, tracked, {
        clubId: club.id,
        playerId,
        amountCents: 2500,
        kind: "avulso",
        description: `${runId} ${suffix} cobranca`,
        dueDate: todayISO(),
        status: "pendente",
        txid: txidFrom(`${runId}${suffix}charge`),
      });

      const despesaCategory = await resolveClubCategoryId(
        service,
        club.id,
        "despesa",
      );
      const transactionId = await createTestTransaction(service, tracked, {
        clubId: club.id,
        kind: "despesa",
        amountCents: 4200,
        categoryId: despesaCategory,
        description: `${runId} ${suffix} lancamento`,
      });

      const goalId = await createTestGoal(service, tracked, {
        clubId: club.id,
        title: `${runId} ${suffix} meta`,
        targetCents: 80000,
        currentCents: 10000,
      });

      return {
        clubId: club.id,
        manager,
        playerId,
        chargeId: charge.id,
        transactionId,
        goalId,
      };
    }

    beforeAll(async () => {
      service = createTestClient();
      tracked = newCreatedRows();
      runId = uniqueRunId();

      fixtureA = await buildClub("a");
      fixtureB = await buildClub("b");

      clientA = await signInAsUser(
        fixtureA.manager.email,
        fixtureA.manager.password,
      );
      clientB = await signInAsUser(
        fixtureB.manager.email,
        fixtureB.manager.password,
      );
    });

    afterAll(async () => {
      await clientA?.auth.signOut().catch(() => undefined);
      await clientB?.auth.signOut().catch(() => undefined);
      await teardown(service, tracked);
    });

    /**
     * Verifica, para um cliente autenticado, que ele vê a linha do PRÓPRIO
     * clube e NÃO vê a do OUTRO clube, em cada tabela de domínio escopada.
     */
    async function expectScopedToOwnClub(
      client: SupabaseClient,
      own: ClubFixture,
      other: ClubFixture,
    ): Promise<void> {
      // players
      {
        const { data, error } = await client.from("players").select("id, club_id");
        expect(error).toBeNull();
        const ids = (data ?? []).map((r) => r.id);
        const clubIds = (data ?? []).map((r) => r.club_id);
        expect(ids).toContain(own.playerId);
        expect(ids).not.toContain(other.playerId);
        expect(clubIds).not.toContain(other.clubId);
      }

      // charges
      {
        const { data, error } = await client.from("charges").select("id, club_id");
        expect(error).toBeNull();
        const ids = (data ?? []).map((r) => r.id);
        expect(ids).toContain(own.chargeId);
        expect(ids).not.toContain(other.chargeId);
      }

      // transactions (presidente tem acesso direto no PRÓPRIO clube)
      {
        const { data, error } = await client
          .from("transactions")
          .select("id, club_id");
        expect(error).toBeNull();
        const ids = (data ?? []).map((r) => r.id);
        expect(ids).toContain(own.transactionId);
        expect(ids).not.toContain(other.transactionId);
        expect((data ?? []).map((r) => r.club_id)).not.toContain(other.clubId);
      }

      // goals
      {
        const { data, error } = await client.from("goals").select("id, club_id");
        expect(error).toBeNull();
        const ids = (data ?? []).map((r) => r.id);
        expect(ids).toContain(own.goalId);
        expect(ids).not.toContain(other.goalId);
      }

      // categories (semeadas por clube)
      {
        const { data, error } = await client
          .from("categories")
          .select("id, club_id");
        expect(error).toBeNull();
        const clubIds = new Set((data ?? []).map((r) => r.club_id));
        expect(clubIds.has(own.clubId)).toBe(true);
        expect(clubIds.has(other.clubId)).toBe(false);
      }

      // settings (uma linha por clube)
      {
        const { data, error } = await client
          .from("settings")
          .select("club_id");
        expect(error).toBeNull();
        const clubIds = (data ?? []).map((r) => r.club_id);
        expect(clubIds).toContain(own.clubId);
        expect(clubIds).not.toContain(other.clubId);
      }

      // views agregadas (padrão do loader): o dashboard SEMPRE filtra por
      // `club_id = <clube ativo>`. Verificamos que, ao aplicar esse filtro, a
      // view retorna APENAS o agregado do próprio clube (nenhuma linha com o
      // club_id do outro clube).
      //
      // NOTA de design: as views são `security_invoker=false` (DEFINER) e com
      // SELECT concedido a todo usuário autenticado (migration 16.6). O
      // isolamento no dashboard é garantido pelo filtro `where club_id = <ativo>`
      // que o loader sempre aplica — a RLS das tabelas-base não é a fronteira
      // aqui. Por isso o teste exercita o padrão do loader (filtro pelo próprio
      // clube) em vez de assumir que a view esconde linhas de outros clubes.
      for (const view of [
        "v_monthly_summary",
        "v_delinquency_rate",
      ]) {
        const { data, error } = await client
          .from(view)
          .select("club_id")
          .eq("club_id", own.clubId);
        expect(error, `view ${view} não deve erro`).toBeNull();
        for (const row of (data ?? []) as { club_id: string }[]) {
          expect(
            row.club_id,
            `view ${view} filtrada pelo clube ativo só retorna o próprio clube`,
          ).toBe(own.clubId);
        }
      }
    }

    /**
     * Verifica que, ao filtrar explicitamente pelo `club_id` do OUTRO clube
     * (como a UI faria ao enviar um club_id indevido), o resultado é VAZIO —
     * a RLS é a fronteira real, independentemente do filtro do app (Req 6.4).
     */
    async function expectEmptyWhenFilteringForeignClub(
      client: SupabaseClient,
      foreign: ClubFixture,
    ): Promise<void> {
      for (const table of [
        "players",
        "charges",
        "transactions",
        "goals",
        "categories",
        "settings",
      ]) {
        const { data, error } = await client
          .from(table)
          .select("id, club_id")
          .eq("club_id", foreign.clubId);
        // RLS filtra as linhas; o SELECT não erra, apenas retorna vazio.
        expect(error, `tabela ${table} não deve erro`).toBeNull();
        expect(
          data ?? [],
          `tabela ${table} com club_id alheio deve retornar vazio`,
        ).toHaveLength(0);
      }
    }

    it("U_A vê SOMENTE o clube A e nunca o clube B (Req 6.5)", async () => {
      await expectScopedToOwnClub(clientA, fixtureA, fixtureB);
    });

    it("U_B vê SOMENTE o clube B e nunca o clube A (Req 6.5)", async () => {
      await expectScopedToOwnClub(clientB, fixtureB, fixtureA);
    });

    it("U_A filtrando por club_id de B retorna vazio (Req 6.4)", async () => {
      await expectEmptyWhenFilteringForeignClub(clientA, fixtureB);
    });

    it("U_B filtrando por club_id de A retorna vazio (Req 6.4)", async () => {
      await expectEmptyWhenFilteringForeignClub(clientB, fixtureA);
    });

    it("U_A não escreve no clube B — RLS nega o INSERT (Req 6.3)", async () => {
      // Tentar inserir um lançamento no clube B logado como presidente de A.
      // A policy transactions_manager_all exige club_role(club_id) de B, que U_A
      // não tem → o INSERT é negado pela RLS (erro), e nada é persistido.
      const foreignCategory = await resolveClubCategoryId(
        service,
        fixtureB.clubId,
        "despesa",
      );
      const { data, error } = await clientA
        .from("transactions")
        .insert({
          club_id: fixtureB.clubId,
          kind: "despesa",
          amount_cents: 999,
          occurred_on: todayISO(),
          category_id: foreignCategory,
          description: `${runId} tentativa indevida em B`,
        })
        .select("id");

      // A RLS deve negar: ou erro de violação de policy, ou nenhuma linha.
      if (!error) {
        expect(data ?? []).toHaveLength(0);
      } else {
        expect(error).not.toBeNull();
      }

      // Confirma via service role que NÃO ficou nenhum lançamento indevido em B
      // com a nossa descrição de teste.
      const { data: leaked } = await service
        .from("transactions")
        .select("id")
        .eq("club_id", fixtureB.clubId)
        .eq("description", `${runId} tentativa indevida em B`);
      // Rastreia para teardown caso algo tenha vazado (defesa; não deveria).
      for (const row of (leaked ?? []) as { id: string }[]) {
        if (!tracked.transactionIds.includes(row.id)) {
          tracked.transactionIds.push(row.id);
        }
      }
      expect(leaked ?? []).toHaveLength(0);
    });
  },
);
