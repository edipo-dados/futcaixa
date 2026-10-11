import type { ChargeStatus } from "@/lib/validation/charge";

/**
 * Validação do comprovante de pagamento (tarefa 9.5, Req 6.5).
 *
 * Regras de aceitação do arquivo anexado pelo jogador:
 *  - Tipo: imagem (JPEG, PNG, WebP) ou PDF.
 *  - Tamanho: no máximo 5 MB.
 *
 * A validação é pura (não depende de servidor), portanto é testável por
 * unidade e reutilizável tanto no cliente (feedback imediato) quanto na Server
 * Action (revalidação autoritativa — nunca confiar só no front).
 */

/** Tamanho máximo do comprovante em bytes (5 MB). */
export const PROOF_MAX_BYTES = 5 * 1024 * 1024;

/** Tipos MIME aceitos para o comprovante (imagem ou PDF). */
export const ALLOWED_PROOF_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

/** Lista legível (pt-BR) dos tipos aceitos, para mensagens e `accept`. */
export const PROOF_ACCEPT_ATTR =
  "image/jpeg,image/png,image/webp,application/pdf";

/** Resultado da validação do arquivo de comprovante. */
export type ProofValidationResult =
  { ok: true; file: File } | { ok: false; error: string };

/**
 * Valida o valor recebido do `FormData` como comprovante.
 *
 * @param value Valor cru vindo de `formData.get("proof")`.
 * @returns `{ ok: true, file }` quando válido; `{ ok: false, error }` com uma
 *   mensagem amigável em pt-BR caso contrário.
 */
export function validateProofFile(value: unknown): ProofValidationResult {
  if (!(value instanceof File) || value.size === 0) {
    return { ok: false, error: "Anexe um comprovante (imagem ou PDF)." };
  }

  if (value.size > PROOF_MAX_BYTES) {
    return { ok: false, error: "O comprovante deve ter no máximo 5 MB." };
  }

  if (!ALLOWED_PROOF_TYPES.includes(value.type as never)) {
    return {
      ok: false,
      error: "O comprovante deve ser uma imagem (JPG, PNG, WebP) ou PDF.",
    };
  }

  return { ok: true, file: value };
}

/**
 * Normaliza o nome do arquivo para um caminho seguro no Storage: remove
 * acentos/espaços e caracteres fora de `[\w.-]`, colapsa `_` repetidos e
 * garante um nome não vazio.
 *
 * @param name Nome original do arquivo (ex.: `Comprovante Pix.pdf`).
 * @returns Nome seguro (ex.: `Comprovante_Pix.pdf`).
 */
export function safeProofFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned === "" ? "comprovante" : cleaned;
}

/** Linha mínima da cobrança usada no envio de comprovante. */
export interface ProofChargeRow {
  id: string;
  player_id: string;
  status: ChargeStatus;
}

/** Estado retornado pela Server Action de envio de comprovante. */
export interface ProofSubmitActionState {
  status: "idle" | "success" | "error";
  message?: string;
}
