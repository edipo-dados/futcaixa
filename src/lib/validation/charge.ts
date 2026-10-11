import { z } from "zod";

import { toCents } from "@/lib/money";

/**
 * Schema Zod de validação de Cobranças avulsas manuais (charges).
 *
 * O formulário envia strings (digitação do usuário) e o schema normaliza/
 * converte para o formato do banco: valor em centavos (> 0), tipo (enum de
 * domínio), descrição obrigatória, vencimento (data civil `YYYY-MM-DD`) e,
 * para mensalidades, o período (`YYYY-MM`). A revalidação acontece tanto no
 * cliente (feedback imediato) quanto no servidor (Server Action), conforme
 * design.md — nunca confiar só no front.
 *
 * Requisitos cobertos:
 *  - 5.3: admin/tesoureiro cria cobrança avulsa registrando jogador, valor,
 *    descrição e vencimento (ex.: avulso do jogo, multa, vaquinha).
 *  - 5.8: o vencimento é configurável nas Configurações (`settings.due_day`
 *    serve de padrão no formulário; aqui o schema só valida a data recebida).
 *
 * O `txid` (único por cobrança, usado no Pix — Req 6.2) NÃO faz parte do
 * formulário: é gerado na Server Action via `generateTxid()`. O `status`
 * nasce sempre `pendente` (Req 5.4) e também não vem do formulário.
 */

// ─── Enum de domínio (espelha o CHECK do banco) ─────────────────────────────

export const CHARGE_KINDS = [
  "mensalidade",
  "avulso",
  "multa",
  "vaquinha",
] as const;

export type ChargeKind = (typeof CHARGE_KINDS)[number];

/** Rótulos pt-BR para os tipos de cobrança. */
export const CHARGE_KIND_LABELS: Record<ChargeKind, string> = {
  mensalidade: "Mensalidade",
  avulso: "Avulso",
  multa: "Multa",
  vaquinha: "Vaquinha",
};

/** Status possíveis da cobrança (espelha o CHECK do banco, Req 5.4). */
export const CHARGE_STATUSES = [
  "pendente",
  "em_analise",
  "paga",
  "cancelada",
] as const;

export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

/** Rótulos pt-BR para os status de cobrança. */
export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
  pendente: "Pendente",
  em_analise: "Em análise",
  paga: "Paga",
  cancelada: "Cancelada",
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

// Período `YYYY-MM` (usado em mensalidades para a unicidade por jogador+mês).
const ISO_PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Valida que a string é um período civil válido no formato `YYYY-MM`. */
export function isValidPeriod(value: string): boolean {
  return ISO_PERIOD.test(value);
}

// ─── Gerador de txid (único por cobrança — Req 6.2) ─────────────────────────

/**
 * Alfabeto do txid: alfanumérico (sem símbolos). O padrão Pix (EMV) aceita no
 * campo `05` do Additional Data (ID 62) apenas `A-Z a-z 0-9` com até 25
 * caracteres. Mantemos minúsculas e dígitos (hex-safe + extra) para legibilidade.
 */
const TXID_MAX_LENGTH = 25;

/**
 * Gera um `txid` único por cobrança, URL-safe e alfanumérico, com no máximo 25
 * caracteres (limite recomendado do BR Code / EMV estático — Req 6.2).
 *
 * Estratégia: concatena dois UUIDs (sem hífens) e corta para 25 chars. UUID v4
 * tem 122 bits de aleatoriedade; 25 chars hexadecimais ≈ 100 bits — colisão é
 * desprezível para o volume de um futebol recreativo. O resultado é só
 * `[0-9a-f]`, portanto seguro em URL e no payload Pix.
 *
 * Determinístico apenas no formato (não no valor): cada chamada produz um novo
 * identificador.
 */
export function generateTxid(): string {
  const raw =
    globalThis.crypto.randomUUID().replace(/-/g, "") +
    globalThis.crypto.randomUUID().replace(/-/g, "");
  return raw.slice(0, TXID_MAX_LENGTH);
}

/** Expressão para validar o formato de um txid gerado por `generateTxid`. */
export const TXID_PATTERN = /^[0-9a-f]{1,25}$/;

// ─── Schema principal ───────────────────────────────────────────────────────

export const chargeSchema = z
  .object({
    // ── Jogador (uuid/non-empty, Req 5.3) ────────────────────────────────
    playerId: z
      .string({ required_error: "Selecione o jogador." })
      .trim()
      .min(1, "Selecione o jogador."),

    // ── Valor em centavos > 0 (Req 5.3) ───────────────────────────────────
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

    // ── Descrição (obrigatória, Req 5.3) ──────────────────────────────────
    description: z
      .string({ required_error: "Informe a descrição." })
      .trim()
      .min(1, "Informe a descrição.")
      .max(
        DESCRIPTION_MAX,
        `Descrição deve ter no máximo ${DESCRIPTION_MAX} caracteres.`,
      ),

    // ── Tipo (enum de domínio, Req 5.3) ───────────────────────────────────
    kind: z.enum(CHARGE_KINDS, {
      errorMap: () => ({ message: "Tipo de cobrança inválido." }),
    }),

    // ── Vencimento (date-only, Req 5.3/5.8) ───────────────────────────────
    dueDate: z
      .string({ required_error: "Informe o vencimento." })
      .trim()
      .min(1, "Informe o vencimento.")
      .refine(isValidISODate, { message: "Data de vencimento inválida." }),

    // ── Período (opcional; obrigatório para mensalidade, Req 5.2) ─────────
    // Vazio é tratado como ausente; a presença/validade é checada no refine.
    period: z
      .string()
      .trim()
      .optional()
      .transform((val) => (val === "" ? undefined : val)),
  })
  // Mensalidade exige período `YYYY-MM` (base da unicidade por jogador+mês).
  .refine(
    (data) =>
      data.kind !== "mensalidade" ||
      (data.period != null && isValidPeriod(data.period)),
    {
      message: "Mensalidade exige um período válido (AAAA-MM).",
      path: ["period"],
    },
  )
  // Para os demais tipos, se um período for informado, ele deve ser válido.
  .refine(
    (data) =>
      data.period == null ||
      data.kind === "mensalidade" ||
      isValidPeriod(data.period),
    {
      message: "Período inválido (use o formato AAAA-MM).",
      path: ["period"],
    },
  );

/** Tipo de saída (após transformações) do schema de cobranças. */
export type ChargeInput = z.output<typeof chargeSchema>;

// ─── Mapeamento banco ↔ formulário ──────────────────────────────────────────

/**
 * Linha da tabela `charges` (snake_case) retornada pelo Supabase.
 */
export interface ChargeRow {
  id: string;
  player_id: string;
  amount_cents: number;
  description: string;
  kind: ChargeKind;
  period: string | null;
  due_date: string;
  status: ChargeStatus;
  paid_at: string | null;
  txid: string;
  deleted_at: string | null;
  created_at?: string;
}

/**
 * Valores do formulário (strings, para uso nos inputs). São transformados
 * pelo Zod antes de salvar no banco.
 */
export interface ChargeFormValues {
  playerId: string;
  amountCents: string;
  description: string;
  kind: ChargeKind;
  dueDate: string;
  period: string;
}

/**
 * Valores de formulário em branco, para o modo "criar". A cobrança nasce como
 * `avulso` (caso de uso mais comum da criação manual — Req 5.3); o vencimento
 * padrão é calculado no servidor a partir de `settings.due_day`.
 *
 * @param dueDate vencimento padrão (`YYYY-MM-DD`) derivado das Configurações.
 * @param period período padrão (`YYYY-MM`) para quando o tipo for mensalidade.
 */
export function emptyChargeFormValues(
  dueDate = "",
  period = "",
): ChargeFormValues {
  return {
    playerId: "",
    amountCents: "",
    description: "",
    kind: "avulso",
    dueDate,
    period,
  };
}

/** Estado retornado pela Server Action de criar cobrança. */
export interface ChargeActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof ChargeFormValues, string>>;
}

/**
 * Estado retornado pelas Server Actions de transição de status (marcar paga,
 * cancelar — tarefa 8.3). Não há `fieldErrors` porque a entrada é apenas o id
 * da cobrança (não um formulário com múltiplos campos).
 */
export interface ChargeStatusActionState {
  status: "idle" | "success" | "error";
  message?: string;
}
