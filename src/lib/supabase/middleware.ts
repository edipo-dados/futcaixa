import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicSupabaseConfig } from "@/lib/supabase/env";

/**
 * Papel do usuário DENTRO de um futebol (clube). O papel não é mais global em
 * `profiles`: ele vive em `memberships` por par (usuário, clube).
 * Ver design.md "Três níveis de papel" e Requisito 5.3.
 */
export type ClubRole = "presidente" | "tesoureiro" | "jogador";

/**
 * Ponte de cookies entre a requisição e a resposta do middleware.
 *
 * Este é o padrão oficial do `@supabase/ssr` para middleware: criamos uma
 * `NextResponse` que será devolvida ao navegador e, sempre que o Supabase
 * precisar atualizar os cookies de sessão (refresh de token), gravamos tanto
 * na requisição (para que o `getUser` desta mesma passada enxergue o valor
 * novo) quanto na resposta (para persistir no navegador).
 *
 * IMPORTANTE: a `response` precisa ser recriada preservando os cookies da
 * requisição; por isso ela é reconstruída dentro de `setAll`.
 */
export interface UpdateSessionResult {
  /** Resposta a ser retornada pelo middleware (com os cookies atualizados). */
  response: NextResponse;
  /** `userId` autenticado (validado via `getUser`), ou `null`. */
  userId: string | null;
}

/**
 * Atualiza/refaz a sessão do usuário no middleware e devolve o usuário
 * autenticado. Deve ser a única peça responsável pelo refresh de sessão em
 * cada requisição — por isso o cliente de servidor em Server Components tem o
 * `setAll` protegido por try/catch (ver `lib/supabase/server.ts`).
 */
export async function updateSession(
  request: NextRequest,
): Promise<UpdateSessionResult> {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const { url, anonKey } = getPublicSupabaseConfig();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({
          request: { headers: request.headers },
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // `getUser` revalida o token junto ao Supabase Auth e dispara o refresh
  // de sessão (gravando os cookies via `setAll` acima quando necessário).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, userId: user?.id ?? null };
}

/**
 * Uma membership `ativa` do usuário logado (par clube + papel). É a projeção
 * mínima que o middleware precisa para decidir sobre onboarding e guarda por
 * papel sem acoplar à superfície (ainda em construção) de `lib/auth/membership.ts`
 * (tarefa 18.1).
 */
export interface ActiveMembership {
  clubId: string;
  role: ClubRole;
}

/**
 * Resumo de autorização do usuário no nível de plataforma + clubes, resolvido
 * a partir de `profiles.is_system_admin` e das `memberships` com `status='ativo'`.
 *
 * O papel NUNCA é lido de `profiles` (Req 5.3): ele vem de `memberships`.
 *
 * Observação de segurança: este resumo serve apenas à UX (redirecionar cedo
 * quem não tem acesso / levar ao onboarding). A autoridade real é a RLS no
 * Postgres (Requisito 1.8 / 6.2) — ver o comentário no topo de
 * `src/middleware.ts`.
 */
export interface MembershipSummary {
  /** Administrador da plataforma (bypass de tenant). */
  isSystemAdmin: boolean;
  /** Memberships `ativas` do usuário (clube + papel). */
  activeMemberships: ActiveMembership[];
  /** `true` quando NÃO há nenhuma membership ativa e não é system_admin. */
  hasNoClub: boolean;
}

interface ProfileAdminRow {
  is_system_admin: boolean | null;
}

interface MembershipRow {
  club_id: string;
  role: ClubRole;
}

/**
 * Resolve o resumo de autorização do usuário autenticado usando um cliente
 * ligado aos cookies da requisição do middleware (refresh de sessão já ocorreu
 * em `updateSession`).
 *
 * Esta função é propositalmente autossuficiente (consulta direta ao Supabase,
 * sem depender da assinatura de `lib/auth/membership.ts`), mas expõe a mesma
 * superfície conceitual — "memberships ativas", "clube ativo", "sem futebol" e
 * `isSystemAdmin" — para que a lógica possa ser consolidada em `membership.ts`
 * (tarefa 18.1) sem reescrever o middleware.
 */
export async function getMembershipSummaryFromRequest(
  request: NextRequest,
): Promise<MembershipSummary | null> {
  const { url, anonKey } = getPublicSupabaseConfig();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      // No-op: a leitura de autorização não deve alterar cookies; o refresh de
      // sessão já ocorreu em `updateSession`.
      setAll() {},
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // Lê o flag de plataforma e as memberships ativas em paralelo.
  const [profileResult, membershipsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("is_system_admin")
      .eq("id", user.id)
      .maybeSingle<ProfileAdminRow>(),
    supabase
      .from("memberships")
      .select("club_id, role")
      .eq("user_id", user.id)
      .eq("status", "ativo")
      .returns<MembershipRow[]>(),
  ]);

  const isSystemAdmin = profileResult.data?.is_system_admin === true;

  const activeMemberships: ActiveMembership[] = (
    membershipsResult.data ?? []
  ).map((row) => ({ clubId: row.club_id, role: row.role }));

  return {
    isSystemAdmin,
    activeMemberships,
    // "Sem futebol" (Req 1.6): autenticado, não é system_admin e não tem
    // nenhuma membership ativa.
    hasNoClub: !isSystemAdmin && activeMemberships.length === 0,
  };
}
