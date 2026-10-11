import { type MembershipSession } from "@/lib/auth/membership";

/**
 * Guarda de autorização de PLATAFORMA (tarefa 19.2).
 *
 * As telas sob o grupo de rotas `(admin)` são exclusivas do `system_admin`
 * (Requisitos 2.3, 2.5, 17.3). Esta função concentra, de forma PURA e sem I/O,
 * a decisão "pode acessar/agir na administração da plataforma?" a partir da
 * sessão multi-tenant já resolvida (`getMembershipSession`).
 *
 * Mantê-la pura permite testá-la isoladamente (sem Supabase/cookies) e reusá-la
 * tanto no layout-guard do grupo `(admin)` quanto nas Server Actions de
 * aprovação/recusa, que revalidam a autoridade do ator antes de qualquer escrita.
 *
 * SEGURANÇA: isto é conveniência de UX/escopo. A autoridade real continua na
 * RLS do Postgres — só o `system_admin` pode ler solicitações de terceiros e
 * atualizar `president_requests` (Req 17.3). Esta checagem apenas evita exibir
 * a tela e executar a ação para quem a RLS rejeitaria de qualquer forma.
 */

/** Decisão da guarda de plataforma: autorizado ou (para onde) redirecionar. */
export type PlatformAdminGuard =
  | { authorized: true }
  | { authorized: false; redirectTo: "/sem-futebol" | "/dashboard" };

/**
 * Decide se a sessão informada pode acessar a administração da plataforma.
 *
 * Regras:
 *   - sem sessão (null)                 → redireciona ao onboarding `/sem-futebol`
 *     (defesa; o middleware já manda não autenticado ao login antes daqui);
 *   - `isSystemAdmin === true`          → autorizado;
 *   - não é system_admin e `hasNoClub`  → `/sem-futebol` (onboarding);
 *   - não é system_admin e tem futebol  → `/dashboard` (home da app).
 *
 * O destino do não-autorizado espelha o middleware (que já protege `/admin/*`),
 * deixando a página robusta mesmo que acessada diretamente.
 */
export function resolvePlatformAdminGuard(
  session: MembershipSession | null,
): PlatformAdminGuard {
  if (!session) {
    return { authorized: false, redirectTo: "/sem-futebol" };
  }
  if (session.isSystemAdmin) {
    return { authorized: true };
  }
  return {
    authorized: false,
    redirectTo: session.hasNoClub ? "/sem-futebol" : "/dashboard",
  };
}

/**
 * Variante booleana usada pelas Server Actions, que apenas precisam saber se o
 * ator é `system_admin` para prosseguir (ou abortar) — sem destino de redireção.
 */
export function isPlatformAdmin(session: MembershipSession | null): boolean {
  return session?.isSystemAdmin === true;
}
