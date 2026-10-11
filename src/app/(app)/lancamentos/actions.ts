"use server";

import { revalidatePath } from "next/cache";

import { getMembershipSession } from "@/lib/auth/membership";
import { createClient } from "@/lib/supabase/server";
import { createProofSignedUrl, uploadProof } from "@/lib/storage/proofs";
import {
  type TransactionActionState,
  type TransactionDeleteActionState,
  type TransactionFormValues,
  type TransactionInput,
  type TransactionRow,
  transactionSchema,
} from "@/lib/validation/transaction";

/**
 * Server Actions de Lançamentos (Requisitos 9.1, 9.7, 9.9, 9.11).
 *
 * MULTI-TENANT (tarefa 21.4): o CRUD de `transactions` é escopado ao FUTEBOL
 * ATIVO (`club_id`). Apenas `presidente` ou `tesoureiro` do clube ativo criam,
 * editam ou excluem lançamentos daquele futebol (Req 9.11). A regra é garantida
 * aqui (verificação de papel + escopo explícito de `club_id`) e, de forma
 * autoritativa, pela RLS no Postgres.
 *
 * O `club_id` é SEMPRE o do clube ativo da sessão (`session.activeClub.clubId`),
 * nunca vindo do formulário: no insert ele é injetado; nas edições e no soft
 * delete ele compõe o `where`, de modo que uma linha de outro clube jamais seja
 * alvo (defesa em profundidade com a RLS). A categoria e o jogador vinculados
 * precisam ser do MESMO clube (Req 9.7) — os dropdowns já chegam filtrados por
 * `club_id` (ver data.ts) e a RLS/FK compostas por `club_id` reforçam no banco.
 * Toda entrada passa pelo `transactionSchema` (revalidação no servidor), que
 * rejeita valores ≤ 0 (Req 9 — valores monetários sempre > 0).
 *
 * Auditoria (Req 9.9): NÃO há log manual no app — o trigger genérico de
 * auditoria (migration de auditoria) captura before/after (snapshots `to_jsonb`
 * da linha, que incluem a coluna `club_id`) e o `actor_id` via `auth.uid()`. Por
 * isso TODAS as mutações usam o cliente ligado à sessão do usuário
 * (`createClient`), garantindo que `auth.uid()` esteja disponível para o
 * trigger. Observação de escopo: o trigger genérico não preenche a coluna
 * `audit_log.club_id` diretamente; o `club_id` do lançamento fica preservado
 * dentro de `before/after`. Alterar o trigger para popular a coluna está FORA do
 * escopo desta tarefa — aqui garantimos apenas que a linha de `transactions`
 * carrega o `club_id` correto (a auditoria lê da própria linha).
 *
 * Comprovante (Req 9 — caminho com o `club_id`): quando enviado, o arquivo vai
 * para o bucket privado `proofs` via `uploadProof`, em um caminho ESCOPADO POR
 * CLUBE cujo primeiro segmento é o `club_id`
 * (`<club_id>/transactions/<...>/<arquivo>`). Isso satisfaz a policy de RLS do
 * Storage (migration 20250101000024), que resolve a autorização pelo primeiro
 * segmento (= club_id) via `club_role`. O caminho é persistido em
 * `transactions.proof_path` e a leitura na UI acontece por URL assinada
 * (`getProofUrl`).
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

const UPLOAD_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_PROOF_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

/**
 * Resultado da guarda de acesso: ou devolve um erro pronto (sem clube ativo ou
 * papel insuficiente), ou o `clubId` do clube ativo para escopar as operações.
 */
type Guard =
  | { ok: false; state: TransactionActionState }
  | { ok: true; clubId: string };

/**
 * Garante que há um clube ativo e que o usuário é `presidente` ou `tesoureiro`
 * nele (Req 9.11). Retorna o `club_id` ativo para escopar todas as queries da
 * action. A UI não é a fronteira real (a RLS é), mas esta barreira dá um erro
 * amistoso e evita escritas sem clube/contexto.
 */
async function requireManager(): Promise<Guard> {
  const session = await getMembershipSession();

  if (!session || session.hasNoClub || !session.activeClub) {
    return {
      ok: false,
      state: {
        status: "error",
        message: "Selecione um futebol ativo para gerenciar lançamentos.",
      },
    };
  }

  if (session.role !== "presidente" && session.role !== "tesoureiro") {
    return {
      ok: false,
      state: {
        status: "error",
        message:
          "Apenas o presidente ou o tesoureiro do futebol podem gerenciar lançamentos.",
      },
    };
  }

  return { ok: true, clubId: session.activeClub.clubId };
}

/** Extrai os campos do FormData no formato esperado pelo schema. */
function readFormData(formData: FormData): Record<string, unknown> {
  return {
    kind: formData.get("kind"),
    amountCents: formData.get("amountCents"),
    occurredOn: formData.get("occurredOn"),
    categoryId: formData.get("categoryId"),
    description: formData.get("description"),
    playerId: formData.get("playerId"),
  };
}

/** Mapeia os erros do Zod para o formato `fieldErrors` do estado. */
function toFieldErrors(
  issues: { path: (string | number)[]; message: string }[],
): Partial<Record<keyof TransactionFormValues, string>> {
  const fieldErrors: Partial<Record<keyof TransactionFormValues, string>> = {};
  for (const issue of issues) {
    const key = issue.path[0] as keyof TransactionFormValues | undefined;
    if (key && !fieldErrors[key]) {
      fieldErrors[key] = issue.message;
    }
  }
  return fieldErrors;
}

/** Converte o payload validado (camelCase) para a linha do banco (snake_case). */
function toDbRow(data: TransactionInput) {
  return {
    kind: data.kind,
    amount_cents: data.amountCents,
    occurred_on: data.occurredOn,
    category_id: data.categoryId,
    description: data.description,
    player_id: data.playerId,
  };
}

/**
 * Lê o arquivo de comprovante do FormData, se houver. Retorna `null` quando
 * nenhum arquivo foi anexado. Valida tipo e tamanho (o upload não deve criar
 * objetos inválidos). Lança uma string de erro amigável quando inválido.
 */
function readProofFile(formData: FormData): File | null | { error: string } {
  const value = formData.get("proof");
  if (!(value instanceof File) || value.size === 0) {
    return null;
  }
  if (value.size > UPLOAD_MAX_BYTES) {
    return { error: "O comprovante deve ter no máximo 5 MB." };
  }
  if (value.type && !ALLOWED_PROOF_TYPES.includes(value.type)) {
    return {
      error: "O comprovante deve ser uma imagem (JPG, PNG, WebP) ou PDF.",
    };
  }
  return value;
}

/**
 * Monta o caminho do comprovante de um lançamento no bucket `proofs`, ESCOPADO
 * POR CLUBE. O primeiro segmento é SEMPRE o `club_id` (exigência da policy de
 * RLS do Storage — migration 20250101000024, que resolve a autorização pelo
 * primeiro segmento via `club_role`). Lançamentos podem não ter `charge_id`, por
 * isso usamos uma pasta coerente escopada por clube:
 *
 *   `<club_id>/transactions/<timestamp>-<random>/<arquivo>`
 *
 * O segmento aleatório evita colisões entre uploads (o bucket é `upsert: false`).
 */
function proofPath(clubId: string, fileName: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  return `${clubId}/transactions/${timestamp}-${random}/${safeFileName(fileName)}`;
}

/** Normaliza o nome do arquivo para um caminho seguro no Storage. */
function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned === "" ? "comprovante" : cleaned;
}

// ─── Criar lançamento (Req 9.1, 9.7, 9.11) ───────────────────────────────────

export async function createTransaction(
  _prevState: TransactionActionState,
  formData: FormData,
): Promise<TransactionActionState> {
  const guard = await requireManager();
  if (!guard.ok) return guard.state;
  const { clubId } = guard;

  const parsed = transactionSchema.safeParse(readFormData(formData));
  if (!parsed.success) {
    return {
      status: "error",
      message: "Corrija os campos inválidos.",
      fieldErrors: toFieldErrors(parsed.error.issues),
    };
  }

  // Comprovante opcional (Req 9 — caminho com club_id).
  const proof = readProofFile(formData);
  if (proof && "error" in proof) {
    return { status: "error", message: proof.error };
  }

  let storedProofPath: string | null = null;
  if (proof) {
    try {
      storedProofPath = await uploadProof(
        proofPath(clubId, proof.name),
        proof,
        proof.type || undefined,
      );
    } catch (err) {
      return {
        status: "error",
        message:
          err instanceof Error ? err.message : "Falha ao enviar o comprovante.",
      };
    }
  }

  // Cliente ligado à sessão: o trigger de auditoria captura auth.uid() (Req 9.9).
  // Injeta o club_id do clube ativo no insert (escopo multi-tenant, Req 9.1).
  const supabase = await createClient();
  const { error } = await supabase.from("transactions").insert({
    ...toDbRow(parsed.data),
    club_id: clubId,
    proof_path: storedProofPath,
  });

  if (error) {
    return { status: "error", message: `Erro ao salvar: ${error.message}` };
  }

  revalidatePath("/lancamentos");
  return { status: "success", message: "Lançamento registrado com sucesso." };
}

// ─── Editar lançamento (Req 9.1, 9.7, 9.9, 9.11) ─────────────────────────────

export async function updateTransaction(
  _prevState: TransactionActionState,
  formData: FormData,
): Promise<TransactionActionState> {
  const guard = await requireManager();
  if (!guard.ok) return guard.state;
  const { clubId } = guard;

  const id = formData.get("id");
  if (typeof id !== "string" || id.trim() === "") {
    return { status: "error", message: "Lançamento não identificado." };
  }

  const parsed = transactionSchema.safeParse(readFormData(formData));
  if (!parsed.success) {
    return {
      status: "error",
      message: "Corrija os campos inválidos.",
      fieldErrors: toFieldErrors(parsed.error.issues),
    };
  }

  // Comprovante opcional: um novo arquivo substitui o caminho antigo
  // (Req 9 — caminho com club_id).
  const proof = readProofFile(formData);
  if (proof && "error" in proof) {
    return { status: "error", message: proof.error };
  }

  const updates: Record<string, unknown> = toDbRow(parsed.data);

  if (proof) {
    try {
      updates.proof_path = await uploadProof(
        proofPath(clubId, proof.name),
        proof,
        proof.type || undefined,
      );
    } catch (err) {
      return {
        status: "error",
        message:
          err instanceof Error ? err.message : "Falha ao enviar o comprovante.",
      };
    }
  }

  // Cliente ligado à sessão: o trigger de auditoria captura before/after (Req 9.9).
  // O filtro `club_id` garante que a linha editada pertence ao clube ativo: não
  // é possível editar um lançamento de outro futebol mesmo conhecendo o id.
  const supabase = await createClient();
  const { error } = await supabase
    .from("transactions")
    .update(updates)
    .eq("id", id)
    .eq("club_id", clubId)
    .is("deleted_at", null);

  if (error) {
    return { status: "error", message: `Erro ao salvar: ${error.message}` };
  }

  revalidatePath("/lancamentos");
  return { status: "success", message: "Lançamento atualizado com sucesso." };
}

// ─── Excluir lançamento (soft delete — Req 9.9, 9.11) ────────────────────────

/**
 * Exclui um lançamento via SOFT DELETE: marca `deleted_at = now()` em vez de
 * remover a linha (nenhum dado financeiro é removido fisicamente). A mutação
 * passa pelo cliente de sessão, de modo que o trigger de auditoria registre a
 * ação (Req 9.9). O filtro `club_id` escopa a operação ao clube ativo.
 */
export async function softDeleteTransaction(
  _prevState: TransactionDeleteActionState,
  formData: FormData,
): Promise<TransactionDeleteActionState> {
  const guard = await requireManager();
  if (!guard.ok) {
    return { status: "error", message: guard.state.message };
  }
  const { clubId } = guard;

  const id = formData.get("id");
  if (typeof id !== "string" || id.trim() === "") {
    return { status: "error", message: "Lançamento não identificado." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("transactions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("club_id", clubId)
    .is("deleted_at", null);

  if (error) {
    return { status: "error", message: `Erro ao excluir: ${error.message}` };
  }

  revalidatePath("/lancamentos");
  return {
    status: "success",
    message: "Lançamento excluído. O registro foi preservado (soft delete).",
  };
}

// ─── URL assinada do comprovante (Req 9 — leitura por URL assinada) ──────────

/**
 * Gera uma URL assinada de curta duração para visualizar o comprovante de um
 * lançamento. Apenas presidente/tesoureiro do clube ativo (os únicos que
 * acessam a tela de lançamentos). A leitura real do objeto privado ocorre por
 * esta URL assinada, nunca por URL pública.
 */
export async function getProofUrl(
  path: string,
): Promise<{ url: string } | { error: string }> {
  const guard = await requireManager();
  if (!guard.ok) {
    return { error: "Acesso negado." };
  }

  if (typeof path !== "string" || path.trim() === "") {
    return { error: "Comprovante não encontrado." };
  }

  try {
    const url = await createProofSignedUrl(path);
    return { url };
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Falha ao abrir o comprovante.",
    };
  }
}

// Reexporta o tipo para consumidores que precisam da forma da linha.
export type { TransactionRow };
