"use server";

import { revalidatePath } from "next/cache";

import { getMembershipSession, hasClubRole } from "@/lib/auth/membership";
import { createProofSignedUrl } from "@/lib/storage/proofs";
import { createClient } from "@/lib/supabase/server";
import type { ChargeKind, ChargeStatus } from "@/lib/validation/charge";
import {
  type ProofReviewActionState,
  type ProofStatus,
  validateRejectReason,
} from "@/lib/validation/proof-review";

import { generateChargeRevenue, type RevenueChargeRow } from "../cobrancas/data";

/**
 * Server Actions de aprovação/rejeição de comprovantes (tarefa 9.6,
 * Req 6.6/6.7).
 *
 * MULTI-TENANT (tarefa 21): a revisão é escopada ao FUTEBOL ATIVO. Apenas os
 * papéis `presidente` e `tesoureiro` do clube ativo revisam comprovantes; sem
 * futebol ativo a ação é negada. O escopo é garantido aqui filtrando
 * `club_id = clube ativo` ao carregar o comprovante/cobrança (defesa em
 * profundidade) e, de forma autoritativa, pela RLS no Postgres (policy
 * `payment_proofs_manager_update`).
 *
 * Aprovação (Req 6.6): o comprovante precisa estar `em_analise`. Marca o
 * comprovante como `aprovado` (reviewed_by), move a cobrança para `paga`
 * (paid_at = agora) e gera o lançamento de receita vinculado — reutilizando o
 * helper `generateChargeRevenue` compartilhado com `markChargePaid` (tarefa
 * 8.3), de modo que a receita seja gerada EXATAMENTE UMA VEZ.
 *
 * Rejeição (Req 6.7): o comprovante precisa estar `em_analise`. Marca o
 * comprovante como `rejeitado` (reviewed_by, review_note = motivo) e volta a
 * cobrança para `pendente`.
 *
 * Todas as mutações usam o cliente ligado à sessão (`createClient`), portanto
 * os triggers de auditoria da tabela `payment_proofs` capturam o actor e os
 * valores before/after automaticamente (Req 6.6/6.7/11.3).
 */

// ─── Tipos auxiliares ────────────────────────────────────────────────────────

/** Comprovante + cobrança carregados para a revisão. */
interface ProofWithCharge {
  proofId: string;
  proofStatus: ProofStatus;
  charge: RevenueChargeRow & { status: ChargeStatus };
}

interface ProofJoinRow {
  id: string;
  status: ProofStatus;
  charge: {
    id: string;
    club_id: string;
    player_id: string;
    amount_cents: number;
    description: string;
    kind: ChargeKind;
    period: string | null;
    status: ChargeStatus;
    deleted_at: string | null;
  } | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Revalida que o ator é presidente OU tesoureiro do clube ATIVO (Req 6.6/6.7).
 * Retorna `{ ok, clubId, userId }` quando autorizado; caso contrário um estado
 * de erro pronto para a UI. A UI não é a fronteira real (a RLS é), mas esta
 * barreira dá um erro amistoso e evita operar sem clube/contexto.
 */
async function requireManager(): Promise<
  | { ok: true; clubId: string; userId: string }
  | { ok: false; state: ProofReviewActionState }
> {
  const session = await getMembershipSession();
  if (!session) {
    return {
      ok: false,
      state: { status: "error", message: "Sessão expirada. Faça login novamente." },
    };
  }
  if (!session.activeClub) {
    return {
      ok: false,
      state: {
        status: "error",
        message: "Selecione um futebol ativo para revisar comprovantes.",
      },
    };
  }
  if (!hasClubRole(session, "presidente", "tesoureiro")) {
    return {
      ok: false,
      state: {
        status: "error",
        message:
          "Apenas presidente e tesoureiro do futebol podem revisar comprovantes.",
      },
    };
  }
  return { ok: true, clubId: session.activeClub.clubId, userId: session.userId };
}

/** Lê e valida o id do comprovante vindo do FormData. */
function readProofId(formData: FormData): string | null {
  const id = formData.get("proofId");
  if (typeof id !== "string" || id.trim() === "") return null;
  return id.trim();
}

/**
 * Carrega o comprovante e a cobrança vinculada (não excluída) do FUTEBOL ATIVO
 * necessários para a revisão. O filtro `club_id` (no comprovante e na cobrança)
 * impede operar sobre comprovantes de outro futebol mesmo que o id seja
 * conhecido (escopo multi-tenant); a RLS garante que apenas gestores do clube
 * leem comprovantes de terceiros.
 */
async function loadProofWithCharge(
  supabase: Awaited<ReturnType<typeof createClient>>,
  proofId: string,
  clubId: string,
): Promise<ProofWithCharge | null> {
  const { data, error } = await supabase
    .from("payment_proofs")
    .select(
      "id, status, charge:charges!inner(id, club_id, player_id, amount_cents, description, kind, period, status, deleted_at)",
    )
    .eq("id", proofId)
    .eq("club_id", clubId)
    .eq("charge.club_id", clubId)
    .maybeSingle<ProofJoinRow>();

  if (
    error ||
    !data ||
    !data.charge ||
    data.charge.club_id !== clubId ||
    data.charge.deleted_at !== null
  ) {
    return null;
  }

  const { deleted_at: _deleted, ...charge } = data.charge;
  return { proofId: data.id, proofStatus: data.status, charge };
}

// ─── Aprovar comprovante (Req 6.6) ───────────────────────────────────────────

export async function approveProof(
  _prevState: ProofReviewActionState,
  formData: FormData,
): Promise<ProofReviewActionState> {
  const auth = await requireManager();
  if (!auth.ok) return auth.state;

  const proofId = readProofId(formData);
  if (!proofId) {
    return { status: "error", message: "Comprovante não identificado." };
  }

  const supabase = await createClient();
  const loaded = await loadProofWithCharge(supabase, proofId, auth.clubId);
  if (!loaded) {
    return { status: "error", message: "Comprovante não encontrado." };
  }

  // Só comprovantes em análise podem ser aprovados (Req 6.6).
  if (loaded.proofStatus !== "em_analise") {
    return {
      status: "error",
      message: "Este comprovante já foi revisado.",
    };
  }

  // Marca o comprovante como aprovado. O WHERE em `status = 'em_analise'`
  // fecha a janela de corrida (dupla submissão): só uma revisão vinga.
  const { data: reviewed, error: proofError } = await supabase
    .from("payment_proofs")
    .update({ status: "aprovado", reviewed_by: auth.userId })
    .eq("id", proofId)
    .eq("club_id", auth.clubId)
    .eq("status", "em_analise")
    .select("id")
    .maybeSingle<{ id: string }>();

  if (proofError) {
    return {
      status: "error",
      message: `Erro ao aprovar o comprovante: ${proofError.message}`,
    };
  }
  if (!reviewed) {
    return { status: "error", message: "Este comprovante já foi revisado." };
  }

  // Move a cobrança para `paga` (apenas se ainda não estiver paga). O WHERE
  // em `status != 'paga'` evita reescrever `paid_at` de uma cobrança já paga.
  const { error: chargeError } = await supabase
    .from("charges")
    .update({ status: "paga", paid_at: new Date().toISOString() })
    .eq("id", loaded.charge.id)
    .eq("club_id", auth.clubId)
    .neq("status", "paga")
    .is("deleted_at", null);

  if (chargeError) {
    return {
      status: "error",
      message: `Comprovante aprovado, mas falhou ao atualizar a cobrança: ${chargeError.message}`,
    };
  }

  // Gera a receita vinculada (uma única vez) pelo helper compartilhado. Mesmo
  // se a cobrança já estivesse paga, a guarda de idempotência interna evita
  // duplicar a receita (Req 6.6).
  const revenue = await generateChargeRevenue(
    supabase,
    loaded.charge,
    auth.userId,
  );
  if (!revenue.ok) {
    return {
      status: "error",
      message: `Comprovante aprovado, mas ${revenue.message}`,
    };
  }

  revalidatePath("/aprovacoes");
  revalidatePath("/cobrancas");
  revalidatePath("/lancamentos");
  return {
    status: "success",
    message: "Comprovante aprovado, cobrança paga e receita lançada.",
  };
}

// ─── Rejeitar comprovante (Req 6.7) ──────────────────────────────────────────

export async function rejectProof(
  _prevState: ProofReviewActionState,
  formData: FormData,
): Promise<ProofReviewActionState> {
  const auth = await requireManager();
  if (!auth.ok) return auth.state;

  const proofId = readProofId(formData);
  if (!proofId) {
    return { status: "error", message: "Comprovante não identificado." };
  }

  // Motivo da rejeição é obrigatório — fica registrado na auditoria (Req 6.7).
  const reasonResult = validateRejectReason(formData.get("reason"));
  if (!reasonResult.ok) {
    return { status: "error", message: reasonResult.error };
  }

  const supabase = await createClient();
  const loaded = await loadProofWithCharge(supabase, proofId, auth.clubId);
  if (!loaded) {
    return { status: "error", message: "Comprovante não encontrado." };
  }

  if (loaded.proofStatus !== "em_analise") {
    return { status: "error", message: "Este comprovante já foi revisado." };
  }

  // Marca o comprovante como rejeitado com o motivo. O WHERE em
  // `status = 'em_analise'` fecha a janela de corrida.
  const { data: reviewed, error: proofError } = await supabase
    .from("payment_proofs")
    .update({
      status: "rejeitado",
      reviewed_by: auth.userId,
      review_note: reasonResult.reason,
    })
    .eq("id", proofId)
    .eq("club_id", auth.clubId)
    .eq("status", "em_analise")
    .select("id")
    .maybeSingle<{ id: string }>();

  if (proofError) {
    return {
      status: "error",
      message: `Erro ao rejeitar o comprovante: ${proofError.message}`,
    };
  }
  if (!reviewed) {
    return { status: "error", message: "Este comprovante já foi revisado." };
  }

  // Volta a cobrança para `pendente` (apenas se estava `em_analise`); nunca
  // mexe em `paga`/`cancelada`.
  const { error: chargeError } = await supabase
    .from("charges")
    .update({ status: "pendente" })
    .eq("id", loaded.charge.id)
    .eq("club_id", auth.clubId)
    .eq("status", "em_analise")
    .is("deleted_at", null);

  if (chargeError) {
    return {
      status: "error",
      message: `Comprovante rejeitado, mas falhou ao atualizar a cobrança: ${chargeError.message}`,
    };
  }

  revalidatePath("/aprovacoes");
  revalidatePath("/cobrancas");
  return {
    status: "success",
    message: "Comprovante rejeitado. A cobrança voltou para pendente.",
  };
}

// ─── URL assinada do comprovante (gestor) ────────────────────────────────────

/**
 * Gera uma URL assinada de curta duração para o gestor visualizar o
 * comprovante (Req 6.5/11.2). Restrita a presidente/tesoureiro do clube ATIVO;
 * o bucket é privado e nunca servido por URL pública. A autoridade final de
 * acesso ao objeto é a RLS de Storage (escopada por `club_id` no caminho).
 *
 * @param path Caminho do objeto no bucket (`payment_proofs.file_path`).
 */
export async function getProofSignedUrl(
  path: string,
): Promise<{ url: string } | { error: string }> {
  const session = await getMembershipSession();
  if (!session?.activeClub || !hasClubRole(session, "presidente", "tesoureiro")) {
    return {
      error: "Apenas presidente e tesoureiro do futebol podem ver comprovantes.",
    };
  }

  if (typeof path !== "string" || path.trim() === "") {
    return { error: "Comprovante inválido." };
  }

  try {
    const url = await createProofSignedUrl(path.trim());
    return { url };
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Falha ao gerar o link do comprovante.",
    };
  }
}
