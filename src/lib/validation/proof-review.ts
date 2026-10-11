import type { ChargeKind } from "@/lib/validation/charge";

/**
 * Validação e tipos da revisão de comprovantes por admin/tesoureiro
 * (tarefa 9.6, Req 6.6/6.7).
 *
 * A aprovação muda a cobrança para `paga` e gera a receita (Req 6.6); a
 * rejeição volta a cobrança para `pendente` e registra o motivo (Req 6.7). A
 * auditoria de ambas é automática via triggers na tabela `payment_proofs`
 * (migration 2.4), desde que a mutação use o cliente ligado à sessão.
 *
 * Este módulo é puro (sem dependência de servidor), portanto reutilizável no
 * cliente (feedback imediato) e na Server Action (revalidação autoritativa).
 */

/** Status de análise de um comprovante (espelha o CHECK do banco). */
export const PROOF_STATUSES = ["em_analise", "aprovado", "rejeitado"] as const;

export type ProofStatus = (typeof PROOF_STATUSES)[number];

/** Rótulos pt-BR para os status de comprovante. */
export const PROOF_STATUS_LABELS: Record<ProofStatus, string> = {
  em_analise: "Em análise",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
};

/** Tamanho máximo do motivo de rejeição (Req 6.7). */
export const REJECT_REASON_MAX = 300;

/** Resultado da validação do motivo de rejeição. */
export type RejectReasonResult =
  | { ok: true; reason: string }
  | { ok: false; error: string };

/**
 * Valida o motivo de rejeição informado pelo gestor (Req 6.7). O motivo é
 * obrigatório — é ele que fica registrado na auditoria — e limitado a
 * {@link REJECT_REASON_MAX} caracteres.
 *
 * @param value Valor cru vindo de `formData.get("reason")`.
 */
export function validateRejectReason(value: unknown): RejectReasonResult {
  if (typeof value !== "string") {
    return { ok: false, error: "Informe o motivo da rejeição." };
  }
  const reason = value.trim();
  if (reason === "") {
    return { ok: false, error: "Informe o motivo da rejeição." };
  }
  if (reason.length > REJECT_REASON_MAX) {
    return {
      ok: false,
      error: `O motivo deve ter no máximo ${REJECT_REASON_MAX} caracteres.`,
    };
  }
  return { ok: true, reason };
}

/**
 * Linha do comprovante `em_analise` com os dados da cobrança e do jogador,
 * usada na tela de aprovações (join charges + players + payment_proofs).
 */
export interface PendingProofRow {
  proofId: string;
  filePath: string;
  createdAt: string;
  chargeId: string;
  amountCents: number;
  description: string;
  kind: ChargeKind;
  period: string | null;
  dueDate: string;
  playerName: string;
  playerNickname: string | null;
}

/** Estado retornado pelas Server Actions de aprovação/rejeição. */
export interface ProofReviewActionState {
  status: "idle" | "success" | "error";
  message?: string;
}
