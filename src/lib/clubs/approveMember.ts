/**
 * Lógica pura (sem I/O) de aprovação/recusa de membros (tarefa 20.3).
 *
 * Concentra as regras testáveis isoladamente, SEM depender do Supabase nem de
 * `server-only`, para que os testes rodem sem banco:
 *   - validação do tipo de jogador escolhido na aprovação (`mensalista`/
 *     `avulso`) — Req 4.6;
 *   - guarda de autorização "é presidente do clube ativo?" — Req 4.8;
 *   - tradução dos códigos de erro (SQLSTATE) emitidos pela RPC
 *     `approve_member` para mensagens pt-BR tratáveis pela UI — Req 4.8.
 *
 * As Server Actions em `app/(app)/membros/actions.ts` compõem estas funções
 * puras com a chamada à RPC atômica `approve_member` (migration
 * 20250101000028), que é a fronteira REAL de atomicidade e autorização (a RLS
 * é a autoridade final).
 */

import type { ClubRole } from "@/lib/auth/membership";

/**
 * Tipos de jogador aprováveis nesta tela. `convidado` existe no domínio de
 * `players`, mas não é opção de aprovação de membro (design.md fluxo 5): o
 * presidente escolhe entre `mensalista` e `avulso`.
 */
export const APPROVAL_PLAYER_TYPES = ["mensalista", "avulso"] as const;

/** Tipo de jogador escolhido ao aprovar um membro. */
export type ApprovalPlayerType = (typeof APPROVAL_PLAYER_TYPES)[number];

/**
 * Valida o tipo escolhido na aprovação. Retorna o tipo normalizado quando é um
 * dos valores aceitos (`mensalista`/`avulso`), ou `null` caso contrário —
 * assim a Server Action trata entrada inválida sem lançar (Req 4.6).
 *
 * `avulso` é relevante para o Req 4.7: um membro aprovado como `avulso` é
 * gravado em `players` com `type = 'avulso'` e, por isso, IGNORADO pela geração
 * automática de mensalidades (o filtro em `lib/players/active-mensalistas.ts`
 * só considera `type = 'mensalista'`).
 */
export function parseApprovalPlayerType(
  value: unknown,
): ApprovalPlayerType | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return (APPROVAL_PLAYER_TYPES as readonly string[]).includes(normalized)
    ? (normalized as ApprovalPlayerType)
    : null;
}

/**
 * Guarda de autorização da tela de membros (Req 4.8): só o presidente do clube
 * ATIVO pode aprovar/recusar membros.
 *
 * Recebe o papel do usuário no clube ativo (de `getMembershipSession().role`,
 * fonte: `memberships`, Req 5.3) e devolve `true` apenas quando for
 * `presidente`. `tesoureiro`/`jogador`/sem-clube (null) NÃO podem.
 *
 * Observação: `isSystemAdmin` NÃO é tratado aqui como "pode aprovar" — a gestão
 * de membros é uma ação de CLUBE (presidente), não de plataforma. O bypass do
 * system_admin existe na RLS para administração, mas a tela de membros é do
 * presidente; manter a guarda estrita evita um admin "aprovar sem contexto".
 */
export function canManageMembers(role: ClubRole | null | undefined): boolean {
  return role === "presidente";
}

/** Classe de erro da aprovação/recusa, para a UI decidir a mensagem. */
export type ApproveMemberErrorReason =
  | "unauthenticated"
  | "not_president"
  | "invalid_type"
  | "not_found"
  | "invalid_state"
  | "already_linked"
  | "unknown";

/**
 * Códigos de erro (SQLSTATE) emitidos pela RPC `approve_member`, mapeados para
 * a classe tratável pela UI. Mantê-los sincronizados com a migration
 * 20250101000028_approve_member_rpc.sql.
 */
const PG_ERROR_REASON: Record<string, ApproveMemberErrorReason> = {
  "28000": "unauthenticated", // auth.uid() nulo
  "42501": "not_president", // club_role != 'presidente'
  "22023": "invalid_type", // tipo inválido OU estado não-pendente
  "23505": "already_linked", // jogador escolhido já vinculado a outro membro
  P0002: "not_found", // membership OU jogador escolhido inexistente no clube
};

/** Mensagens pt-BR para cada classe de erro. */
const REASON_MESSAGE: Record<ApproveMemberErrorReason, string> = {
  unauthenticated: "Sua sessão expirou. Entre novamente.",
  not_president: "Apenas o presidente do futebol pode gerenciar membros.",
  invalid_type: "Não foi possível aprovar: tipo de jogador inválido.",
  not_found: "Membro ou jogador não encontrado. Atualize a página.",
  invalid_state: "Este membro não está mais pendente. Atualize a página.",
  already_linked: "Este jogador já está vinculado a outro membro.",
  unknown: "Não foi possível concluir a ação. Tente novamente.",
};

/**
 * Traduz um código SQLSTATE da RPC para a classe de erro tratável pela UI.
 * Códigos desconhecidos (ou ausência de código) caem em `unknown`.
 */
export function reasonFromPgCode(
  code: string | null | undefined,
): ApproveMemberErrorReason {
  if (code && code in PG_ERROR_REASON) {
    return PG_ERROR_REASON[code];
  }
  return "unknown";
}

/** Mensagem pt-BR pronta para exibição a partir da classe de erro. */
export function messageForReason(reason: ApproveMemberErrorReason): string {
  return REASON_MESSAGE[reason];
}
