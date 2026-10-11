import { z } from "zod";

/**
 * Schema Zod de validação da criação de futebol (tarefa 20.1).
 *
 * Cobre os campos que o presidente informa ao criar um futebol (Req 3.1):
 * nome do futebol, dados Pix (chave, recebedor, cidade), valores padrão
 * (mensalidade, avulso), dia de vencimento e de geração, saldo inicial e logo
 * opcional. A linha de `settings` do clube é criada pela RPC `create_club`
 * a partir desses mesmos campos (uma linha por clube — Req 3.2).
 *
 * Os campos monetários chegam do formulário como strings pt-BR
 * ("25,00", "1.500,00", "R$ 100") e são convertidos para centavos inteiros,
 * seguindo o mesmo padrão do schema de Configurações (`validation/settings.ts`).
 */

/** Limites válidos para dias do mês (1..28, evita meses curtos). */
const DAY_MIN = 1;
const DAY_MAX = 28;

/**
 * Transforma uma string monetária pt-BR em centavos inteiro. Aceita strings
 * puramente numéricas ("2500") e retorna 0 para string vazia. Retorna NaN
 * para entradas inválidas (sinalizado por `refine`).
 */
export function monetaryStringToCents(val: string): number {
  const trimmed = val
    .replace(/\s|\u00a0/g, "")
    .replace(/r\$/gi, "")
    .trim();

  if (trimmed === "") return 0;

  const hasComma = trimmed.includes(",");
  const normalized = hasComma
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed;

  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) return NaN;

  return Math.round(num * 100);
}

/** Campo monetário: string pt-BR → inteiro (centavos), >= 0. */
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

/** Campo de dia do mês (1..28), aceitando string/number. */
const dayField = (label: string) =>
  z.coerce
    .number({ invalid_type_error: `${label} inválido.` })
    .int(`${label} deve ser inteiro.`)
    .min(DAY_MIN, `${label} deve ser entre ${DAY_MIN} e ${DAY_MAX}.`)
    .max(DAY_MAX, `${label} deve ser entre ${DAY_MIN} e ${DAY_MAX}.`);

/**
 * Schema principal de criação de futebol.
 *
 * Campos de texto são trimados; valores monetários e dias normalizados para o
 * formato do banco. `dueDay`/`generationDay` têm defaults coerentes com os
 * defaults da tabela `settings` (10 e 1). O logo é opcional.
 */
export const createClubSchema = z.object({
  // ── Dados do clube (Req 3.1) ──────────────────────────────────────
  name: z
    .string({ required_error: "Informe o nome do futebol." })
    .trim()
    .min(1, "Informe o nome do futebol.")
    .max(100, "Nome do futebol deve ter no máximo 100 caracteres."),

  // Logo é opcional (upload tratado à parte; aqui apenas o caminho).
  logoPath: z.string().trim().min(1).max(500).nullable().optional(),

  // ── Dados Pix (Req 3.1) ───────────────────────────────────────────
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

  // ── Valores padrão em centavos (Req 3.1) ──────────────────────────
  defaultMonthlyCents: monetaryField("Mensalidade padrão").default("0"),
  defaultDropInCents: monetaryField("Avulso padrão").default("0"),

  // ── Dias (Req 3.1) ────────────────────────────────────────────────
  dueDay: dayField("Dia de vencimento").default(10),
  generationDay: dayField("Dia de geração").default(1),

  // ── Saldo inicial ─────────────────────────────────────────────────
  initialBalanceCents: monetaryField("Saldo inicial").default("0"),
});

/** Entrada bruta aceita pelo schema (antes das transformações). */
export type CreateClubFormValues = z.input<typeof createClubSchema>;

/** Saída validada/normalizada do schema (centavos inteiros, dias numéricos). */
export type CreateClubInput = z.output<typeof createClubSchema>;

/**
 * Parâmetros da RPC `create_club` (snake_case, formato exato esperado pelo
 * Postgres). Produzidos a partir da saída validada pelo schema.
 */
export interface CreateClubRpcArgs {
  p_name: string;
  p_pix_key: string;
  p_pix_receiver_name: string;
  p_pix_city: string;
  p_default_monthly_cents: number;
  p_default_drop_in_cents: number;
  p_due_day: number;
  p_generation_day: number;
  p_initial_balance_cents: number;
  p_logo_path: string | null;
}

/**
 * Mapeia a entrada validada (camelCase) para os argumentos da RPC
 * `create_club` (snake_case `p_*`). Mantém a conversão num único lugar para
 * evitar divergência entre o schema e a assinatura da função Postgres.
 */
export function toCreateClubRpcArgs(input: CreateClubInput): CreateClubRpcArgs {
  return {
    p_name: input.name,
    p_pix_key: input.pixKey,
    p_pix_receiver_name: input.pixReceiverName,
    p_pix_city: input.pixCity,
    p_default_monthly_cents: input.defaultMonthlyCents,
    p_default_drop_in_cents: input.defaultDropInCents,
    p_due_day: input.dueDay,
    p_generation_day: input.generationDay,
    p_initial_balance_cents: input.initialBalanceCents,
    p_logo_path: input.logoPath ?? null,
  };
}
