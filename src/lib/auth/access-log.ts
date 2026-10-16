import "server-only";

import { headers } from "next/headers";

import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Auditoria de ACESSO (login e reset de senha) — §3.6.
 *
 * A gravação usa o cliente de SERVICE ROLE porque `access_logs` só tem policy
 * de SELECT (apenas admin da plataforma lê) e nenhuma policy de insert: a
 * escrita é um privilégio do servidor confiável, não do cliente/sessão. Isso
 * vale também para o registro de LOGIN, disparado logo após a autenticação.
 *
 * `recordAccessEvent` nunca lança: uma falha de auditoria não pode derrubar o
 * fluxo de login ou de reset. Em caso de erro, apenas registra no console.
 */

const USER_AGENT_MAX_LENGTH = 500;

export interface AccessEventInput {
  eventType: "login" | "password_reset";
  actorUserId: string;
  targetUserId: string;
  clubId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Insere um evento de acesso em `access_logs` via service role. O `userAgent`
 * é truncado a 500 caracteres aqui, no helper, para não propagar o limite aos
 * chamadores. Nunca lança: erros são apenas logados.
 */
export async function recordAccessEvent(event: AccessEventInput): Promise<void> {
  try {
    const supabase = createServiceRoleClient();

    const { error } = await supabase.from("access_logs").insert({
      event_type: event.eventType,
      actor_user_id: event.actorUserId,
      target_user_id: event.targetUserId,
      club_id: event.clubId ?? null,
      ip: event.ip ?? null,
      user_agent: event.userAgent?.slice(0, USER_AGENT_MAX_LENGTH) ?? null,
    });

    if (error) {
      console.error("[access-log] falha ao registrar evento de acesso:", error);
    }
  } catch (err) {
    console.error("[access-log] erro inesperado ao registrar acesso:", err);
  }
}

/**
 * Lê os cabeçalhos da requisição atual para extrair IP e user-agent do
 * dispositivo que originou o acesso. O IP vem do primeiro valor de
 * `x-forwarded-for` (o cliente, antes dos proxies).
 */
export async function captureRequestMeta(): Promise<{
  ip: string | null;
  userAgent: string | null;
}> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");

  return {
    ip: xff?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent") ?? null,
  };
}
