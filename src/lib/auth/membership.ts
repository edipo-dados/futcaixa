import "server-only";

import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";

/**
 * Resolução de sessão/perfil no modelo MULTI-TENANT (tarefa 18.1).
 *
 * O papel de um usuário é POR CLUBE e vive em `public.memberships`
 * (status `ativo`) — NUNCA mais em `profiles` (Requisito 5.3). Este módulo
 * concentra a resolução de:
 *   - memberships ATIVAS do usuário autenticado (com dados do clube);
 *   - o "clube ativo" (via cookie quando houver mais de um; o único quando só
 *     houver um; estado "sem futebol" quando não houver nenhum — Req 7.1);
 *   - o papel do usuário no clube ativo (de `memberships`, Req 1.3/1.6);
 *   - flags de plataforma (`isSystemAdmin`) e de onboarding (`hasNoClub`).
 *
 * Observação de segurança: assim como o middleware e a navegação filtrada por
 * papel, o que este módulo resolve é conveniência de UX/escopo. A autoridade
 * real de acesso continua sendo a RLS no Postgres (dupla dimensão tenant +
 * papel). Enviar um `club_id` indevido não vaza dados: a RLS rejeita.
 */

/** Papel de um usuário DENTRO de um clube (fonte: `memberships.role`). */
export type ClubRole = "presidente" | "tesoureiro" | "jogador";

/**
 * Nome do cookie que guarda o `club_id` ativo quando o usuário participa de
 * mais de um futebol. Com um único clube ativo o cookie é dispensável (o
 * próprio clube é o ativo); com nenhum, o estado é "sem futebol".
 */
export const ACTIVE_CLUB_COOKIE = "fc_active_club";

/**
 * Uma membership ATIVA do usuário, já com os dados do clube resolvidos via join
 * em `clubs`. É a unidade de "um futebol ao qual o usuário tem acesso".
 */
export interface ActiveMembership {
  /** `memberships.id`. */
  membershipId: string;
  /** `clubs.id` — o tenant. */
  clubId: string;
  /** Nome do futebol (`clubs.name`). */
  clubName: string;
  /** Papel do usuário NESTE clube (`memberships.role`). */
  role: ClubRole;
  /** Jogador vinculado neste clube (`memberships.player_id`), ou null. */
  playerId: string | null;
}

/**
 * Resultado completo da resolução de sessão multi-tenant.
 *
 * - `hasNoClub` indica o estado "sem futebol" (nenhuma membership ativa): o
 *   usuário autenticou mas ainda não entrou em nenhum clube (Req 7.1).
 * - `activeClub`/`role`/`playerId` referem-se SEMPRE ao clube ativo; são nulos
 *   quando `hasNoClub` é true.
 */
export interface MembershipSession {
  /** `auth.users.id` do usuário autenticado. */
  userId: string;
  /** Nome do perfil (`profiles.full_name`), pode ser nulo/vazio. */
  fullName: string | null;
  /** Admin de plataforma (`profiles.is_system_admin`); bypass de tenant. */
  isSystemAdmin: boolean;
  /** Todas as memberships ATIVAS do usuário (ordenadas por nome do clube). */
  memberships: ActiveMembership[];
  /** Estado "sem futebol": nenhuma membership ativa. */
  hasNoClub: boolean;
  /** Clube ativo resolvido, ou null quando `hasNoClub`. */
  activeClub: ActiveMembership | null;
  /** Papel no clube ativo (de `memberships`), ou null quando `hasNoClub`. */
  role: ClubRole | null;
  /** `player_id` no clube ativo, ou null. */
  playerId: string | null;
}

/** Formato bruto da linha de `memberships` + join em `clubs`. */
interface MembershipRow {
  id: string;
  club_id: string;
  role: ClubRole;
  player_id: string | null;
  clubs: { id: string; name: string } | { id: string; name: string }[] | null;
}

/**
 * Escolhe, entre as memberships ativas, qual é o clube ATIVO.
 *
 * Regras (puras, sem I/O — por isso testáveis isoladamente):
 *   - nenhuma membership        → null (estado "sem futebol");
 *   - exatamente uma            → ela mesma (o cookie é irrelevante);
 *   - mais de uma + cookie casa  → a membership daquele `club_id`;
 *   - mais de uma + cookie ausente/inválido → a primeira (fallback estável).
 *
 * O fallback para a primeira (a lista chega ordenada por nome do clube) evita
 * um estado "indefinido" quando há vários clubes e nenhuma seleção válida.
 */
export function resolveActiveClub(
  memberships: ActiveMembership[],
  preferredClubId: string | null | undefined,
): ActiveMembership | null {
  if (memberships.length === 0) {
    return null;
  }
  if (memberships.length === 1) {
    return memberships[0];
  }
  if (preferredClubId) {
    const match = memberships.find((m) => m.clubId === preferredClubId);
    if (match) {
      return match;
    }
  }
  return memberships[0];
}

/** Normaliza o join `clubs` (Supabase pode devolver objeto ou array). */
function clubFromRow(row: MembershipRow): { id: string; name: string } | null {
  if (!row.clubs) {
    return null;
  }
  return Array.isArray(row.clubs) ? (row.clubs[0] ?? null) : row.clubs;
}

/**
 * Retorna o usuário autenticado (validado no servidor via `getUser`), ou
 * `null` quando não há sessão. Preferir sempre `getUser` a `getSession` no
 * servidor, pois `getUser` revalida o token junto ao Supabase Auth.
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Lista as memberships com status `ativo` do usuário autenticado, com o nome do
 * clube resolvido via join em `clubs`. Ordenadas por nome do clube para dar uma
 * ordem estável ao seletor de futebol e ao fallback de clube ativo.
 *
 * Retorna lista vazia quando não há sessão ou nenhuma membership ativa.
 */
export async function getActiveMemberships(): Promise<ActiveMembership[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return [];
  }

  const { data, error } = await supabase
    .from("memberships")
    .select("id, club_id, role, player_id, clubs(id, name)")
    .eq("user_id", user.id)
    .eq("status", "ativo")
    .returns<MembershipRow[]>();

  if (error || !data) {
    return [];
  }

  return data
    .map((row): ActiveMembership | null => {
      const club = clubFromRow(row);
      if (!club) {
        return null;
      }
      return {
        membershipId: row.id,
        clubId: row.club_id,
        clubName: club.name,
        role: row.role,
        playerId: row.player_id,
      };
    })
    .filter((m): m is ActiveMembership => m !== null)
    .sort((a, b) => a.clubName.localeCompare(b.clubName, "pt-BR"));
}

/**
 * Carrega a sessão multi-tenant completa do usuário autenticado: perfil
 * (nome + flag de plataforma), memberships ativas e a resolução do clube ativo
 * (com papel e `player_id` daquele clube). Retorna `null` quando não há sessão.
 *
 * O clube ativo é resolvido a partir do cookie `fc_active_club` quando o
 * usuário participa de mais de um futebol; com um único futebol, ele é o ativo;
 * sem nenhum, `hasNoClub` fica true (estado "sem futebol" — Req 7.1).
 */
export async function getMembershipSession(): Promise<MembershipSession | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, is_system_admin")
    .eq("id", user.id)
    .maybeSingle<{ full_name: string | null; is_system_admin: boolean }>();

  const memberships = await getActiveMemberships();

  const cookieStore = await cookies();
  const preferredClubId = cookieStore.get(ACTIVE_CLUB_COOKIE)?.value ?? null;
  const activeClub = resolveActiveClub(memberships, preferredClubId);

  return {
    userId: user.id,
    fullName: profile?.full_name ?? null,
    isSystemAdmin: profile?.is_system_admin ?? false,
    memberships,
    hasNoClub: memberships.length === 0,
    activeClub,
    role: activeClub?.role ?? null,
    playerId: activeClub?.playerId ?? null,
  };
}

/**
 * Indica se, no clube ATIVO, o usuário tem algum dos papéis informados.
 * `isSystemAdmin` NÃO concede papel de clube aqui — é bypass de tenant tratado
 * à parte na RLS/UX; esta checagem é estritamente sobre o papel no clube ativo.
 */
export function hasClubRole(
  session: MembershipSession | null,
  ...roles: ClubRole[]
): boolean {
  return session?.role != null && roles.includes(session.role);
}
