"use server";

import { revalidatePath } from "next/cache";

import {
  getMembershipSession,
  hasClubRole,
} from "@/lib/auth/membership";
import { isClubRole } from "@/lib/clubs/roles";
import { createClient } from "@/lib/supabase/server";

import type { RoleActionState } from "./role-action-state";

/**
 * Server Action de promoção/rebaixamento de papéis (tarefa 20.4).
 *
 * ARQUIVO SEPARADO de propósito: a tarefa 20.3 cuida de aprovar/recusar
 * membros PENDENTES em `(app)/membros/actions.ts`. Esta ação lida com a gestão
 * de PAPÉIS dos membros ATIVOS e vive em `role-actions.ts` para não colidir com
 * aquele arquivo.
 *
 * Fluxo (Req 5.1/5.5/5.6):
 *   1) exige que o ATOR seja presidente do clube ATIVO (defesa em profundidade
 *      além da RLS/RPC);
 *   2) chama a RPC `set_member_role`, que no banco revalida o presidente-ator,
 *      aplica a troca e CONFIA no trigger `guard_last_president` para impedir o
 *      rebaixamento do ÚLTIMO presidente ativo (Req 5.5), à prova de corrida;
 *   3) a própria RPC registra a auditoria com `club_id` (Req 5.6) — a função
 *      genérica de auditoria não cobre `memberships`;
 *   4) traduz os erros do Postgres para mensagens pt-BR claras.
 *
 * A autoridade real continua sendo o banco (RPC + trigger + RLS); as checagens
 * aqui são de UX (feedback rápido) e defesa em profundidade.
 *
 * Requisitos: 5.1, 5.5, 5.6.
 */

/**
 * SQLSTATEs emitidos pela RPC `set_member_role` e pelo trigger
 * `guard_last_president`, mapeados para mensagens pt-BR exibíveis.
 */
const PG_ERROR_MESSAGE: Record<string, string> = {
  // trigger guard_last_president / validações de estado da RPC
  "23514": "O clube precisa de ao menos um presidente.",
  // ator não é presidente do clube
  "42501": "Apenas o presidente do futebol pode alterar papéis.",
  // sessão sem auth.uid()
  "28000": "Sessão expirada. Entre novamente para alterar papéis.",
  // papel de destino inválido
  "22023": "Papel inválido.",
  // membership-alvo não encontrada
  P0002: "Membro não encontrado.",
};

/**
 * Altera o papel (`memberships.role`) de um membro ativo do clube ativo.
 *
 * @param membershipId Membership-alvo (membro ativo do clube).
 * @param novoPapel Novo papel: `jogador` | `tesoureiro` | `presidente`.
 */
export async function alterarPapel(
  membershipId: string,
  novoPapel: string,
): Promise<RoleActionState> {
  // Entrada mínima.
  if (typeof membershipId !== "string" || membershipId.trim() === "") {
    return { status: "error", message: "Membro não identificado." };
  }
  if (!isClubRole(novoPapel)) {
    return { status: "error", message: "Papel inválido." };
  }

  // Autorização de UX: ator precisa ser presidente do clube ATIVO (Req 5.5).
  const session = await getMembershipSession();
  if (!session) {
    return {
      status: "error",
      message: "Sessão expirada. Entre novamente para alterar papéis.",
    };
  }
  if (session.hasNoClub || !session.activeClub) {
    return {
      status: "error",
      message: "Selecione um futebol ativo para gerenciar membros.",
    };
  }
  if (!hasClubRole(session, "presidente")) {
    return {
      status: "error",
      message: "Apenas o presidente do futebol pode alterar papéis.",
    };
  }

  // Troca de papel pela porta oficial: RPC + trigger (guarda do último
  // presidente) + auditoria com club_id, tudo no banco numa só transação.
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_member_role", {
    p_membership_id: membershipId.trim(),
    p_role: novoPapel,
  });

  if (error) {
    const message =
      (error.code && PG_ERROR_MESSAGE[error.code]) ||
      "Não foi possível alterar o papel. Tente novamente.";
    return { status: "error", message };
  }

  // Revalida a sub-rota de papéis (e a de membros da 20.3, se existir).
  revalidatePath("/membros/papeis");
  revalidatePath("/membros");

  return { status: "success", message: "Papel atualizado." };
}

/**
 * Adaptador para `<form action>` + `useFormState`: lê `membershipId` e `role`
 * do FormData e delega para `alterarPapel`.
 */
export async function alterarPapelFormAction(
  _prevState: RoleActionState,
  formData: FormData,
): Promise<RoleActionState> {
  const membershipId = formData.get("membershipId");
  const role = formData.get("role");

  return alterarPapel(
    typeof membershipId === "string" ? membershipId : "",
    typeof role === "string" ? role : "",
  );
}
