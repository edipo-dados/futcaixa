import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { CategoryOption } from "./recurring-form";

/**
 * Carregadores de dados para o formulário de despesas recorrentes (server-side).
 *
 * Uma despesa recorrente é sempre uma DESPESA (Req 4.1). Oferecemos apenas as
 * categorias ATIVAS do tipo `despesa` — categorias desativadas saem de novos
 * cadastros (análogo ao Req 3.4 dos lançamentos).
 *
 * MULTI-TENANT (tarefa 21.6): as categorias são sempre do FUTEBOL ATIVO
 * (`.eq('club_id', clubId)`), para nunca cruzar categorias entre clubes
 * (Req 10.1). A RLS reforça o mesmo isolamento no Postgres.
 */

/**
 * Carrega as categorias ativas de DESPESA do clube informado, ordenadas para
 * exibição. O `clubId` é sempre o do clube ativo da sessão (resolvido na page).
 */
export async function loadActiveExpenseCategories(
  clubId: string,
): Promise<CategoryOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, name")
    .eq("club_id", clubId)
    .eq("kind", "despesa")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<CategoryOption[]>();

  if (error || !data) return [];
  return data;
}
