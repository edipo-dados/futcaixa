"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  ACTIVE_CLUB_COOKIE,
  getMembershipSession,
} from "@/lib/auth/membership";

/**
 * Server Action de troca de futebol ativo (tarefa 23.2 — Requisito 7.3).
 *
 * Grava o `club_id` escolhido no cookie {@link ACTIVE_CLUB_COOKIE}
 * (`fc_active_club`), que é lido no servidor por `getMembershipSession` para
 * re-resolver o clube ativo. Em seguida redireciona para `/dashboard` para que
 * toda a árvore (sidebar, dados) seja renderizada já no contexto do novo clube.
 *
 * Segurança (defesa em profundidade — NÃO confiar no cliente):
 *   - a action valida que o usuário tem uma membership ATIVA no `clubId`
 *     informado (via `getMembershipSession`, que já filtra `status = 'ativo'`)
 *     ANTES de gravar o cookie. Um `clubId` sem membership ativa é rejeitado;
 *   - mesmo que esta checagem falhasse, a autoridade real continua sendo a RLS
 *     no Postgres (Req 6.2/6.5): trocar o cookie para um clube sem acesso não
 *     vaza dados, pois as políticas por `club_id` rejeitam a leitura.
 *
 * O cookie NÃO precisa ser httpOnly: ele carrega apenas uma preferência de
 * contexto (qual futebol exibir), não um segredo. Ainda assim usamos
 * `sameSite`/`path`/`secure` consistentes com um cookie de sessão de UX.
 */
export async function setActiveClub(clubId: string): Promise<void> {
  const normalized = clubId?.trim();
  if (!normalized) {
    // Entrada vazia/ inválida: não altera nada e volta ao dashboard.
    redirect("/dashboard");
  }

  const session = await getMembershipSession();
  if (!session) {
    redirect("/login");
  }

  const hasActiveMembership = session.memberships.some(
    (m) => m.clubId === normalized,
  );

  if (!hasActiveMembership) {
    // `clubId` sem membership ativa do usuário: rejeita a troca silenciosamente
    // e mantém o contexto atual, redirecionando ao dashboard.
    redirect("/dashboard");
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_CLUB_COOKIE, normalized, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    // Preferência de contexto persistente (1 ano); re-resolvida a cada request
    // contra as memberships ativas, então nunca "trava" num clube sem acesso.
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect("/dashboard");
}
