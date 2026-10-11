"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { joinClubAsPlayer } from "@/lib/clubs/invite";
import { joinClubSchema, type JoinClubState } from "@/lib/validation/invite";

/**
 * Nome do cookie que lembra o convite em andamento (ver middleware). Limpamos
 * assim que o convite é consumido para não reentrar no fluxo de retomada.
 */
const PENDING_INVITE_COOKIE = "fc_pending_invite";

/** Remove o cookie de convite pendente (idempotente). */
async function clearPendingInviteCookie(): Promise<void> {
  const store = await cookies();
  store.delete(PENDING_INVITE_COOKIE);
}

/**
 * Server Action: entrar em um futebol a partir de um convite (tarefa 20.2).
 *
 * Fluxo (sobre a sessão do usuário autenticado):
 *   1. valida o `clubId` recebido do formulário (UUID — defesa em profundidade,
 *      já que a RLS é a autoridade real);
 *   2. chama `joinClubAsPlayer`, que cria OU reaproveita a membership
 *      `jogador`/`pendente` de forma idempotente (Req 4.3);
 *   3. traduz o resultado para o estado da UI:
 *        - `pendente` → "aguardando aprovação do presidente" (Req 4.4);
 *        - `ativo`    → o usuário já é membro ativo: redireciona ao painel;
 *        - `recusado` → informa que o pedido foi recusado;
 *        - falhas     → mensagem de erro em pt-BR.
 *
 * SEGURANÇA: a RLS (`memberships_insert`) só permite o INSERT quando
 * `user_id = auth.uid()`, `status = 'pendente'` e `role = 'jogador'`. Um
 * `clubId` indevido não concede acesso: a membership nasce `pendente` e os
 * dados do clube seguem bloqueados até a aprovação do presidente.
 */
export async function entrarNoFutebol(
  _prevState: JoinClubState,
  formData: FormData,
): Promise<JoinClubState> {
  const parsed = joinClubSchema.safeParse({
    clubId: formData.get("clubId"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Convite inválido. Abra o link de convite novamente.",
    };
  }

  const result = await joinClubAsPlayer(parsed.data.clubId);

  if (!result.ok) {
    return { status: "error", message: result.message };
  }

  // Convite consumido (pendente/ativo/recusado): o cookie de retomada já
  // cumpriu seu papel. Limpamos para não reentrar no fluxo de convite depois.
  await clearPendingInviteCookie();

  // Já é membro ativo → não faz sentido ficar na tela de convite.
  if (result.status === "ativo") {
    redirect("/dashboard");
  }

  if (result.status === "recusado") {
    return {
      status: "error",
      message:
        "Seu pedido para este futebol foi recusado pelo presidente. Fale com ele se achar que foi engano.",
    };
  }

  // `pendente` (recém-criado ou reaproveitado) → aguardando aprovação.
  return { status: "pending" };
}
