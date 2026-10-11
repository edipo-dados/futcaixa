import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { CategoryOption, PlayerOption } from "./transaction-form";

/**
 * Carregadores de dados para os formulários de lançamento (server-side).
 *
 * MULTI-TENANT (tarefa 21.4): categorias e jogadores oferecidos nos dropdowns
 * são SEMPRE escopados ao FUTEBOL ATIVO (`.eq('club_id', clubId)`), de modo que
 * um lançamento nunca cruze dados entre clubes — a categoria e o jogador
 * vinculados precisam ser do mesmo futebol (Req 9.7). A RLS reforça a regra no
 * banco; o filtro explícito aqui é defesa em profundidade.
 *
 * As categorias oferecidas no form são apenas as ATIVAS (categorias desativadas
 * saem de novos lançamentos); o filtro por tipo (receita/despesa) acontece no
 * cliente. Os jogadores são os ativos e não excluídos.
 */

/** Carrega as categorias ativas do clube (ambos os tipos), ordenadas para exibição. */
export async function loadActiveCategories(
  clubId: string,
): Promise<CategoryOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, kind, name")
    .eq("club_id", clubId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<CategoryOption[]>();

  if (error || !data) return [];
  return data;
}

/** Carrega os jogadores ativos e não excluídos do clube, para o vínculo opcional. */
export async function loadActivePlayers(
  clubId: string,
): Promise<PlayerOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("players")
    .select("id, name, nickname")
    .eq("club_id", clubId)
    .eq("status", "ativo")
    .is("deleted_at", null)
    .order("name", { ascending: true })
    .returns<PlayerOption[]>();

  if (error || !data) return [];
  return data;
}
