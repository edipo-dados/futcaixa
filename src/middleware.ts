import { NextResponse, type NextRequest } from "next/server";

import {
  getMembershipSummaryFromRequest,
  updateSession,
  type ClubRole,
  type MembershipSummary,
} from "@/lib/supabase/middleware";

/**
 * Middleware de proteção de rotas, onboarding "sem futebol" e guarda por papel
 * (Requisitos 1.6, 1.7, 7.7).
 *
 * PRINCÍPIO DE SEGURANÇA (defense-in-depth): a autoridade real de acesso é a
 * RLS no Postgres (Requisitos 1.8, 6.2) — nenhuma linha é lida/escrita sem
 * passar pelas políticas por `club_id` E papel (via `memberships`). Este
 * middleware é uma camada de CONVENIÊNCIA/UX: atualiza a sessão (refresh de
 * token) e redireciona cedo quem claramente não deveria estar numa rota,
 * evitando telas quebradas. Jamais confie apenas neste arquivo para proteger
 * dados — a RLS é a fonte de verdade.
 *
 * MULTI-TENANT: o papel do usuário NÃO é mais global em `profiles`; ele vive
 * por clube em `memberships` (Req 5.3). O middleware resolve as memberships
 * `ativas` do usuário e trata três estados de borda:
 *   1. público não autenticado → só `/sorteio` e `/convite/<codigo>` (Req 1.7);
 *   2. autenticado SEM nenhuma membership ativa → onboarding `/sem-futebol`
 *      (Req 1.6);
 *   3. rota que carrega um `club_id` ao qual o usuário não tem membership ativa
 *      → seletor de futebol / "sem futebol" (Req 7.7).
 *
 * NOTA SOBRE A ROTA DE ONBOARDING: adotamos `/sem-futebol` como rota de
 * onboarding (alinhada ao grupo `(onboarding)/sem-futebol` do design.md). É o
 * estado inicial de uma conta recém-criada: oferece abrir um convite ou
 * solicitar presidência. A implementação da tela em si é das tarefas 19.1/23.1;
 * aqui apenas direcionamos para ela.
 */

/** Rota de onboarding para o estado "sem futebol" (Req 1.6). */
const ONBOARDING_PATH = "/sem-futebol";

/**
 * Cookie que lembra o código do convite em andamento. Gravado ao visitar
 * `/convite/<codigo>` e usado para RETOMAR o convite caso o usuário recém-logado
 * caia em `/sem-futebol` (o `next` pode se perder entre cadastro/confirmação de
 * e-mail). Sem isso, o convidado via o card "solicitar presidência" e, por
 * engano, pedia presidência em vez de entrar como jogador.
 */
const PENDING_INVITE_COOKIE = "fc_pending_invite";

/** Extrai o `<codigo>` de uma rota `/convite/<codigo>`, ou `null`. */
function inviteCodeFromPath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "convite" && segments[1]) {
    return decodeURIComponent(segments[1]);
  }
  return null;
}

/**
 * Rotas de onboarding adicionais liberadas ao usuário autenticado que AINDA
 * não tem futebol. Diferente de `/sem-futebol` (o estado inicial), estas são
 * passos subsequentes do onboarding que o usuário sem clube precisa alcançar.
 *
 * `/criar-futebol` é o caso central (Req 3.1): um presidente aprovado SEM clube
 * acessa essa tela para criar o primeiro futebol. Sem esta exceção, o guard de
 * "sem futebol" abaixo o jogaria de volta a `/sem-futebol` antes da página
 * carregar — um beco sem saída, já que a sidebar/onboarding apontam para
 * `/criar-futebol`. A autoridade real continua na RPC `create_club`, que recusa
 * quem não é presidente aprovado; aqui é só liberar o acesso à tela.
 */
const ONBOARDING_EXTRA_PREFIXES = ["/criar-futebol", "/ser-presidente"] as const;

/** Rota do seletor de futebol / entrada da área autenticada. */
const APP_HOME_PATH = "/dashboard";

/**
 * Rotas de autenticação (fluxo de login/cadastro/callback). Não exigem
 * membership nem sessão prévia; um usuário já logado pode continuar nelas (a
 * própria tela decide o redirecionamento pós-login).
 */
const AUTH_PREFIXES = ["/login", "/cadastro", "/callback"] as const;

/**
 * Rotas 100% públicas, acessíveis SEM autenticação (Requisito 1.7):
 * apenas a aba de Sorteio e a abertura de um link de convite.
 */
const PUBLIC_PREFIXES = ["/sorteio", "/convite", "/api/health"] as const;

/**
 * Rotas de administração da PLATAFORMA (system_admin). Alinhadas ao grupo
 * `(admin)` do design.md (clubes, solicitações de presidente). Exigem
 * `is_system_admin`. A estrutura de telas é da seção 19; aqui preparamos o
 * ponto de verificação sem quebrar caso ainda não exista.
 */
const PLATFORM_ADMIN_PREFIXES = ["/admin"] as const;

/**
 * Guarda por papel DENTRO do clube ativo. Cada entrada declara, para um prefixo
 * de rota, quais papéis de `memberships` podem acessá-la (Requisitos 1.6, 5.x).
 *
 * - presidente: administra o clube (jogadores, categorias, configurações,
 *   membros) e também as operações financeiras;
 * - tesoureiro: operação financeira (lançamentos, cobranças, aprovações,
 *   inadimplentes, recorrentes), mas NÃO gestão de jogadores/config/membros;
 * - jogador: apenas rotas comuns (dashboard, meu-extrato) — não listadas aqui.
 *
 * Rotas autenticadas não listadas ficam liberadas a qualquer membership ativa.
 */
const CLUB_ROUTE_ROLES: ReadonlyArray<{
  prefix: string;
  roles: readonly ClubRole[];
}> = [
  // Somente presidente (gestão de jogadores, categorias, configurações, membros).
  { prefix: "/jogadores", roles: ["presidente"] },
  { prefix: "/categorias", roles: ["presidente"] },
  { prefix: "/configuracoes", roles: ["presidente"] },
  { prefix: "/membros", roles: ["presidente"] },
  // Operação financeira: presidente e tesoureiro.
  { prefix: "/lancamentos", roles: ["presidente", "tesoureiro"] },
  { prefix: "/cobrancas", roles: ["presidente", "tesoureiro"] },
  { prefix: "/aprovacoes", roles: ["presidente", "tesoureiro"] },
  { prefix: "/inadimplentes", roles: ["presidente", "tesoureiro"] },
  { prefix: "/recorrentes", roles: ["presidente", "tesoureiro"] },
  // dashboard e meu-extrato: qualquer membership ativa (não listados).
];

function matchesPrefix(
  pathname: string,
  prefixes: readonly string[],
): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isAuthPath(pathname: string): boolean {
  return matchesPrefix(pathname, AUTH_PREFIXES);
}

function isPublicPath(pathname: string): boolean {
  return matchesPrefix(pathname, PUBLIC_PREFIXES);
}

function isPlatformAdminPath(pathname: string): boolean {
  return matchesPrefix(pathname, PLATFORM_ADMIN_PREFIXES);
}

/** Retorna os papéis exigidos pela rota de clube, ou `null` se nenhum guard se aplica. */
function requiredClubRolesFor(pathname: string): readonly ClubRole[] | null {
  const match = CLUB_ROUTE_ROLES.find(
    ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return match ? match.roles : null;
}

/**
 * Extrai o `club_id` embutido na rota, quando houver. O design prevê rotas
 * escopadas por clube (`/[clubId]/...`, grupo `(app)/[clubId]`). Enquanto a
 * refatoração de rotas (seção 21/23) não acontece, as rotas são "flat" e esta
 * função simplesmente não encontra um `club_id` — o escopo do clube ativo cai
 * no cookie/seletor.
 *
 * Heurística: um primeiro segmento com forma de UUID é tratado como `club_id`.
 */
function clubIdFromPath(pathname: string): string | null {
  const [firstSegment] = pathname.split("/").filter(Boolean);
  if (firstSegment && isUuid(firstSegment)) {
    return firstSegment;
  }
  return null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Redireciona preservando a origem/host da requisição. */
function redirectTo(request: NextRequest, pathname: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  return NextResponse.redirect(url);
}

function hasRoleIn(
  summary: MembershipSummary,
  clubId: string | null,
  roles: readonly ClubRole[],
): boolean {
  if (summary.isSystemAdmin) {
    return true;
  }
  // Quando a rota carrega um club_id, a guarda é restrita à membership daquele
  // clube; sem club_id na rota (rotas "flat" atuais), vale qualquer membership
  // ativa com papel suficiente.
  const relevant = clubId
    ? summary.activeMemberships.filter((m) => m.clubId === clubId)
    : summary.activeMemberships;
  return relevant.some((m) => roles.includes(m.role));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Sempre atualiza a sessão (refresh de token) e obtém o usuário validado.
  const { response, userId } = await updateSession(request);

  // Rotas públicas (Req 1.7): liberadas, apenas propagando a sessão atualizada.
  if (isPublicPath(pathname)) {
    // Persistência do convite: ao visitar `/convite/<codigo>`, lembramos o
    // código num cookie. Assim, se o usuário criar conta/entrar e o `next` se
    // perder no caminho, ainda conseguimos retomar o convite (em vez de deixá-lo
    // cair em `/sem-futebol` e, por engano, "solicitar presidência"). O cookie
    // é limpo quando o convite é consumido (vira membership) — ver a página
    // `/convite` e `/sem-futebol`.
    const inviteCode = inviteCodeFromPath(pathname);
    if (inviteCode) {
      response.cookies.set(PENDING_INVITE_COOKIE, inviteCode, {
        httpOnly: false,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24, // 24h: tempo de sobra para concluir o cadastro
      });
    }
    return response;
  }

  // Rotas de autenticação: liberadas para o fluxo de login/cadastro/callback.
  if (isAuthPath(pathname)) {
    return response;
  }

  // Rota protegida sem usuário autenticado → login (Req 1.7), preservando o
  // destino em `next` para retornar após o login.
  if (!userId) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Resolve autorização por membership (nunca de `profiles.role` — Req 5.3).
  const summary = await getMembershipSummaryFromRequest(request);

  // Sem resumo = sem sessão válida resolvível → login (defesa; `userId` já
  // existia, então isto cobre uma corrida rara de expiração de sessão).
  if (!summary) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // A própria rota de onboarding é liberada para o usuário autenticado (ele
  // precisa chegar lá), mesmo sem futebol. O mesmo vale para as rotas de
  // onboarding adicionais (ex.: `/criar-futebol`), acessadas por quem ainda
  // não tem clube — senão o guard "sem futebol" abaixo as redirecionaria.
  if (
    pathname === ONBOARDING_PATH ||
    pathname.startsWith(`${ONBOARDING_PATH}/`) ||
    matchesPrefix(pathname, ONBOARDING_EXTRA_PREFIXES)
  ) {
    return response;
  }

  // Área de administração da plataforma (system_admin). Exige o flag; qualquer
  // outro papel é mandado para a home da app.
  if (isPlatformAdminPath(pathname)) {
    if (!summary.isSystemAdmin) {
      return redirectTo(request, summary.hasNoClub ? ONBOARDING_PATH : APP_HOME_PATH);
    }
    return response;
  }

  // Estado "sem futebol" (Req 1.6): autenticado, não é system_admin e não tem
  // nenhuma membership ativa → onboarding.
  if (summary.hasNoClub) {
    // Se há um convite pendente lembrado (cookie), RETOMA o convite em vez de
    // mandar para o onboarding — evita que o convidado caia no card "solicitar
    // presidência" e peça presidência por engano. A página `/convite` conclui
    // o fluxo (vira membership pendente) e limpa o cookie.
    const pendingInvite = request.cookies.get(PENDING_INVITE_COOKIE)?.value;
    if (pendingInvite) {
      return redirectTo(
        request,
        `/convite/${encodeURIComponent(pendingInvite)}`,
      );
    }
    return redirectTo(request, ONBOARDING_PATH);
  }

  // Se a rota carrega um club_id ao qual o usuário não tem membership ativa
  // (Req 7.7) → seletor de futebol / "sem futebol". system_admin ignora o
  // escopo de tenant.
  const routeClubId = clubIdFromPath(pathname);
  if (
    routeClubId &&
    !summary.isSystemAdmin &&
    !summary.activeMemberships.some((m) => m.clubId === routeClubId)
  ) {
    return redirectTo(request, APP_HOME_PATH);
  }

  // Guarda por papel dentro do clube (Req 1.6).
  const requiredRoles = requiredClubRolesFor(pathname);
  if (requiredRoles && !hasRoleIn(summary, routeClubId, requiredRoles)) {
    // Papel insuficiente → volta para uma rota permitida (home da app).
    return redirectTo(request, APP_HOME_PATH);
  }

  return response;
}

export const config = {
  /**
   * Aplica o middleware a todas as rotas, exceto internos do Next, a API de
   * cron (protegida por `CRON_SECRET`, chamada por Vercel Cron sem sessão) e
   * arquivos estáticos (imagens, favicon, manifest/ícones do PWA). Assim o
   * `/sorteio`, o convite e os assets permanecem rápidos e o refresh de sessão
   * não roda à toa.
   */
  matcher: [
    "/((?!_next/static|_next/image|api/cron|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
