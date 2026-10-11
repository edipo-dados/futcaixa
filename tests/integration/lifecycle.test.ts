/**
 * Teste de INTEGRAÇÃO — ciclo de vida do futebol e idempotência por clube
 * (tarefa 25.3), multi-tenant. RODA DE VERDADE contra o Supabase de teste.
 *
 * Requisitos cobertos:
 *   - 3.6: criação ATÔMICA de futebol via RPC `create_club` — clube, settings,
 *     categorias padrão e membership presidente/ativo nascem juntos (rollback
 *     total em falha). Também: usuário NÃO aprovado é rejeitado e nada é criado.
 *   - 4.6: convite → aprovação → vínculo — um membro `pendente`/`jogador` é
 *     aprovado pelo presidente via `approve_member`, que cria/vincula o
 *     `players` (memberships.player_id preenchido) e muda status para `ativo`.
 *   - 5.1: guarda do ÚLTIMO presidente — rebaixar o único presidente ativo
 *     FALHA (errcode 23514); com um SEGUNDO presidente ativo, o rebaixamento
 *     do primeiro PASSA.
 *   - 10.3 / 11.2: idempotência dos crons POR CLUBE — gerar mensalidades e
 *     recorrentes 2x no mesmo período não duplica em NENHUM clube e não cruza
 *     dados entre dois clubes distintos.
 *
 * ── Como roda ───────────────────────────────────────────────────────────────
 * Exige `hasRlsTestEnv` (URL + service role + anon): a parte de ciclo de vida
 * exercita as RPCs COMO USUÁRIO autenticado (anon key + signInWithPassword),
 * de modo que `auth.uid()` reflita quem chama e as autorizações internas das
 * RPCs valham de verdade. Em dev, as variáveis vêm do `.env.local` via
 * `tests/integration/setup-env.ts`.
 *
 * ── Isolamento / teardown ─────────────────────────────────────────────────
 * `create_club` cria clubes que o helper NÃO rastreia automaticamente — por
 * isso rastreamos manualmente o `club_id` retornado (`tracked.clubIds.push`) e
 * os usuários de auth criados. A migration 20250101000030 corrigiu o guard do
 * último presidente para o DELETE em cascata do clube, então no teardown
 * apagamos os CLUBES primeiro (o cascade remove memberships/players/settings/
 * categorias/charges/transactions) e, em seguida, chamamos o teardown padrão
 * (que também remove os usuários de auth e varre por `club_id`). Períodos de
 * cron no futuro distante evitam colisão com seed/dados reais.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateMensalidadesForPeriod } from "@/lib/cron/gerar-mensalidades";
import { generateRecurringForPeriod } from "@/lib/cron/gerar-recorrentes";

import {
  createTestAuthUserWithProfile,
  createTestClient,
  createTestClub,
  createTestMembership,
  createTestPlayer,
  createTestRecurringExpense,
  hasRlsTestEnv,
  newCreatedRows,
  resolveClubCategoryId,
  signInAsUser,
  uniqueRunId,
  type CreatedRows,
} from "./helpers";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Períodos de teste no futuro distante — evitam colisão com seed/dados reais. */
const MENSALIDADES_PERIOD = "2998-01";
const RECORRENTES_PERIOD = "2998-02";

/** Marca um perfil como presidente aprovado (pré-requisito de `create_club`). */
async function approvePresident(
  service: SupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await service
    .from("profiles")
    .update({ president_status: "aprovado" })
    .eq("id", userId);
  if (error) {
    throw new Error(
      `Falha ao marcar president_status=aprovado para ${userId}: ${error.message}`,
    );
  }
}

describe.skipIf(!hasRlsTestEnv)(
  "ciclo de vida do futebol e idempotência por clube (integração multi-tenant, 25.3)",
  () => {
    let service: SupabaseClient;
    let tracked: CreatedRows;
    let runId: string;

    beforeAll(() => {
      service = createTestClient();
      tracked = newCreatedRows();
      runId = uniqueRunId();
    });

    afterAll(async () => {
      // A migration 30 permite apagar o clube em cascata mesmo com presidente
      // ativo. Apagamos os CLUBES primeiro para o cascade limpar memberships/
      // players/settings/categorias/charges/transactions.
      if (tracked.clubIds.length) {
        await service
          .from("clubs")
          .delete()
          .in("id", tracked.clubIds)
          .then(() => undefined, () => undefined);
      }

      // ── Trilha de auditoria dos usuários do teste ───────────────────────
      // As RPCs exercitadas aqui (create_club, approve_member, set_member_role)
      // e o trigger genérico de auditoria em `settings` gravam linhas em
      // `audit_log` com `actor_id` = usuário de teste. Como `audit_log.club_id`
      // é `ON DELETE SET NULL` (preserva o histórico) e `audit_log.actor_id`
      // referencia `profiles(id)` SEM cascade, essas linhas SOBREVIVEM ao
      // DELETE do clube e BLOQUEARIAM a remoção do usuário de auth (o cascade
      // auth.users → profiles seria barrado pela FK de audit_log). Removemos
      // explicitamente a trilha dos NOSSOS atores antes do teardown padrão —
      // escopo estrito aos ids criados pelo teste; nunca tocamos dados alheios.
      if (tracked.authUserIds.length) {
        await service
          .from("audit_log")
          .delete()
          .in("actor_id", tracked.authUserIds)
          .then(() => undefined, () => undefined);
      }

      // Teardown padrão: remove o restante na ordem das FKs e, por fim, os
      // usuários de auth (agora livres das referências de audit_log).
      const { teardown } = await import("./helpers");
      await teardown(service, tracked);
    });

    // ──────────────────────────────────────────────────────────────────────
    // 1) Atomicidade de create_club (Req 3.6)
    // ──────────────────────────────────────────────────────────────────────
    it(
      "create_club cria clube + settings + categorias + presidente atômico (Req 3.6)",
      { timeout: 60_000 },
      async () => {
        // Presidente APROVADO que vai abrir o futebol.
        const president = await createTestAuthUserWithProfile(service, tracked, {
          suffix: "pres-atomic",
        });
        await approvePresident(service, president.userId);

        const asPresident = await signInAsUser(
          president.email,
          president.password,
        );

        try {
          const { data: clubId, error } = await asPresident.rpc("create_club", {
            p_name: `${runId} Atomic FC`,
            p_pix_key: "pix-atomic@futcaixa.test",
            p_pix_receiver_name: "ATOMIC FC",
            p_pix_city: "SAO PAULO",
            p_default_monthly_cents: 5000,
            p_default_drop_in_cents: 1500,
            p_due_day: 10,
            p_generation_day: 1,
            p_initial_balance_cents: 0,
            p_logo_path: null,
            p_slug: null,
          });

          expect(error).toBeNull();
          expect(typeof clubId).toBe("string");

          // Rastreia manualmente: create_club cria o clube fora do helper.
          const newClubId = clubId as string;
          tracked.clubIds.push(newClubId);

          // Clube criado.
          const { data: club } = await service
            .from("clubs")
            .select("id, name, created_by, invite_code")
            .eq("id", newClubId)
            .single<{
              id: string;
              name: string;
              created_by: string | null;
              invite_code: string;
            }>();
          expect(club?.id).toBe(newClubId);
          expect(club?.created_by).toBe(president.userId);
          expect(club?.invite_code?.length ?? 0).toBeGreaterThan(0);

          // Settings do clube (uma linha por clube) criada junto.
          const { data: settings } = await service
            .from("settings")
            .select("club_id, default_monthly_cents, due_day")
            .eq("club_id", newClubId)
            .single<{
              club_id: string;
              default_monthly_cents: number;
              due_day: number;
            }>();
          expect(settings?.club_id).toBe(newClubId);
          expect(settings?.default_monthly_cents).toBe(5000);
          expect(settings?.due_day).toBe(10);

          // Categorias padrão semeadas (pelo menos uma de cada tipo).
          const { data: categories } = await service
            .from("categories")
            .select("id, kind")
            .eq("club_id", newClubId);
          const kinds = new Set((categories ?? []).map((c) => c.kind));
          expect((categories ?? []).length).toBeGreaterThan(0);
          expect(kinds.has("receita")).toBe(true);
          expect(kinds.has("despesa")).toBe(true);

          // Membership do criador: presidente / ativo.
          const { data: membership } = await service
            .from("memberships")
            .select("id, role, status")
            .eq("club_id", newClubId)
            .eq("user_id", president.userId)
            .single<{ id: string; role: string; status: string }>();
          expect(membership?.role).toBe("presidente");
          expect(membership?.status).toBe("ativo");
        } finally {
          await asPresident.auth.signOut().catch(() => undefined);
        }
      },
    );

    it(
      "create_club é rejeitado para usuário NÃO aprovado e nada é criado (Req 3.6)",
      { timeout: 60_000 },
      async () => {
        // Usuário SEM aprovação (president_status default 'none').
        const notApproved = await createTestAuthUserWithProfile(
          service,
          tracked,
          { suffix: "nao-aprovado" },
        );
        const asUser = await signInAsUser(
          notApproved.email,
          notApproved.password,
        );

        const uniqueName = `${runId} Rejeitado FC`;
        try {
          const { data, error } = await asUser.rpc("create_club", {
            p_name: uniqueName,
            p_pix_key: "pix-rej@futcaixa.test",
            p_pix_receiver_name: "REJEITADO FC",
            p_pix_city: "SAO PAULO",
          });

          // A RPC deve FALHAR (errcode 42501 — não autorizado).
          expect(error).not.toBeNull();
          expect(data).toBeNull();
        } finally {
          await asUser.auth.signOut().catch(() => undefined);
        }

        // Nenhum clube com esse nome deve existir (rollback / não criação).
        const { data: leaked } = await service
          .from("clubs")
          .select("id")
          .eq("name", uniqueName);
        // Defesa: se algo vazou, rastreia para teardown — mas não deveria.
        for (const row of (leaked ?? []) as { id: string }[]) {
          if (!tracked.clubIds.includes(row.id)) tracked.clubIds.push(row.id);
        }
        expect(leaked ?? []).toHaveLength(0);
      },
    );

    // ──────────────────────────────────────────────────────────────────────
    // 2) Convite → aprovação → vínculo com players (Req 4.6)
    // ──────────────────────────────────────────────────────────────────────
    it(
      "approve_member cria/vincula player e ativa a membership pendente (Req 4.6)",
      { timeout: 60_000 },
      async () => {
        // Presidente ativo do clube.
        const president = await createTestAuthUserWithProfile(service, tracked, {
          suffix: "pres-aprova",
        });
        const club = await createTestClub(service, tracked, runId, {
          suffix: "aprova",
          createdBy: president.userId,
        });
        await createTestMembership(service, tracked, {
          userId: president.userId,
          clubId: club.id,
          role: "presidente",
          status: "ativo",
        });

        // Segundo usuário (futuro jogador) com nome no profile para o players.
        const player = await createTestAuthUserWithProfile(service, tracked, {
          suffix: "jogador-pendente",
        });

        // O jogador autentica e cria a própria membership jogador/pendente —
        // exatamente o INSERT que a policy memberships_insert permite
        // (user_id = auth.uid(), status 'pendente', role 'jogador').
        const asPlayer = await signInAsUser(player.email, player.password);
        let membershipId: string;
        try {
          const { data: inserted, error: insErr } = await asPlayer
            .from("memberships")
            .insert({
              user_id: player.userId,
              club_id: club.id,
              role: "jogador",
              status: "pendente",
            })
            .select("id")
            .single<{ id: string }>();
          expect(insErr).toBeNull();
          expect(inserted?.id).toBeTruthy();
          membershipId = inserted!.id;
          tracked.membershipIds.push(membershipId);
        } finally {
          await asPlayer.auth.signOut().catch(() => undefined);
        }

        // Presidente aprova a membership escolhendo o tipo mensalista.
        const asPresident = await signInAsUser(
          president.email,
          president.password,
        );
        try {
          const { data: playerId, error: apprErr } = await asPresident.rpc(
            "approve_member",
            { p_membership_id: membershipId, p_tipo: "mensalista" },
          );
          expect(apprErr).toBeNull();
          expect(typeof playerId).toBe("string");

          // O players criado pela RPC não é rastreado pelo helper → rastreia.
          const newPlayerId = playerId as string;
          tracked.playerIds.push(newPlayerId);

          // A membership ficou ATIVA e vinculada ao player criado.
          const { data: m } = await service
            .from("memberships")
            .select("status, player_id")
            .eq("id", membershipId)
            .single<{ status: string; player_id: string | null }>();
          expect(m?.status).toBe("ativo");
          expect(m?.player_id).toBe(newPlayerId);

          // O players existe, pertence ao clube e é do tipo escolhido.
          const { data: p } = await service
            .from("players")
            .select("id, club_id, type")
            .eq("id", newPlayerId)
            .single<{ id: string; club_id: string; type: string }>();
          expect(p?.club_id).toBe(club.id);
          expect(p?.type).toBe("mensalista");
        } finally {
          await asPresident.auth.signOut().catch(() => undefined);
        }
      },
    );

    // ──────────────────────────────────────────────────────────────────────
    // 3) Guarda do último presidente (Req 5.1)
    // ──────────────────────────────────────────────────────────────────────
    it(
      "set_member_role: rebaixar o ÚNICO presidente FALHA; com um 2º presidente PASSA (Req 5.1)",
      { timeout: 60_000 },
      async () => {
        // Clube com um único presidente ativo (P1).
        const p1 = await createTestAuthUserWithProfile(service, tracked, {
          suffix: "p1-guard",
        });
        const club = await createTestClub(service, tracked, runId, {
          suffix: "guard",
          createdBy: p1.userId,
        });
        const p1MembershipId = await createTestMembership(service, tracked, {
          userId: p1.userId,
          clubId: club.id,
          role: "presidente",
          status: "ativo",
        });

        const asP1 = await signInAsUser(p1.email, p1.password);
        try {
          // Único presidente → rebaixar deve FALHAR (guarda do último presidente).
          const { error: guardErr } = await asP1.rpc("set_member_role", {
            p_membership_id: p1MembershipId,
            p_role: "jogador",
          });
          expect(guardErr).not.toBeNull();
          expect(guardErr?.code).toBe("23514");

          // Continua presidente ativo (nada mudou).
          const { data: stillPres } = await service
            .from("memberships")
            .select("role, status")
            .eq("id", p1MembershipId)
            .single<{ role: string; status: string }>();
          expect(stillPres?.role).toBe("presidente");
          expect(stillPres?.status).toBe("ativo");

          // Agora adiciona um SEGUNDO presidente ativo (P2) via service role.
          const p2 = await createTestAuthUserWithProfile(service, tracked, {
            suffix: "p2-guard",
          });
          const p2MembershipId = await createTestMembership(service, tracked, {
            userId: p2.userId,
            clubId: club.id,
            role: "presidente",
            status: "ativo",
          });
          expect(p2MembershipId).toBeTruthy();

          // Com dois presidentes ativos, rebaixar P1 agora PASSA.
          const { error: okErr } = await asP1.rpc("set_member_role", {
            p_membership_id: p1MembershipId,
            p_role: "jogador",
          });
          expect(okErr).toBeNull();

          const { data: demoted } = await service
            .from("memberships")
            .select("role")
            .eq("id", p1MembershipId)
            .single<{ role: string }>();
          expect(demoted?.role).toBe("jogador");
        } finally {
          await asP1.auth.signOut().catch(() => undefined);
        }
      },
    );

    // ──────────────────────────────────────────────────────────────────────
    // 4) Idempotência dos crons POR CLUBE, sem cruzar dados (Req 10.3 / 11.2)
    // ──────────────────────────────────────────────────────────────────────
    it(
      "crons não duplicam em NENHUM clube e não cruzam dados entre clubes (Req 10.3/11.2)",
      { timeout: 90_000 },
      async () => {
        const CUSTOM_MONTHLY_CENTS = 8800;
        const RECURRING_AMOUNT_CENTS = 15000;
        const RECURRING_DAY = 7;

        // Dois clubes ativos, cada um com um mensalista e uma recorrência.
        const clubA = await createTestClub(service, tracked, runId, {
          suffix: "cronA",
          defaultMonthlyCents: 0,
        });
        const clubB = await createTestClub(service, tracked, runId, {
          suffix: "cronB",
          defaultMonthlyCents: 0,
        });

        const playerA = await createTestPlayer(service, tracked, runId, {
          clubId: clubA.id,
          suffix: "cronA",
          customMonthlyCents: CUSTOM_MONTHLY_CENTS,
        });
        const playerB = await createTestPlayer(service, tracked, runId, {
          clubId: clubB.id,
          suffix: "cronB",
          customMonthlyCents: CUSTOM_MONTHLY_CENTS,
        });

        const catA = await resolveClubCategoryId(service, clubA.id, "despesa");
        const catB = await resolveClubCategoryId(service, clubB.id, "despesa");
        const recA = await createTestRecurringExpense(service, tracked, {
          clubId: clubA.id,
          amountCents: RECURRING_AMOUNT_CENTS,
          categoryId: catA,
          description: `${runId} cronA recorrente`,
          dayOfMonth: RECURRING_DAY,
          isActive: true,
          lastGeneratedPeriod: null,
        });
        const recB = await createTestRecurringExpense(service, tracked, {
          clubId: clubB.id,
          amountCents: RECURRING_AMOUNT_CENTS,
          categoryId: catB,
          description: `${runId} cronB recorrente`,
          dayOfMonth: RECURRING_DAY,
          isActive: true,
          lastGeneratedPeriod: null,
        });

        const trackCharges = async (): Promise<void> => {
          const { data } = await service
            .from("charges")
            .select("id")
            .in("player_id", [playerA, playerB])
            .eq("period", MENSALIDADES_PERIOD);
          for (const row of (data ?? []) as { id: string }[]) {
            if (!tracked.chargeIds.includes(row.id)) {
              tracked.chargeIds.push(row.id);
            }
          }
        };

        const countChargeFor = async (playerId: string): Promise<number> => {
          const { data, error } = await service
            .from("charges")
            .select("id, club_id")
            .eq("player_id", playerId)
            .eq("period", MENSALIDADES_PERIOD)
            .eq("kind", "mensalidade")
            .is("deleted_at", null);
          expect(error).toBeNull();
          return (data ?? []).length;
        };

        const occurredOn = `${RECORRENTES_PERIOD}-${String(RECURRING_DAY).padStart(
          2,
          "0",
        )}`;
        const countTxFor = async (recurringId: string): Promise<number> => {
          const { data, error } = await service
            .from("transactions")
            .select("id")
            .eq("recurring_id", recurringId)
            .eq("occurred_on", occurredOn)
            .is("deleted_at", null);
          expect(error).toBeNull();
          return (data ?? []).length;
        };

        // ── Mensalidades: roda 2x no mesmo período ──────────────────────────
        await generateMensalidadesForPeriod(service, MENSALIDADES_PERIOD);
        await trackCharges();
        await generateMensalidadesForPeriod(service, MENSALIDADES_PERIOD);
        await trackCharges();

        // Exatamente UMA cobrança por jogador em CADA clube (sem duplicar).
        expect(await countChargeFor(playerA)).toBe(1);
        expect(await countChargeFor(playerB)).toBe(1);

        // Não cruzou dados: a cobrança do jogador A pertence ao clube A; a do B,
        // ao clube B (nunca o inverso).
        {
          const { data: aRows } = await service
            .from("charges")
            .select("club_id")
            .eq("player_id", playerA)
            .eq("period", MENSALIDADES_PERIOD)
            .eq("kind", "mensalidade");
          expect((aRows ?? []).map((r) => r.club_id)).toEqual([clubA.id]);

          const { data: bRows } = await service
            .from("charges")
            .select("club_id")
            .eq("player_id", playerB)
            .eq("period", MENSALIDADES_PERIOD)
            .eq("kind", "mensalidade");
          expect((bRows ?? []).map((r) => r.club_id)).toEqual([clubB.id]);
        }

        // ── Recorrentes: roda 2x no mesmo período ───────────────────────────
        await generateRecurringForPeriod(service, RECORRENTES_PERIOD);
        await generateRecurringForPeriod(service, RECORRENTES_PERIOD);

        // Exatamente UM lançamento por recorrência em CADA clube.
        expect(await countTxFor(recA)).toBe(1);
        expect(await countTxFor(recB)).toBe(1);

        // Não cruzou dados: o lançamento da recorrência A é do clube A; o da
        // recorrência B é do clube B.
        {
          const { data: aTx } = await service
            .from("transactions")
            .select("club_id, amount_cents")
            .eq("recurring_id", recA)
            .eq("occurred_on", occurredOn)
            .single<{ club_id: string; amount_cents: number }>();
          expect(aTx?.club_id).toBe(clubA.id);
          expect(aTx?.amount_cents).toBe(RECURRING_AMOUNT_CENTS);

          const { data: bTx } = await service
            .from("transactions")
            .select("club_id, amount_cents")
            .eq("recurring_id", recB)
            .eq("occurred_on", occurredOn)
            .single<{ club_id: string; amount_cents: number }>();
          expect(bTx?.club_id).toBe(clubB.id);
          expect(bTx?.amount_cents).toBe(RECURRING_AMOUNT_CENTS);
        }
      },
    );
  },
);
