import { z } from "zod";

import { toCents } from "@/lib/money";
import { todayISO } from "@/lib/date";

/**
 * Schema Zod de validação de Lançamentos (transactions).
 *
 * O formulário envia strings (digitação do usuário) e o schema normaliza/
 * converte para o formato do banco: valor em centavos (> 0), data civil
 * (`YYYY-MM-DD`), enums validados e ids. A revalidação acontece tanto no
 * cliente (feedback imediato) quanto no servidor (Server Action), conforme
 * design.md — nunca confiar só no front.
 *
 * Requisitos cobertos:
 *  - 3.1: data, valor (centavos), tipo, categoria, descrição, jogador
 *    (opcional) e comprovante (opcional, tratado na Server Action/Storage).
 *  - 3.10: rejeita valores monetários menores ou iguais a zero.
 *  - 3.11: apenas admin/tesoureiro (enforced na Server Action + RLS).
 */

// ─── Enum de domínio (espelha o CHECK do banco) ─────────────────────────────

export const TRANSACTION_KINDS = ["receita", "despesa"] as const;

export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

/** Rótulos pt-BR para os tipos de lançamento. */
export const TRANSACTION_KIND_LABELS: Record<TransactionKind, string> = {
  receita: "Receita",
  despesa: "Despesa",
};

const DESCRIPTION_MAX = 200;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Converte a string monetária digitada em centavos (inteiro) usando o util
 * compartilhado `toCents` (aceita "25", "25,50", "1.234,56", "R$ 100").
 * Retorna `NaN` quando a string não é um número válido, para que o `refine`
 * de valor positivo produza a mensagem adequada.
 */
function parseAmountToCents(input: string): number {
  try {
    return toCents(input);
  } catch {
    return Number.NaN;
  }
}

// ISO date-only no formato YYYY-MM-DD.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Valida que a string é uma data civil real (ex.: rejeita 2024-02-31). */
function isValidISODate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Reconstrói em UTC e confere que não houve "overflow" (ex.: 31/02 → 03/03).
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

// ─── Schema principal ───────────────────────────────────────────────────────

export const transactionSchema = z.object({
  // ── Tipo (enum, Req 3.1) ──────────────────────────────────────────────
  kind: z.enum(TRANSACTION_KINDS, {
    errorMap: () => ({ message: "Tipo de lançamento inválido." }),
  }),

  // ── Valor em centavos > 0 (Req 3.1, 3.10) ─────────────────────────────
  // O input é string pt-BR; convertemos para centavos e rejeitamos <= 0.
  amountCents: z
    .string({ required_error: "Informe o valor." })
    .trim()
    .min(1, "Informe o valor.")
    .transform(parseAmountToCents)
    .refine((cents) => !Number.isNaN(cents), {
      message: "Valor monetário inválido.",
    })
    .refine((cents) => Number.isInteger(cents) && cents > 0, {
      message: "O valor deve ser maior que zero.",
    }),

  // ── Data do lançamento (date-only, Req 3.1) ───────────────────────────
  occurredOn: z
    .string({ required_error: "Informe a data." })
    .trim()
    .min(1, "Informe a data.")
    .refine(isValidISODate, { message: "Data inválida." }),

  // ── Categoria (uuid/non-empty, Req 3.1) ───────────────────────────────
  categoryId: z
    .string({ required_error: "Selecione a categoria." })
    .trim()
    .min(1, "Selecione a categoria."),

  // ── Descrição (obrigatória, Req 3.1) ──────────────────────────────────
  description: z
    .string({ required_error: "Informe a descrição." })
    .trim()
    .min(1, "Informe a descrição.")
    .max(
      DESCRIPTION_MAX,
      `Descrição deve ter no máximo ${DESCRIPTION_MAX} caracteres.`,
    ),

  // ── Jogador vinculado (opcional, Req 3.1) ─────────────────────────────
  playerId: z
    .string()
    .optional()
    .transform((val) => {
      if (typeof val !== "string") return null;
      const trimmed = val.trim();
      return trimmed === "" ? null : trimmed;
    }),
});

/** Tipo de saída (após transformações) do schema de lançamentos. */
export type TransactionInput = z.output<typeof transactionSchema>;

// ─── Mapeamento banco ↔ formulário ──────────────────────────────────────────

/**
 * Linha da tabela `transactions` (snake_case) retornada pelo Supabase.
 */
export interface TransactionRow {
  id: string;
  kind: TransactionKind;
  amount_cents: number;
  occurred_on: string; // YYYY-MM-DD
  category_id: string;
  description: string;
  player_id: string | null;
  charge_id: string | null;
  proof_path: string | null;
  recurring_id: string | null;
  created_by: string;
  deleted_at: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * Valores do formulário (strings, para uso nos inputs). São transformados pelo
 * Zod antes de salvar no banco.
 */
export interface TransactionFormValues {
  kind: TransactionKind;
  amountCents: string;
  occurredOn: string;
  categoryId: string;
  description: string;
  playerId: string;
}

/** Centavos → string decimal pt-BR para exibição no input (ex.: 2550 → "25,50"). */
function centsToInputString(cents: number): string {
  const reais = (cents / 100).toFixed(2);
  return reais.replace(".", ",");
}

/**
 * Converte a linha do banco (snake_case) para valores de formulário.
 * Usado na edição de um lançamento existente.
 */
export function rowToForm(row: TransactionRow): TransactionFormValues {
  return {
    kind: row.kind,
    amountCents: centsToInputString(row.amount_cents),
    occurredOn: row.occurred_on,
    categoryId: row.category_id,
    description: row.description,
    playerId: row.player_id ?? "",
  };
}

/**
 * Valores de formulário em branco, para o modo "criar". A data padrão é hoje
 * no fuso `America/Sao_Paulo` (evita off-by-one de fuso). O tipo pode ser
 * pré-selecionado (ex.: atalho de despesa do dia do jogo — tarefa 6.3).
 */
export function emptyTransactionFormValues(
  defaultKind: TransactionKind = "despesa",
): TransactionFormValues {
  return {
    kind: defaultKind,
    amountCents: "",
    occurredOn: todayISO(),
    categoryId: "",
    description: "",
    playerId: "",
  };
}

/** Estado retornado pelas Server Actions de criar/editar lançamento. */
export interface TransactionActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof TransactionFormValues, string>>;
}

/** Estado retornado pela Server Action de excluir lançamento (soft delete). */
export interface TransactionDeleteActionState {
  status: "idle" | "success" | "error";
  message?: string;
}
