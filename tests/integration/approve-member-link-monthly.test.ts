/**
 * Teste de INTEGRAÇÃO — aprovação de membro: vincular a jogador existente +
 * geração da mensalidade do mês (multi-tenant).
 *
 * Cobre a RPC `approve_member(p_membership_id, p_tipo, p_player_id)` recriada
 * na migration 20250101000032, nos dois comportamentos novos:
 *
 *   1) VINCULAR A JOGADOR JÁ CADASTRADO (ponto do presidente): quando o
 *      presidente informa `p_player_id`, a membership é vinculada a um jogador
 *      existente do clube (sem criar outro). Útil quando o jogador foi
 *      cadastrado manualmente ANTES de entrar pelo link de convite.
 *
 *   2) MENSALIDADE DO MÊS AO APROVAR: aprovar como `mensalista` (ativo, não
 *      isento) gera JÁ a cobrança de mensalidade do período corrente, status
 *      `pendente` (Req 5.1), de forma idempotente (Req 5.2). `avulso` NÃO gera.
 *
 * Também valida a guarda de duplicidade: vincular a um jogador que já está em
 * OUTRA membership falha (errcode 23505).
 *
 * ── Como o cenário é montado ──────────────────────────────────────────────
 * A autorização da RPC é por `auth.uid()` + `club_role()`, então a aprovação é
 * chamada por um cliente AUTENTICADO como presidente (`signInAsUser`). A
 * montagem/limpeza do cenário usa a service role (contorna RLS). Exige
 * `hasRlsTestEnv` (URL + service role + anon).
 *
 * ── Quando este teste roda ───────────────────────────────────────────────
 * Só executa contra um Supabase de teste já migrado (com a migration
 * 20250101000032 aplicada). Em dev, as variáveis vêm do `.env.local` via
 * `tests/integration/setup-env.ts`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestAuthUserWithProfile,
  createTestClient,
  createTestClub,
  createTestMembership,
  createTestPlayer,
  hasRlsTestEnv,
  newCreatedRows,
  signInAsUser,
  type ClubRow,
  type CreatedRows,
  teardown,
  uniqueRunId,
} from "./helpers";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Mensalidade padrão do clube de teste (centavos). */
const DEFAULT_MONTHLY_CENTS = 5000;

/** Período corrente `YYYY-MM` no fuso usado pela RPC (America/Sao_Paulo). */
function currentPeriodSaoPaulo(): string {
  // Intl garante o mesmo fuso que a RPC (now() at time zone 'America/Sao_Paulo').
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  return `${year}-${month}`;
}

/**
 * Cria um usuário "jogador" e a sua própria membership jogador/pendente no
 * clube (o INSERT que a policy memberships_insert permite). Retorna o id da
 * membership e as credenciais do usuário.
 */
async function createPendingMembership(
  service: SupabaseClient,
  tracked: CreatedRows,
  clubId: string,
  suffix: string,
): Promise<{ membershipId: string; userId: string }> {
  const user = await createTestAuthUserWithProfile(service, tracked, {
    suffix,
  });

  const asUser = await signInAsUser(user.email, user.password);
  try {
    const { data, error } = await asUser
      .from("memberships")
      .insert({
        user_id: user.userId,
        club_id: clubId,
        role: "jogador",
        status: "pendente",
      })
      .select("id")
      .single<{ id: string }>();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    tracked.membershipIds.push(data!.id);
    return { membershipId: data!.id, userId: user.userId };
  } finally {
    await asUser.auth.signOut().catch(() => undefined);
  }
}

describe.skipIf(!hasRlsTestEnv)(
  "aprovar membro: vincular a jogador existente + mensalidade do mês (integração)",
  () => {
    let service: SupabaseClient;
    let tracked: CreatedRows;
    let runId: string;
    let club: ClubRow;
    let president: { email: string; password: string; userId: string };

    beforeAll(async () => {
      service = createTestClient();
      tracked = newCreatedRows();
      runId = uniqueRunId();

      const pres = await createTestAuthUserWithProfile(service, tracked, {
        suffix: "pres",
      });
      president = pres;

      club = await createTestClub(service, tracked, runId, {
        createdBy: pres.userId,
        defaultMonthlyCents: DEFAULT_MONTHLY_CENTS,
      });

      await createTestMembership(service, tracked, {
        userId: pres.userId,
        clubId: club.id,
        role: "presidente",
        status: "ativo",
      });
    });

    afterAll(async () => {
      await teardown(service, tracked);
    });

    it(
      "vincula a membership a um jogador JÁ cadastrado e gera a mensalidade do mês (Req 4.6, 5.1)",
      { timeout: 60_000 },
      async () => {
        const period = currentPeriodSaoPaulo();

        // Jogador cadastrado MANUALMENTE pelo presidente (ainda sem membership).
        const existingPlayerId = await createTestPlayer(
          service,
          tracked,
          runId,
          { clubId: club.id, suffix: "manual", type: "avulso" },
        );

        // Esse jogador entrou pelo link → membership jogador/pendente.
        const { membershipId } = await createPendingMembership(
          service,
          tracked,
          club.id,
          "vincula",
        );

        // Presidente aprova VINCULANDO ao jogador existente, marcando como
        // mensalista (o tipo é aplicado ao jogador existente).
        const asPresident = await signInAsUser(
          president.email,
          president.password,
        );
        try {
          const { data: returnedPlayerId, error } = await asPresident.rpc(
            "approve_member",
            {
              p_membership_id: membershipId,
              p_tipo: "mensalista",
              p_player_id: existingPlayerId,
            },
          );
          expect(error).toBeNull();
          // Retorna o MESMO jogador existente (não criou outro).
          expect(returnedPlayerId).toBe(existingPlayerId);
        } finally {
          await asPresident.auth.signOut().catch(() => undefined);
        }

        // A membership ficou ativa e vinculada ao jogador existente.
        {
          const { data: m } = await service
            .from("memberships")
            .select("status, player_id")
            .eq("id", membershipId)
            .single<{ status: string; player_id: string | null }>();
          expect(m?.status).toBe("ativo");
          expect(m?.player_id).toBe(existingPlayerId);
        }

        // O jogador existente teve o tipo atualizado para mensalista.
        {
          const { data: p } = await service
            .from("players")
            .select("type")
            .eq("id", existingPlayerId)
            .single<{ type: string }>();
          expect(p?.type).toBe("mensalista");
        }

        // NÃO foi criado um segundo jogador no clube para este fluxo: só existe
        // o jogador cadastrado manualmente (verificamos pela quantidade de
        // players do clube vinculados a membership = 1 para este player).
        {
          const { data: links } = await service
            .from("memberships")
            .select("id")
            .eq("club_id", club.id)
            .eq("player_id", existingPlayerId);
          expect(links ?? []).toHaveLength(1);
        }

        // Mensalidade do mês gerada (pendente) para o jogador vinculado.
        {
          const { data: charges } = await service
            .from("charges")
            .select("id, amount_cents, kind, period, status")
            .eq("club_id", club.id)
            .eq("player_id", existingPlayerId)
            .eq("kind", "mensalidade")
            .eq("period", period)
            .is("deleted_at", null);

          expect(charges ?? []).toHaveLength(1);
          expect(charges?.[0].status).toBe("pendente");
          expect(charges?.[0].amount_cents).toBe(DEFAULT_MONTHLY_CENTS);
          if (charges?.[0].id) tracked.chargeIds.push(charges[0].id);
        }
      },
    );

    it(
      "ao criar novo jogador mensalista, gera a mensalidade do mês de forma idempotente (Req 5.1, 5.2)",
      { timeout: 60_000 },
      async () => {
        const period = currentPeriodSaoPaulo();

        const { membershipId } = await createPendingMembership(
          service,
          tracked,
          club.id,
          "novo",
        );

        const asPresident = await signInAsUser(
          president.email,
          president.password,
        );
        let newPlayerId: string;
        try {
          // Sem p_player_id → cria o jogador.
          const { data: playerId, error } = await asPresident.rpc(
            "approve_member",
            { p_membership_id: membershipId, p_tipo: "mensalista" },
          );
          expect(error).toBeNull();
          expect(typeof playerId).toBe("string");
          newPlayerId = playerId as string;
          tracked.playerIds.push(newPlayerId);

          // Idempotência da RPC: reaplicar (membership já ativa) é no-op e
          // devolve o mesmo player, sem criar segunda mensalidade.
          const { data: again, error: againErr } = await asPresident.rpc(
            "approve_member",
            { p_membership_id: membershipId, p_tipo: "mensalista" },
          );
          expect(againErr).toBeNull();
          expect(again).toBe(newPlayerId);
        } finally {
          await asPresident.auth.signOut().catch(() => undefined);
        }

        // Exatamente UMA mensalidade do mês para o novo jogador.
        const { data: charges } = await service
          .from("charges")
          .select("id, amount_cents, status, period")
          .eq("club_id", club.id)
          .eq("player_id", newPlayerId)
          .eq("kind", "mensalidade")
          .eq("period", period)
          .is("deleted_at", null);

        expect(charges ?? []).toHaveLength(1);
        expect(charges?.[0].status).toBe("pendente");
        expect(charges?.[0].amount_cents).toBe(DEFAULT_MONTHLY_CENTS);
        if (charges?.[0].id) tracked.chargeIds.push(charges[0].id);
      },
    );

    it(
      "aprovar como avulso NÃO gera mensalidade (Req 4.7)",
      { timeout: 60_000 },
      async () => {
        const period = currentPeriodSaoPaulo();

        const { membershipId } = await createPendingMembership(
          service,
          tracked,
          club.id,
          "avulso",
        );

        const asPresident = await signInAsUser(
          president.email,
          president.password,
        );
        let newPlayerId: string;
        try {
          const { data: playerId, error } = await asPresident.rpc(
            "approve_member",
            { p_membership_id: membershipId, p_tipo: "avulso" },
          );
          expect(error).toBeNull();
          newPlayerId = playerId as string;
          tracked.playerIds.push(newPlayerId);
        } finally {
          await asPresident.auth.signOut().catch(() => undefined);
        }

        const { data: charges } = await service
          .from("charges")
          .select("id")
          .eq("club_id", club.id)
          .eq("player_id", newPlayerId)
          .eq("kind", "mensalidade")
          .eq("period", period)
          .is("deleted_at", null);

        expect(charges ?? []).toHaveLength(0);
      },
    );

    it(
      "falha ao vincular a um jogador já vinculado a outro membro (23505)",
      { timeout: 60_000 },
      async () => {
        // Primeiro membro aprovado criando um jogador novo.
        const { membershipId: firstMembership } = await createPendingMembership(
          service,
          tracked,
          club.id,
          "dup-a",
        );

        const asPresident = await signInAsUser(
          president.email,
          president.password,
        );
        try {
          const { data: firstPlayerId, error: firstErr } =
            await asPresident.rpc("approve_member", {
              p_membership_id: firstMembership,
              p_tipo: "mensalista",
            });
          expect(firstErr).toBeNull();
          const linkedPlayerId = firstPlayerId as string;
          tracked.playerIds.push(linkedPlayerId);

          // Segundo membro tenta vincular ao MESMO jogador já vinculado.
          const { membershipId: secondMembership } =
            await createPendingMembership(service, tracked, club.id, "dup-b");

          const { error: dupErr } = await asPresident.rpc("approve_member", {
            p_membership_id: secondMembership,
            p_tipo: "mensalista",
            p_player_id: linkedPlayerId,
          });

          // A RPC levanta unique_violation (23505) → a chamada retorna erro.
          expect(dupErr).not.toBeNull();
          expect(dupErr?.code).toBe("23505");
        } finally {
          await asPresident.auth.signOut().catch(() => undefined);
        }
      },
    );
  },
);
