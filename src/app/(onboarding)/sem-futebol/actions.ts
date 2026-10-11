"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  solicitarPresidenciaSchema,
  type SolicitarPresidenciaState,
} from "@/lib/validation/president";

/**
 * Server Action: solicitar ser presidente (tarefa 19.1 — Requisitos 2.1, 2.2).
 *
 * Fluxo (executado inteiramente no servidor, sobre a sessão do usuário):
 *   1. valida o formulário (apenas uma observação opcional);
 *   2. confirma que há usuário autenticado;
 *   3. lê o `president_status` atual do próprio perfil;
 *   4. IDEMPOTÊNCIA: se já estiver `pendente` ou `aprovado`, não faz nada
 *      (não duplica a linha em `president_requests` nem rebaixa o estado);
 *   5. caso contrário (`none`), insere a linha de histórico em
 *      `president_requests` (status `pendente`) e promove
 *      `profiles.president_status` para `pendente`.
 *
 * SEGURANÇA: a RLS é a fronteira real. O usuário só pode:
 *   - UPDATE do próprio `profiles` (policy `profiles_update_self`);
 *   - INSERT em `president_requests` com `user_id = auth.uid()` e
 *     status `pendente` (policy `president_requests_insert`).
 * A promoção para `aprovado` (e o preenchimento de `reviewed_by`/`reviewed_at`)
 * é exclusiva do `system_admin` (tarefa 19.2), não deste fluxo.
 *
 * AUDITORIA: não há helper de auditoria no app (o `audit_log` é alimentado por
 * triggers nas tabelas de domínio e não há política de INSERT para o usuário
 * comum). Esta é uma ação de PLATAFORMA (sem `club_id`); a trilha de aprovação
 * fica registrada em `president_requests` e a auditoria da APROVAÇÃO é feita
 * pelo `system_admin` na tarefa 19.2.
 */
export async function solicitarPresidencia(
  _prevState: SolicitarPresidenciaState,
  formData: FormData,
): Promise<SolicitarPresidenciaState> {
  const parsed = solicitarPresidenciaSchema.safeParse({
    note: formData.get("note") ?? undefined,
  });

  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Dados inválidos. Tente novamente.";
    return { status: "error", message };
  }

  const { note } = parsed.data;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      status: "error",
      message: "Sua sessão expirou. Entre novamente para continuar.",
    };
  }

  // Estado atual do pedido de presidência (fonte de verdade: profiles).
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("president_status")
    .eq("id", user.id)
    .maybeSingle<{ president_status: "none" | "pendente" | "aprovado" }>();

  if (profileError) {
    return {
      status: "error",
      message: "Não foi possível verificar sua solicitação. Tente novamente.",
    };
  }

  const current = profile?.president_status ?? "none";

  // IDEMPOTÊNCIA (Req 2.1/2.2): se já pediu (pendente) ou já foi aprovado,
  // não duplica nada e informa sucesso — a tela mostrará o estado atual.
  if (current === "pendente" || current === "aprovado") {
    return { status: "success" };
  }

  // 1) Registra a solicitação no histórico (status 'pendente').
  const { error: requestError } = await supabase
    .from("president_requests")
    .insert({ user_id: user.id, status: "pendente", note: note ?? null });

  if (requestError) {
    return {
      status: "error",
      message: "Não foi possível registrar sua solicitação. Tente novamente.",
    };
  }

  // 2) Promove o estado atual do perfil para 'pendente'.
  const { error: statusError } = await supabase
    .from("profiles")
    .update({ president_status: "pendente" })
    .eq("id", user.id);

  if (statusError) {
    return {
      status: "error",
      message:
        "Sua solicitação foi registrada, mas houve um erro ao atualizar seu status. Atualize a página.",
    };
  }

  // Recarrega a tela de onboarding para refletir o novo estado (pendente).
  revalidatePath("/sem-futebol");

  return { status: "success" };
}
