/**
 * Regras PURAS de papéis de membros de um futebol (tarefa 20.4).
 *
 * Este módulo concentra a lógica de domínio da promoção/rebaixamento de papéis
 * (`memberships.role`) SEM nenhum I/O — por isso é testável isoladamente e sem
 * banco. A camada de servidor (`role-actions.ts`) e a RLS/trigger do Postgres
 * (migration 20250101000029_last_president_guard.sql) são as autoridades reais;
 * aqui ficam apenas as validações de domínio reaproveitáveis.
 *
 * Invariante crítica (Req 5.5): um futebol SEMPRE precisa de ao menos um
 * presidente ATIVO. Não se pode rebaixar/remover o ÚLTIMO presidente ativo.
 * A guarda à prova de corrida vive no banco (trigger); `isLastPresidentDemotion`
 * replica a regra no app para dar feedback cedo (antes de bater no banco).
 *
 * Requisitos: 5.1, 5.5, 5.6.
 */

/** Papéis possíveis de uma membership (espelha o CHECK do banco). */
export const CLUB_ROLES = ["presidente", "tesoureiro", "jogador"] as const;
export type ClubRole = (typeof CLUB_ROLES)[number];

/** Status possíveis de uma membership (espelha o CHECK do banco). */
export const MEMBERSHIP_STATUSES = ["pendente", "ativo", "recusado"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** Rótulos pt-BR dos papéis, para exibição na UI. */
export const ROLE_LABELS: Record<ClubRole, string> = {
  presidente: "Presidente",
  tesoureiro: "Tesoureiro",
  jogador: "Jogador",
};

/**
 * Visão mínima de um membro necessária para as regras de papel. É um
 * subconjunto de `memberships` — mantém o módulo desacoplado da forma exata da
 * linha do banco.
 */
export interface MemberRoleView {
  /** `memberships.id`. */
  membershipId: string;
  /** Papel atual no clube. */
  role: ClubRole;
  /** Status do vínculo no clube. */
  status: MembershipStatus;
}

/** `true` se `value` é um papel de clube válido (type guard). */
export function isClubRole(value: unknown): value is ClubRole {
  return typeof value === "string" && (CLUB_ROLES as readonly string[]).includes(value);
}

/** Conta quantos membros são presidentes ATIVOS na lista informada. */
export function countActivePresidents(members: readonly MemberRoleView[]): number {
  return members.filter((m) => m.role === "presidente" && m.status === "ativo")
    .length;
}

/**
 * Decide se aplicar `newRole` ao membro `membershipId` deixaria o clube SEM
 * nenhum presidente ativo — ou seja, se é o rebaixamento do ÚLTIMO presidente
 * ativo (proibido, Req 5.5).
 *
 * Regra: só é "rebaixamento do último presidente" quando TODAS as condições
 * valem:
 *   - o membro-alvo existe na lista, é `presidente` e está `ativo`;
 *   - `newRole` não é `presidente` (está realmente perdendo a presidência);
 *   - não há NENHUM outro presidente ativo no clube.
 *
 * Observações:
 *   - Membros não encontrados, inativos/recusados, ou que já não são
 *     presidentes NÃO caracterizam esvaziamento da presidência → `false`.
 *   - Manter `presidente → presidente` (sem mudança efetiva) → `false`.
 *
 * @param members Todos os membros do clube (ou ao menos todos os presidentes
 *   ativos). A função só olha os presidentes ativos para a contagem.
 * @param membershipId Membership-alvo da troca de papel.
 * @param newRole Novo papel pretendido.
 */
export function isLastPresidentDemotion(
  members: readonly MemberRoleView[],
  membershipId: string,
  newRole: ClubRole,
): boolean {
  const target = members.find((m) => m.membershipId === membershipId);

  // Alvo inexistente, não-presidente ou não-ativo: não há presidência a perder.
  if (!target || target.role !== "presidente" || target.status !== "ativo") {
    return false;
  }

  // Continuar presidente não esvazia a presidência.
  if (newRole === "presidente") {
    return false;
  }

  // Há algum OUTRO presidente ativo que mantenha a presidência do clube?
  const otherActivePresidents = members.filter(
    (m) =>
      m.membershipId !== membershipId &&
      m.role === "presidente" &&
      m.status === "ativo",
  ).length;

  return otherActivePresidents === 0;
}

/** Resultado de `validateRoleChange`: ok, ou erro com mensagem pt-BR. */
export type RoleChangeValidation =
  | { ok: true; role: ClubRole }
  | { ok: false; message: string };

/**
 * Valida uma troca de papel de forma pura, retornando a mesma mensagem pt-BR
 * que a UI exibe. Cobre:
 *   - papel de destino inválido;
 *   - membro inexistente na lista;
 *   - membro não-ativo (só membros ativos têm papel alterável);
 *   - rebaixamento do último presidente (Req 5.5).
 *
 * Não valida autorização do ator (isso é responsabilidade do servidor/RLS);
 * aqui são regras de domínio sobre o estado do clube.
 */
export function validateRoleChange(
  members: readonly MemberRoleView[],
  membershipId: string,
  newRole: unknown,
): RoleChangeValidation {
  if (!isClubRole(newRole)) {
    return { ok: false, message: "Papel inválido." };
  }

  const target = members.find((m) => m.membershipId === membershipId);
  if (!target) {
    return { ok: false, message: "Membro não encontrado." };
  }

  if (target.status !== "ativo") {
    return {
      ok: false,
      message: "Só é possível alterar o papel de membros ativos.",
    };
  }

  if (isLastPresidentDemotion(members, membershipId, newRole)) {
    return { ok: false, message: "O clube precisa de ao menos um presidente." };
  }

  return { ok: true, role: newRole };
}
