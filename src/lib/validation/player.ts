import { z } from "zod";

/**
 * Schema Zod de validação de Jogadores (players).
 *
 * O formulário envia strings (digitação do usuário) e o schema normaliza/
 * converte para o formato do banco (texto limpo, enums validados, nível
 * inteiro 1..3, valores personalizados em centavos ou null). A revalidação
 * acontece tanto no cliente (feedback imediato) quanto no servidor (Server
 * Action), conforme design.md.
 *
 * Requisitos cobertos:
 *  - 2.1: nome, apelido, e-mail, telefone, tipo, status, nível, isento.
 *  - 2.2: isento exige motivo.
 *  - 2.3: valores personalizados de mensalidade/avulso.
 *  - 2.4: ausência de valor personalizado → usa padrão (null no banco).
 *  - 2.5: validação de formato de e-mail e telefone.
 *  - 2.8: apenas admin cria/edita (enforced na Server Action + RLS).
 */

// ─── Enums de domínio (espelham os CHECKs do banco) ────────────────────────

export const PLAYER_TYPES = ["mensalista", "avulso", "convidado"] as const;
export const PLAYER_STATUSES = ["ativo", "inativo"] as const;

export type PlayerType = (typeof PLAYER_TYPES)[number];
export type PlayerStatus = (typeof PLAYER_STATUSES)[number];

// ─── Limites ────────────────────────────────────────────────────────────────

const SKILL_MIN = 1;
const SKILL_MAX = 3;
const PHONE_DIGITS_MIN = 10; // fixo com DDD
const PHONE_DIGITS_MAX = 11; // celular com DDD (9 + 8 dígitos)

// ─── Helpers de conversão monetária (centavos) ──────────────────────────────

/**
 * Converte uma string monetária pt-BR ("25,00", "1.500,00", "R$ 100") em
 * centavos inteiro. Retorna `null` quando a string está vazia (sem valor
 * personalizado → o padrão de Configurações será aplicado, Req 2.4).
 * Retorna `NaN` quando a string não é um número válido (>= 0).
 */
function optionalMonetaryToCents(val: string): number | null {
  const trimmed = val
    .replace(/\s|\u00a0/g, "")
    .replace(/r\$/gi, "")
    .trim();

  if (trimmed === "") return null;

  const hasComma = trimmed.includes(",");
  const normalized = hasComma
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed;

  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) return NaN;

  return Math.round(num * 100);
}

/**
 * Campo monetário opcional: string pt-BR → centavos (inteiro) ou null quando
 * vazio. Rejeita valores inválidos ou negativos.
 */
const optionalMonetaryField = (label: string) =>
  z
    .string()
    .default("")
    .transform((val) => optionalMonetaryToCents(val))
    .refine((val) => val === null || !Number.isNaN(val), {
      message: `${label}: valor monetário inválido.`,
    })
    .refine((val) => val === null || val >= 0, {
      message: `${label}: o valor não pode ser negativo.`,
    });

// ─── Helpers de normalização de texto ───────────────────────────────────────

/** Trima e devolve `null` quando a string resultante é vazia. */
function emptyToNull(val: unknown): string | null {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  return trimmed === "" ? null : trimmed;
}

// Regex de telefone BR "frouxo": dígitos, parênteses, espaços, hífen e "+".
// A contagem de dígitos (10..11) é validada à parte.
const PHONE_ALLOWED_CHARS = /^[\d()+\s-]+$/;

// ─── Schema principal ─────────────────────────────────────────────────────

export const playerSchema = z
  .object({
    // ── Nome (obrigatório, Req 2.1) ─────────────────────────────────────
    name: z
      .string({ required_error: "Informe o nome do jogador." })
      .trim()
      .min(1, "Informe o nome do jogador.")
      .max(120, "Nome deve ter no máximo 120 caracteres."),

    // ── Apelido (opcional, Req 2.1) ─────────────────────────────────────
    nickname: z
      .string()
      .max(60, "Apelido deve ter no máximo 60 caracteres.")
      .nullish()
      .transform(emptyToNull),

    // ── Empresa onde trabalha (opcional) ────────────────────────────────
    company: z
      .string()
      .max(100, "Empresa deve ter no máximo 100 caracteres.")
      .nullish()
      .transform(emptyToNull),

    // ── E-mail (opcional, mas válido quando presente — Req 2.1, 2.5) ────
    email: z
      .string()
      .nullish()
      .transform((val) => {
        const normalized = emptyToNull(val);
        return normalized ? normalized.toLowerCase() : null;
      })
      .refine(
        (val) => val === null || z.string().email().safeParse(val).success,
        { message: "E-mail inválido." },
      ),

    // ── Telefone (opcional, formato BR frouxo — Req 2.1, 2.5) ───────────
    phone: z
      .string()
      .nullish()
      .transform(emptyToNull)
      .refine(
        (val) => val === null || PHONE_ALLOWED_CHARS.test(val),
        { message: "Telefone contém caracteres inválidos." },
      )
      .refine(
        (val) => {
          if (val === null) return true;
          const digits = val.replace(/\D/g, "");
          return (
            digits.length >= PHONE_DIGITS_MIN &&
            digits.length <= PHONE_DIGITS_MAX
          );
        },
        {
          message: `Telefone deve ter ${PHONE_DIGITS_MIN} ou ${PHONE_DIGITS_MAX} dígitos (com DDD).`,
        },
      ),

    // ── Tipo (enum, Req 2.1) ────────────────────────────────────────────
    type: z.enum(PLAYER_TYPES, {
      errorMap: () => ({ message: "Tipo de jogador inválido." }),
    }),

    // ── Status (enum, Req 2.1) ──────────────────────────────────────────
    status: z.enum(PLAYER_STATUSES, {
      errorMap: () => ({ message: "Status inválido." }),
    }),

    // ── Nível técnico 1..3 (Req 2.1, 2.7) ───────────────────────────────
    skillLevel: z.coerce
      .number({ invalid_type_error: "Nível técnico inválido." })
      .int("Nível técnico deve ser inteiro.")
      .min(SKILL_MIN, `Nível técnico deve ser entre ${SKILL_MIN} e ${SKILL_MAX}.`)
      .max(SKILL_MAX, `Nível técnico deve ser entre ${SKILL_MIN} e ${SKILL_MAX}.`),

    // ── Isento (booleano, Req 2.1) ──────────────────────────────────────
    isExempt: z.coerce.boolean().default(false),

    // ── Motivo da isenção (obrigatório se isento — Req 2.2) ─────────────
    exemptReason: z
      .string()
      .max(200, "Motivo da isenção deve ter no máximo 200 caracteres.")
      .nullish()
      .transform(emptyToNull),

    // ── Valores personalizados (opcionais, Req 2.3/2.4) ─────────────────
    customMonthlyCents: optionalMonetaryField("Mensalidade personalizada"),
    customDropInCents: optionalMonetaryField("Avulso personalizado"),
  })
  // ── Regra condicional: isento exige motivo (Req 2.2) ──────────────────
  .superRefine((data, ctx) => {
    if (data.isExempt && !data.exemptReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exemptReason"],
        message: "Informe o motivo da isenção (ex.: goleiro).",
      });
    }
  });

/** Tipo de saída (após transformações) do schema de jogadores. */
export type PlayerInput = z.output<typeof playerSchema>;

// ─── Mapeamento banco ↔ formulário ──────────────────────────────────────────

/**
 * Linha da tabela `players` (snake_case) retornada pelo Supabase.
 */
export interface PlayerRow {
  id: string;
  name: string;
  nickname: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  type: PlayerType;
  status: PlayerStatus;
  skill_level: number;
  is_exempt: boolean;
  exempt_reason: string | null;
  custom_monthly_cents: number | null;
  custom_drop_in_cents: number | null;
  deleted_at: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * Valores do formulário (strings/booleano, para uso nos inputs).
 * São transformados pelo Zod antes de salvar no banco.
 */
export interface PlayerFormValues {
  name: string;
  nickname: string;
  email: string;
  phone: string;
  company: string;
  type: PlayerType;
  status: PlayerStatus;
  skillLevel: string;
  isExempt: boolean;
  exemptReason: string;
  customMonthlyCents: string;
  customDropInCents: string;
}

/** Centavos → string decimal pt-BR para exibição no input; vazio para null. */
function centsToInputString(cents: number | null): string {
  if (cents === null || cents === undefined) return "";
  const reais = (cents / 100).toFixed(2);
  return reais.replace(".", ",");
}

/**
 * Converte a linha do banco (snake_case) para valores de formulário.
 * Usado na edição de um jogador existente.
 */
export function playerRowToFormValues(row: PlayerRow): PlayerFormValues {
  return {
    name: row.name,
    nickname: row.nickname ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    company: row.company ?? "",
    type: row.type,
    status: row.status,
    skillLevel: String(row.skill_level),
    isExempt: row.is_exempt,
    exemptReason: row.exempt_reason ?? "",
    customMonthlyCents: centsToInputString(row.custom_monthly_cents),
    customDropInCents: centsToInputString(row.custom_drop_in_cents),
  };
}

/** Valores de formulário em branco, para o modo "criar". */
export function emptyPlayerFormValues(): PlayerFormValues {
  return {
    name: "",
    nickname: "",
    email: "",
    phone: "",
    company: "",
    type: "mensalista",
    status: "ativo",
    skillLevel: "2",
    isExempt: false,
    exemptReason: "",
    customMonthlyCents: "",
    customDropInCents: "",
  };
}

/** Estado retornado pelas Server Actions de criar/editar jogador. */
export interface PlayerActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof PlayerFormValues, string>>;
}

/**
 * Estado retornado pela Server Action de inativar/reativar jogador (Req 2.6).
 * Simples: sucesso/erro com mensagem, sem erros de campo.
 */
export interface PlayerStatusActionState {
  status: "idle" | "success" | "error";
  message?: string;
}
