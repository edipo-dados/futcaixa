import { z } from "zod";

/**
 * Schema Zod de validação das Configurações (settings — uma linha por clube).
 *
 * O formulário recebe valores formatados (BRL, strings) e o schema converte
 * para o formato do banco (centavos inteiro, texto limpo). A revalidação
 * acontece tanto no cliente (feedback imediato) quanto no servidor (Server
 * Action), conforme design.md.
 *
 * Multi-tenant (tarefa 21.1): `settings` deixou de ser singleton (id=1) e
 * passou a ter uma linha por futebol (`club_id` UNIQUE, Req 16.4). A leitura e
 * a escrita são sempre escopadas ao clube ativo da sessão.
 *
 * Requisitos cobertos:
 *  - 10.1: nome do futebol, logo, chave Pix, nome do recebedor, cidade.
 *  - 10.2: valores padrão (mensalidade, avulso), dia de vencimento e geração.
 *  - 10.3: saldo inicial do caixa.
 *  - 16.1/16.2/16.3: leitura/escrita escopadas ao futebol ativo; apenas o
 *    presidente edita, tesoureiro/jogador leem os dados Pix.
 */

/** Limites válidos para dias do mês (1..28, evita meses curtos). */
const DAY_MIN = 1;
const DAY_MAX = 28;

/**
 * Transforma uma string monetária pt-BR ("25,00", "1.500,00", "R$ 100") em
 * centavos inteiro. Aceita também strings puramente numéricas ("2500").
 * Retorna 0 para string vazia (campo opcional / não preenchido).
 */
function monetaryStringToCents(val: string): number {
  const trimmed = val
    .replace(/\s|\u00a0/g, "")
    .replace(/r\$/gi, "")
    .trim();

  if (trimmed === "") return 0;

  const hasComma = trimmed.includes(",");
  let normalized: string;

  if (hasComma) {
    // Formato pt-BR: "." é milhar, "," é decimal.
    normalized = trimmed.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = trimmed;
  }

  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) return NaN;

  return Math.round(num * 100);
}

/**
 * Refinamento Zod para campos monetários: string pt-BR → inteiro (centavos).
 * Exige valor >= 0.
 */
const monetaryField = (label: string) =>
  z
    .string()
    .transform((val) => monetaryStringToCents(val))
    .refine((val) => !Number.isNaN(val), {
      message: `${label}: valor monetário inválido.`,
    })
    .refine((val) => val >= 0, {
      message: `${label}: o valor não pode ser negativo.`,
    });

/**
 * Schema principal das Configurações.
 *
 * Campos de texto são trimados. Campos monetários saem do form como string
 * (digitação pelo usuário) e são convertidos para centavos pela transformação.
 */
export const settingsSchema = z.object({
  // ── Dados do clube (Req 10.1) ─────────────────────────────────────
  clubName: z
    .string({ required_error: "Informe o nome do futebol." })
    .trim()
    .min(1, "Informe o nome do futebol.")
    .max(100, "Nome do futebol deve ter no máximo 100 caracteres."),

  // Logo é tratado à parte (upload de arquivo); aqui apenas o caminho atual.
  logoPath: z.string().nullable().optional(),

  // ── Dados Pix (Req 10.1) ──────────────────────────────────────────
  pixKey: z
    .string()
    .trim()
    .max(77, "Chave Pix deve ter no máximo 77 caracteres.")
    .default(""),

  pixReceiverName: z
    .string()
    .trim()
    .max(25, "Nome do recebedor deve ter no máximo 25 caracteres.")
    .default(""),

  pixCity: z
    .string()
    .trim()
    .max(15, "Cidade deve ter no máximo 15 caracteres.")
    .default(""),

  // ── Valores padrão em centavos (Req 10.2) ─────────────────────────
  defaultMonthlyCents: monetaryField("Mensalidade padrão"),
  defaultDropInCents: monetaryField("Avulso padrão"),

  // ── Dias (Req 10.2) ───────────────────────────────────────────────
  dueDay: z.coerce
    .number({ invalid_type_error: "Dia de vencimento inválido." })
    .int("Dia de vencimento deve ser inteiro.")
    .min(DAY_MIN, `Dia de vencimento deve ser entre ${DAY_MIN} e ${DAY_MAX}.`)
    .max(DAY_MAX, `Dia de vencimento deve ser entre ${DAY_MIN} e ${DAY_MAX}.`),

  generationDay: z.coerce
    .number({ invalid_type_error: "Dia de geração inválido." })
    .int("Dia de geração deve ser inteiro.")
    .min(DAY_MIN, `Dia de geração deve ser entre ${DAY_MIN} e ${DAY_MAX}.`)
    .max(DAY_MAX, `Dia de geração deve ser entre ${DAY_MIN} e ${DAY_MAX}.`),

  // ── Saldo inicial (Req 10.3) ──────────────────────────────────────
  initialBalanceCents: monetaryField("Saldo inicial"),
});

/** Tipo de saída (após transformações) do schema de settings. */
export type SettingsInput = z.output<typeof settingsSchema>;

/**
 * Tipo da linha do banco (snake_case) — usado para mapear o que vem do
 * Supabase para o formato camelCase do formulário.
 */
export interface SettingsRow {
  /** Futebol dono desta configuração (chave efetiva no modelo multi-tenant). */
  club_id: string;
  club_name: string;
  logo_path: string | null;
  pix_key: string;
  pix_receiver_name: string;
  pix_city: string;
  default_monthly_cents: number;
  default_drop_in_cents: number;
  due_day: number;
  generation_day: number;
  initial_balance_cents: number;
  created_at: string;
  updated_at: string;
}

/**
 * Converte a linha do banco (snake_case) para valores de formulário (strings
 * legíveis). Centavos → reais formatados pt-BR para exibição no input.
 */
export function settingsRowToFormValues(row: SettingsRow): SettingsFormValues {
  return {
    clubName: row.club_name,
    logoPath: row.logo_path,
    pixKey: row.pix_key,
    pixReceiverName: row.pix_receiver_name,
    pixCity: row.pix_city,
    defaultMonthlyCents: centsToInputString(row.default_monthly_cents),
    defaultDropInCents: centsToInputString(row.default_drop_in_cents),
    dueDay: String(row.due_day),
    generationDay: String(row.generation_day),
    initialBalanceCents: centsToInputString(row.initial_balance_cents),
  };
}

/** Centavos → string decimal pt-BR para exibição no campo de input. */
function centsToInputString(cents: number): string {
  if (cents === 0) return "0,00";
  const reais = (cents / 100).toFixed(2);
  return reais.replace(".", ",");
}

/**
 * Valores do formulário (strings, para uso nos inputs).
 * São transformados pelo Zod antes de salvar no banco.
 */
export interface SettingsFormValues {
  clubName: string;
  logoPath: string | null;
  pixKey: string;
  pixReceiverName: string;
  pixCity: string;
  defaultMonthlyCents: string;
  defaultDropInCents: string;
  dueDay: string;
  generationDay: string;
  initialBalanceCents: string;
}

/** Estado retornado pela Server Action de salvar configurações. */
export interface SettingsActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Partial<Record<keyof SettingsFormValues, string>>;
}
