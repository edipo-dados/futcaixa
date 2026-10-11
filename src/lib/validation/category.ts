import { z } from "zod";

/**
 * Schema Zod de validação de Categorias (categories).
 *
 * As categorias são editáveis: podem ser criadas, renomeadas, reordenadas e
 * ativadas/desativadas — inclusive as semeadas (`is_system`). A revalidação
 * acontece tanto no cliente (feedback imediato) quanto no servidor (Server
 * Action), conforme design.md — nunca confiar só no front.
 *
 * Requisitos cobertos:
 *  - 3.2: categorias padrão como ponto de partida (semeadas na migration 2.1).
 *  - 3.3: criar, renomear, reordenar e ativar/desativar quaisquer categorias.
 *  - 3.4: categoria usada por lançamentos NÃO é apagada — apenas desativada.
 *  - 3.5: lançamentos antigos preservam a categoria original.
 */

// ─── Enum de domínio (espelha o CHECK do banco) ─────────────────────────────

export const CATEGORY_KINDS = ["receita", "despesa"] as const;

export type CategoryKind = (typeof CATEGORY_KINDS)[number];

const NAME_MAX = 60;

// ─── Schema de criação de categoria (Req 3.3) ───────────────────────────────

/**
 * Schema para criar uma categoria. O usuário informa apenas tipo e nome; a
 * ordem (`sort_order`) é definida pelo servidor (final da lista) e a categoria
 * nasce ativa e não-sistema.
 */
export const createCategorySchema = z.object({
  kind: z.enum(CATEGORY_KINDS, {
    errorMap: () => ({ message: "Tipo de categoria inválido." }),
  }),
  name: z
    .string({ required_error: "Informe o nome da categoria." })
    .trim()
    .min(1, "Informe o nome da categoria.")
    .max(NAME_MAX, `Nome deve ter no máximo ${NAME_MAX} caracteres.`),
});

export type CreateCategoryInput = z.output<typeof createCategorySchema>;

// ─── Schema de renomear categoria (Req 3.3) ─────────────────────────────────

/**
 * Schema para renomear uma categoria existente (inclusive as de sistema).
 */
export const renameCategorySchema = z.object({
  id: z
    .string({ required_error: "Categoria não identificada." })
    .trim()
    .min(1, "Categoria não identificada."),
  name: z
    .string({ required_error: "Informe o nome da categoria." })
    .trim()
    .min(1, "Informe o nome da categoria.")
    .max(NAME_MAX, `Nome deve ter no máximo ${NAME_MAX} caracteres.`),
});

export type RenameCategoryInput = z.output<typeof renameCategorySchema>;

// ─── Mapeamento banco → UI ──────────────────────────────────────────────────

/**
 * Linha da tabela `categories` (snake_case) retornada pelo Supabase.
 */
export interface CategoryRow {
  id: string;
  kind: CategoryKind;
  name: string;
  sort_order: number;
  is_active: boolean;
  is_system: boolean;
  created_at?: string;
  updated_at?: string;
}

/** Rótulos pt-BR para os tipos de categoria. */
export const CATEGORY_KIND_LABELS: Record<CategoryKind, string> = {
  receita: "Receita",
  despesa: "Despesa",
};

/**
 * Estado retornado pelas Server Actions de categorias. Simples: sucesso/erro
 * com mensagem (os formulários são compactos — nome e tipo), sem mapeamento
 * de erros por campo.
 */
export interface CategoryActionState {
  status: "idle" | "success" | "error";
  message?: string;
}
