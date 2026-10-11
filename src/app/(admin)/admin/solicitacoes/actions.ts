"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getMembershipSession } from "@/lib/auth/membership";
import { isPlatformAdmin } from "@/lib/auth/platform-admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Server Actions da tela de solicitações de presidente (tarefa 19.2 —
 * Requisitos 2.3, 2.4, 2.5, 2.6, 17.3).
 *
 * Fluxo de APROVAR:
 *   1. revalida a autoridade do ator (`system_admin`) via sessão — NÃO confia
 *      na UI (Req 2.5);
 *   2. UPDATE `profiles.president_status = 'aprovado'` do alvo (Req 2.4/2.6);
 *   3. UPDATE da linha PENDENTE de `president_requests` do alvo, marcando
 *      `status='aprovado'`, `reviewed_by = ator` e `reviewed_at = now()` — essa
 *      é a trilha/auditoria da revisão (Req 17.3; não há helper de auditoria no
 *      app para esta ação de plataforma, então a trilha vive em
 *      `president_requests`).
 *   4. revalida a rota para refletir o novo estado.
 *
 * RECUSAR é análogo: marca `status='recusado'` (com `reviewed_by`/`reviewed_at`)
 * e devolve `profiles.president_status` para `none`.
 *
 * IDEMPOTÊNCIA: a mutação de `profiles` é um "set" absoluto (aprovado/none) e a
 * de `president_requests` filtra por `status='pendente'`; repetir a ação não
 * duplica nada nem revê linhas já revisadas.
 *
 * SEGURANÇA: a RLS é a fronteira real — só o `system_admin` pode atualizar
 * `president_requests`/`profiles` de terceiros (Req 17.3). A checagem aqui
 * evita trabalho e dá uma mensagem clara, mas não é a única barreira.
 */

/** Estado retornado pelas ações, consumido pelos Client Components dos botões. */
export interface RevisaoPresidenteState {
  status: "idle" | "success" | "error";
  message?: string;
}

/** Valida o `userId` do alvo (precisa ser um UUID). */
const userIdSchema = z.string().uuid("Solicitação inválida.");

/** Valida a observação opcional da recusa (espelha `president_requests.note`). */
const noteSchema = z
  .string()
  .trim()
  .max(500, "A observação deve ter no máximo 500 caracteres.")
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null));

/**
 * Revalida que o ator da ação é `system_admin`. Retorna o `userId` do ator em
 * caso positivo, ou uma mensagem de erro pronta para a UI caso contrário.
 */
async function requireSystemAdmin(): Promise<
  { ok: true; actorId: string } | { ok: false; message: string }
> {
  const session = await getMembershipSession();
  if (!session) {
    return { ok: false, message: "Sua sessão expirou. Entre novamente." };
  }
  if (!isPlatformAdmin(session)) {
    return {
      ok: false,
      message: "Apenas o administrador da plataforma pode revisar solicitações.",
    };
  }
  return { ok: true, actorId: session.userId };
}

/**
 * Aprova a solicitação de presidência do usuário `userId` (Req 2.3, 2.4, 2.6).
 */
export async function aprovarPresidente(
  _prevState: RevisaoPresidenteState,
  formData: FormData,
): Promise<RevisaoPresidenteState> {
  const parsedUser = userIdSchema.safeParse(formData.get("userId"));
  if (!parsedUser.success) {
    return { status: "error", message: parsedUser.error.issues[0].message };
  }
  const targetUserId = parsedUser.data;

  const auth = await requireSystemAdmin();
  if (!auth.ok) {
    return { status: "error", message: auth.message };
  }

  const supabase = await createClient();

  // 1) Estado atual do perfil: 'aprovado' (Req 2.6).
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ president_status: "aprovado" })
    .eq("id", targetUserId);

  if (profileError) {
    return {
      status: "error",
      message: "Não foi possível aprovar a solicitação. Tente novamente.",
    };
  }

  // 2) Trilha de revisão: marca a linha PENDENTE como aprovada (Req 17.3).
  const { error: requestError } = await supabase
    .from("president_requests")
    .update({
      status: "aprovado",
      reviewed_by: auth.actorId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("user_id", targetUserId)
    .eq("status", "pendente");

  if (requestError) {
    return {
      status: "error",
      message:
        "O status foi atualizado, mas houve um erro ao registrar a revisão. Atualize a página.",
    };
  }

  revalidatePath("/admin/solicitacoes");
  return { status: "success" };
}

/**
 * Recusa a solicitação de presidência do usuário `userId` (Req 2.5 — a ação é
 * do `system_admin`). Devolve `profiles.president_status` para `none` e marca a
 * linha pendente como `recusado`, com `reviewed_by`/`reviewed_at` e `note`.
 */
export async function recusarPresidente(
  _prevState: RevisaoPresidenteState,
  formData: FormData,
): Promise<RevisaoPresidenteState> {
  const parsedUser = userIdSchema.safeParse(formData.get("userId"));
  if (!parsedUser.success) {
    return { status: "error", message: parsedUser.error.issues[0].message };
  }
  const targetUserId = parsedUser.data;

  const parsedNote = noteSchema.safeParse(formData.get("note") ?? undefined);
  if (!parsedNote.success) {
    return { status: "error", message: parsedNote.error.issues[0].message };
  }
  const note = parsedNote.data;

  const auth = await requireSystemAdmin();
  if (!auth.ok) {
    return { status: "error", message: auth.message };
  }

  const supabase = await createClient();

  // 1) Volta o estado do perfil para 'none' (o usuário poderá pedir de novo).
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ president_status: "none" })
    .eq("id", targetUserId);

  if (profileError) {
    return {
      status: "error",
      message: "Não foi possível recusar a solicitação. Tente novamente.",
    };
  }

  // 2) Trilha de revisão: marca a linha PENDENTE como recusada (Req 17.3).
  const { error: requestError } = await supabase
    .from("president_requests")
    .update({
      status: "recusado",
      reviewed_by: auth.actorId,
      reviewed_at: new Date().toISOString(),
      note,
    })
    .eq("user_id", targetUserId)
    .eq("status", "pendente");

  if (requestError) {
    return {
      status: "error",
      message:
        "O status foi atualizado, mas houve um erro ao registrar a revisão. Atualize a página.",
    };
  }

  revalidatePath("/admin/solicitacoes");
  return { status: "success" };
}
