import { z } from "zod";

import { toCents } from "@/lib/money";

/**
 * Schema Zod de validação de Despesas Recorrentes (recurring_expenses).
 *
 * O formulário envia strings (digitação do usuário) e o schema normaliza/
 * converte para o formato do banco: valor em centavos (> 0), categoria (uuid),
 * descrição obrigatória, dia do mês (1..28) e um indicador de ativa/inativa.
 * A revalidação acontece tanto no cliente (feedback imediato) quanto no
 * servidor (Server Action), conforme design.md — nunca confiar só no front.
 *
 * Requisitos cobertos:
 *  - 4.1: registrar valor, categoria, descrição, dia do mês e periodicidade.
 *  - 4.4: ao desativar, parar de gerar novos lançamentos (campo `isActive`;
 *    a geração em si é tarefa do cron — 7.2).
 *
 * O campo `last_generated_period` NÃO faz parte do formulário: ele é gerido
 * exclusivamente pelo cron (idempotência, Req 4.3) e nunca editado aqui.
 */

const DESCRIPTION_MAX = 200;

/** Dia mínimo/máximo do mês para a geração (1..28, evita meses curtos). */
export const DAY_OF_MONTH_MIN = 1;
export const DAY_OF_MONTH_MAX = 28;

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

// ─── Schema principal ───────────────────────────────────────────────────────

export const recurringSchema = z.object({
  // ── Valor em centavos > 0 (Req 4.1) ──────────────────────────────────
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

  // ── Categoria (uuid/non-empty, Req 4.1) ───────────────────────────────
  categoryId: z
    .string({ required_error: "Selecione a categoria." })
    .trim()
    .min(1, "Selecione a categoria."),

  // ── Descrição (obrigatória, Req 4.1) ──────────────────────────────────
  description: z
    .string({ required_error: "Informe a descrição." })
    .trim()
    .min(1, "Informe a descrição.")
    .max(
      DESCRIPTION_MAX,
      `Descrição deve ter no máximo ${DESCRIPTION_MAX} caracteres.`,
    ),

  // ── Dia do mês 1..28 (Req 4.1) ────────────────────────────────────────
  // Aceita string do form e converte para inteiro, validando o intervalo.
  dayOfMonth: z.coerce
    .number({ invalid_type_error: "Informe o dia do mês." })
    .int("O dia do mês deve ser um número inteiro.")
    .min(DAY_OF_MONTH_MIN, `O dia deve estar entre ${DAY_OF_MONTH_MIN} e ${DAY_OF_MONTH_MAX}.`)
    .max(DAY_OF_MONTH_MAX, `O dia deve estar entre ${DAY_OF_MONTH_MIN} e ${DAY_OF_MONTH_MAX}.`),

  // ── Ativa/inativa (Req 4.4) ───────────────────────────────────────────
  // Checkbox do form envia "on"/"true" quando marcado e nada quando não.
  isActive: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => {
      if (typeof val === "boolean") return val;
      if (typeof val === "string") {
        return val === "on" || val === "true" || val === "1";
      }
      return false;
    }),
});

/** Tipo de saída (após transformações) do schema de despesas recorrentes. */
export type RecurringInput = z.output<typeof recurringSchema>;

// ─── Mapeamento banco ↔ formulário ──────────────────────────────────────────

/**
 * Linha da tabela `recurring_expenses` (snake_case) retornada pelo Supabase.
 */
export interface RecurringRow {
  id: string;
  amount_cents: number;
  category_id: string;
  description: string;
  day_of_month: number;
  is_active: boolean;
  last_generated_period: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * Valores do formulário (strings/boolean, para uso nos inputs). São
 * transformados pelo Zod antes de salvar no banco.
 */
export interface RecurringFormValues {
  amountCents: string;
  categoryId: string;
  description: string;
  dayOfMonth: string;
  isActive: boolean;
}

/** Centavos → string decimal pt-BR para exibição no input (ex.: 2550 → "25,50"). */
function centsToInputString(cents: number): string {
  const reais = (cents / 100).toFixed(2);
  return reais.replace(".", ",");
}

/**
 * Converte a linha do banco (snake_case) para valores de formulário.
 * Usado na edição de uma despesa recorrente existente. O campo
 * `last_generated_period` é intencionalmente ignorado (gerido pelo cron).
 */
export function rowToForm(row: RecurringRow): RecurringFormValues {
  return {
    amountCents: centsToInputString(row.amount_cents),
    categoryId: row.category_id,
    description: row.description,
    dayOfMonth: String(row.day_of_month),
    isActive: row.is_active,
  };
}

/**
 * Valores de formulário em branco, para o modo "criar". A despesa nasce ativa
 * e com o dia 1 como padrão.
 */
export function emptyRecurringFormValues(): RecurringFormValues {
  return {
    amountCents: "",
    categoryId: "",
    description: "",
    dayOfMonth: "1",
    isActive: true,
  };
}

/** Estado retornado pelas Server Actions de criar/editar despesa recorrente. */
export interface RecurringActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof RecurringFormValues, string>>;
}

/** Estado retornado pela Server Action de ativar/desativar (toggle). */
export interface RecurringToggleActionState {
  status: "idle" | "success" | "error";
  message?: string;
}
