import "server-only";

import { loadSettings } from "@/app/(app)/configuracoes/actions";
import { todayISO } from "@/lib/date";
import { createClient } from "@/lib/supabase/server";
import type { ChargeKind } from "@/lib/validation/charge";

import type { PlayerOption } from "./charge-form";

/**
 * Mapa de tipo de cobrança → nome da categoria de RECEITA correspondente
 * (Req 5.6). Os nomes espelham as categorias semeadas (`is_system`) na
 * migration 2.1: "Mensalidade", "Avulso", "Multa", "Vaquinha". Quando a
 * categoria mapeada não existir (ex.: renomeada/excluída), caímos no fallback
 * "Outros" (também semeado) em `resolveReceitaCategoryId`.
 */
const CHARGE_KIND_TO_CATEGORY_NAME: Record<ChargeKind, string> = {
  mensalidade: "Mensalidade",
  avulso: "Avulso",
  multa: "Multa",
  vaquinha: "Vaquinha",
};

/** Nome da categoria de receita usada como fallback (também semeada). */
const FALLBACK_RECEITA_CATEGORY_NAME = "Outros";

/**
 * Carregadores de dados para o formulário de cobranças (server-side).
 *
 * O formulário de criação manual (Req 5.3) precisa dos jogadores ativos (para
 * o select) e do dia de vencimento padrão das Configurações (Req 5.8), usado
 * para pré-preencher a data de vencimento. A leitura usa o cliente ligado à
 * sessão, de modo que a RLS também se aplique.
 *
 * MULTI-TENANT (tarefa 21.5): todas as leituras são escopadas ao FUTEBOL ATIVO
 * via `club_id`. Jogadores e configurações são filtrados pelo clube; a RLS no
 * Postgres é a autoridade final (membro do clube lê; demais clubes não vazam).
 */

/**
 * Carrega os jogadores ativos e não excluídos do clube informado, ordenados
 * por nome. O filtro `club_id` garante que o select de cobrança só ofereça
 * jogadores do futebol ativo (Req 11.3).
 */
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

/**
 * Carrega o dia de vencimento padrão (`settings.due_day`, Req 5.8) do FUTEBOL
 * informado. Multi-tenant (tarefa 21.5): lê a `settings` por `club_id` via
 * `loadSettings(clubId)` em vez do antigo singleton `id = 1`. Retorna `null`
 * quando não há linha ou o valor é inválido, deixando o fallback a cargo do
 * chamador.
 */
export async function loadDueDay(clubId: string): Promise<number | null> {
  const settings = await loadSettings(clubId);
  if (!settings) return null;

  const dueDay = Number(settings.due_day);
  return Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 28
    ? dueDay
    : null;
}

/**
 * Resolve o id da categoria de RECEITA correspondente ao tipo da cobrança
 * (Req 5.6), para vincular o lançamento gerado ao marcar como paga.
 *
 * Estratégia:
 *  1. Procura uma categoria `receita` cujo nome seja o mapeado (comparação
 *     case-insensitive), preferindo as ATIVAS.
 *  2. Se não encontrar, procura a categoria de fallback "Outros" (receita).
 *  3. Se ainda assim nada existir, retorna `null` e o chamador orienta o
 *     usuário a criar a categoria.
 *
 * A busca usa `ilike` para tolerar renomeações de caixa e `is_active`
 * (ordenado desc) para preferir categorias ativas sem exigir que existam.
 * Lançamentos antigos preservam a categoria original (Req 3.5), então usar a
 * categoria pelo nome atual é adequado para o novo lançamento.
 *
 * MULTI-TENANT (tarefa 21.5): a busca é escopada ao `clubId` (categorias são
 * por clube — Req 11.5); só resolve categorias do futebol da cobrança.
 */
export async function resolveReceitaCategoryId(
  kind: ChargeKind,
  clubId: string,
): Promise<string | null> {
  const supabase = await createClient();

  const findByName = async (name: string): Promise<string | null> => {
    const { data, error } = await supabase
      .from("categories")
      .select("id, is_active")
      .eq("club_id", clubId)
      .eq("kind", "receita")
      .ilike("name", name)
      .order("is_active", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; is_active: boolean }>();

    if (error || !data) return null;
    return data.id;
  };

  const mapped = await findByName(CHARGE_KIND_TO_CATEGORY_NAME[kind]);
  if (mapped) return mapped;

  // Fallback: categoria de receita "Outros".
  return findByName(FALLBACK_RECEITA_CATEGORY_NAME);
}

/**
 * Linha mínima da cobrança necessária para gerar a receita vinculada.
 *
 * MULTI-TENANT (tarefa 21.5): inclui o `club_id` da cobrança para que a receita
 * gerada seja escopada ao MESMO futebol (Req 11.5).
 */
export interface RevenueChargeRow {
  id: string;
  club_id: string;
  player_id: string;
  amount_cents: number;
  description: string;
  kind: ChargeKind;
  period: string | null;
}

/** Resultado da geração de receita (shared helper). */
export type GenerateRevenueResult =
  | { ok: true; created: boolean }
  | { ok: false; message: string };

/**
 * Monta a descrição do lançamento de receita gerado a partir da cobrança
 * (Req 5.6/6.6). Mensalidades ganham o período de referência; os demais tipos
 * reaproveitam a descrição original da cobrança.
 */
export function revenueDescription(charge: RevenueChargeRow): string {
  if (charge.kind === "mensalidade" && charge.period) {
    return `Mensalidade ${charge.period}`;
  }
  return `Pagamento: ${charge.description}`;
}

/**
 * Gera (uma única vez) o lançamento de RECEITA vinculado a uma cobrança paga
 * (Req 5.6 ao marcar como paga; Req 6.6 ao aprovar o comprovante).
 *
 * Compartilhado entre `markChargePaid` (tarefa 8.3) e `approveProof`
 * (tarefa 9.6) para garantir que a receita seja gerada EXATAMENTE UMA VEZ, com
 * a mesma regra de categoria/descrição, independentemente do caminho usado.
 *
 * Idempotência: antes de inserir, verifica que não existe nenhum lançamento
 * (não excluído) com o mesmo `charge_id`. Se já existir, retorna
 * `{ ok: true, created: false }` sem duplicar a receita.
 *
 * Resolve a categoria de receita pelo tipo da cobrança
 * (`resolveReceitaCategoryId`). Se não houver categoria de receita, retorna
 * `{ ok: false }` com mensagem orientando o usuário.
 *
 * Usa o cliente de sessão recebido por parâmetro, de modo que a RLS e os
 * triggers de auditoria capturem o actor (Req 5.7/6.6/11.3).
 *
 * @param supabase cliente Supabase ligado à sessão do usuário.
 * @param charge cobrança (já paga) de origem da receita.
 * @param createdBy id do perfil do usuário que efetivou o pagamento.
 */
export async function generateChargeRevenue(
  supabase: Awaited<ReturnType<typeof createClient>>,
  charge: RevenueChargeRow,
  createdBy: string,
): Promise<GenerateRevenueResult> {
  // Guarda de idempotência: não duplica receita se já existir uma vinculada
  // a esta cobrança (não excluída).
  const { data: existing } = await supabase
    .from("transactions")
    .select("id")
    .eq("charge_id", charge.id)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (existing) {
    return { ok: true, created: false };
  }

  // Resolve a categoria de receita do MESMO clube da cobrança (orienta se não
  // existir). O escopo por `club_id` evita vincular a receita a uma categoria
  // de outro futebol (Req 11.5).
  const categoryId = await resolveReceitaCategoryId(charge.kind, charge.club_id);
  if (!categoryId) {
    return {
      ok: false,
      message:
        'Nenhuma categoria de receita encontrada. Crie uma categoria de receita (ex.: "Outros") em Categorias e tente novamente.',
    };
  }

  // A receita herda o `club_id` da cobrança: fica escopada ao mesmo futebol
  // (Req 11.5). A RLS reforça que só gestores do clube inserem lançamentos.
  const { error: insertError } = await supabase.from("transactions").insert({
    club_id: charge.club_id,
    kind: "receita",
    amount_cents: charge.amount_cents,
    occurred_on: todayISO(),
    category_id: categoryId,
    description: revenueDescription(charge),
    player_id: charge.player_id,
    charge_id: charge.id,
    created_by: createdBy,
  });

  if (insertError) {
    return {
      ok: false,
      message: `Falha ao gerar a receita: ${insertError.message}`,
    };
  }

  return { ok: true, created: true };
}
