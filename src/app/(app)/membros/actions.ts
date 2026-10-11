"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getMembershipSession } from "@/lib/auth/membership";
import {
  canManageMembers,
  messageForReason,
  parseApprovalPlayerType,
  reasonFromPgCode,
} from "@/lib/clubs/approveMember";
import { createClient } from "@/lib/supabase/server";

/**
 * Server Actions da tela de membros (tarefa 20.3 — Requisitos 4.5, 4.6, 4.7,
 * 4.8, 4.9).
 *
 * APROVAR (`aprovarMembro`):
 *   1. valida o guard de presidente do clube ATIVO via sessão (Req 4.8) — a UI
 *      não é a fronteira real, apenas uma primeira barreira amistosa;
 *   2. valida o tipo escolhido (`mensalista`/`avulso`, Req 4.6);
 *   3. chama a RPC atômica `approve_member(p_membership_id, p_tipo)` (migration
 *      20250101000028), que numa única transação cria o `players` do clube,
 *      vincula `memberships.player_id`, muda `status` para `ativo` e audita
 *      (Req 4.6/4.9). `avulso` é gravado como `players.type='avulso'` e por isso
 *      NÃO entra na geração de mensalidades (Req 4.7). A RPC revalida a
 *      autorização por dentro (presidente ativo do clube da membership).
 *
 * RECUSAR (`recusarMembro`):
 *   - valida o guard de presidente e faz um UPDATE direto
 *     `status = 'recusado'` da membership do clube ativo. A RLS de `memberships`
 *     (migration 20250101000020) só permite UPDATE ao presidente do clube, de
 *     modo que a autoridade final está no banco.
 *
 * SEGURANÇA: tanto a RPC (aprovar) quanto a RLS (recusar) garantem que apenas o
 * presidente do clube correto atua. O escopo é sempre o clube ATIVO da sessão —
 * passar o `membershipId` de outro clube não vaza nada (a RPC checa o papel no
 * clube da própria membership; a RLS idem).
 */

/** Estado retornado pelas ações, consumido pelos Client Components. */
export interface MembroActionState {
  status: "idle" | "success" | "error";
  message?: string;
}

/** `membershipId` precisa ser um UUID. */
const membershipIdSchema = z.string().uuid("Membro inválido.");

/** `playerId` (opcional, para vincular) precisa ser um UUID quando presente. */
const playerIdSchema = z.string().uuid("Jogador selecionado inválido.");

/**
 * Revalida que o ator é presidente do clube ativo (Req 4.8). Retorna o
 * `userId` do ator e o `clubId` ativo quando ok; caso contrário uma mensagem
 * pronta para a UI.
 */
async function requirePresident(): Promise<
  | { ok: true; userId: string; clubId: string }
  | { ok: false; message: string }
> {
  const session = await getMembershipSession();
  if (!session) {
    return { ok: false, message: "Sua sessão expirou. Entre novamente." };
  }
  if (!canManageMembers(session.role) || !session.activeClub) {
    return {
      ok: false,
      message: "Apenas o presidente do futebol pode gerenciar membros.",
    };
  }
  return { ok: true, userId: session.userId, clubId: session.activeClub.clubId };
}

/**
 * Aprova um membro pendente, criando/vinculando um `players` do clube com o
 * tipo escolhido e ativando a membership (Req 4.5, 4.6, 4.7, 4.9).
 */
export async function aprovarMembro(
  _prevState: MembroActionState,
  formData: FormData,
): Promise<MembroActionState> {
  const parsedId = membershipIdSchema.safeParse(formData.get("membershipId"));
  if (!parsedId.success) {
    return { status: "error", message: parsedId.error.issues[0].message };
  }

  const tipo = parseApprovalPlayerType(formData.get("tipo"));
  if (tipo === null) {
    return {
      status: "error",
      message: "Escolha o tipo do jogador (mensalista ou avulso).",
    };
  }

  // playerId é OPCIONAL: quando presente, vincula a membership a um jogador já
  // cadastrado (em vez de criar um novo). Vazio/ausente → cria o jogador.
  const rawPlayerId = formData.get("playerId");
  const playerId =
    typeof rawPlayerId === "string" && rawPlayerId.trim() !== ""
      ? rawPlayerId.trim()
      : null;

  if (playerId !== null && !playerIdSchema.safeParse(playerId).success) {
    return { status: "error", message: "Jogador selecionado inválido." };
  }

  const auth = await requirePresident();
  if (!auth.ok) {
    return { status: "error", message: auth.message };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_member", {
    p_membership_id: parsedId.data,
    p_tipo: tipo,
    p_player_id: playerId,
  });

  if (error) {
    return {
      status: "error",
      message: messageForReason(reasonFromPgCode(error.code)),
    };
  }

  revalidatePath("/membros");
  return { status: "success" };
}

/**
 * Recusa um membro pendente, mudando `status` para `recusado` (Req 4.5). A RLS
 * garante que só o presidente do clube possa fazê-lo; filtramos por
 * `club_id` ativo e `status='pendente'` para não reescrever membros já
 * resolvidos (idempotência amistosa).
 */
export async function recusarMembro(
  _prevState: MembroActionState,
  formData: FormData,
): Promise<MembroActionState> {
  const parsedId = membershipIdSchema.safeParse(formData.get("membershipId"));
  if (!parsedId.success) {
    return { status: "error", message: parsedId.error.issues[0].message };
  }

  const auth = await requirePresident();
  if (!auth.ok) {
    return { status: "error", message: auth.message };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("memberships")
    .update({ status: "recusado" })
    .eq("id", parsedId.data)
    .eq("club_id", auth.clubId)
    .eq("status", "pendente");

  if (error) {
    return {
      status: "error",
      message: "Não foi possível recusar o membro. Tente novamente.",
    };
  }

  revalidatePath("/membros");
  return { status: "success" };
}
