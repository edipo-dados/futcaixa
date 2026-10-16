"use server";

import { z } from "zod";

import { recordAccessEvent, captureRequestMeta } from "@/lib/auth/access-log";
import { getMembershipSession } from "@/lib/auth/membership";
import { generateTempPassword } from "@/lib/auth/temp-password";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

import { mapResetError } from "./reset-password-error";

/**
 * Reset de senha de um jogador pelo PRESIDENTE (§3.7).
 *
 * Fluxo: o presidente dispara o reset na tela /jogadores. A autorização é
 * delegada à RPC `authorize_password_reset` (SECURITY DEFINER, FEAT-001), que
 * valida sessão/papel/escopo e devolve o `target_user_id` + `club_id` da
 * membership ativa vinculada ao jogador. O servidor então troca a senha via
 * Admin API (service role), registra o evento de auditoria e devolve a senha
 * temporária — mostrada UMA vez ao presidente, que a repassa ao jogador.
 *
 * A senha temporária fica SÓ no retorno desta action: nunca é persistida nem
 * logada. A guarda de sessão/papel no servidor é defesa em profundidade; a RPC
 * (e a RLS) são a autoridade final.
 */

/**
 * Estado da Server Action de reset. `tempPassword` só é preenchido no sucesso e
 * existe apenas para a UI exibir a senha uma vez — não deve ser persistido.
 */
export interface ResetPasswordState {
  status: "idle" | "success" | "error";
  message?: string;
  tempPassword?: string;
}

const playerIdSchema = z.string().uuid();

interface AuthorizeRow {
  target_user_id: string;
  club_id: string;
}

export async function resetPlayerPassword(
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  // (1) Guarda de sessão/papel ANTES de usar session.userId (defesa em
  // profundidade; a RPC reconfirma no banco).
  const session = await getMembershipSession();
  if (!session) {
    return { status: "error", message: "Sua sessão expirou. Entre novamente." };
  }
  if (session.role !== "presidente") {
    return { status: "error", message: "Apenas o presidente pode resetar." };
  }

  // (2) Valida o playerId recebido do formulário.
  const parsed = playerIdSchema.safeParse(formData.get("playerId"));
  if (!parsed.success) {
    return { status: "error", message: "Jogador não identificado." };
  }
  const playerId = parsed.data;

  // (3) Autorização + resolução do usuário-alvo via RPC (sessão/RLS).
  // A RPC `authorize_password_reset` ainda não está nos tipos gerados do
  // Supabase (migration não aplicada), então o supabase-js não conhece seu
  // retorno; normalizamos para o primeiro registro validando a forma.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("authorize_password_reset", {
    p_player_id: playerId,
  });

  if (error) {
    return {
      status: "error",
      message: mapResetError((error as { code?: string }).code ?? ""),
    };
  }

  const rows = (Array.isArray(data) ? data : []) as AuthorizeRow[];
  const row = rows[0];
  if (!row || typeof row.target_user_id !== "string") {
    return { status: "error", message: mapResetError("22023") };
  }
  const { target_user_id: targetUserId, club_id: clubId } = row;

  // (4) Gera a senha temporária (nunca logada/persistida).
  const password = generateTempPassword();

  // (5) Troca a senha via Admin API (service role, bypass de RLS).
  const { error: adminErr } = await createServiceRoleClient().auth.admin.updateUserById(
    targetUserId,
    { password },
  );
  if (adminErr) {
    // Nunca logar a senha, apenas o erro.
    console.error("[reset-password] falha ao atualizar senha via Admin API:", adminErr);
    return {
      status: "error",
      message: "Não foi possível resetar a senha. Tente novamente.",
    };
  }

  // (6) Registra o evento de auditoria (não lança).
  const { ip, userAgent } = await captureRequestMeta();
  await recordAccessEvent({
    eventType: "password_reset",
    actorUserId: session.userId,
    targetUserId,
    clubId,
    ip,
    userAgent,
  });

  // (7) Devolve a senha temporária SÓ no estado (mostrada uma vez).
  return { status: "success", tempPassword: password };
}
