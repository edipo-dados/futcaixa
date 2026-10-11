import "server-only";

import { todayISO } from "@/lib/date";
import type { OverdueCharge } from "@/lib/delinquency";
import { createClient } from "@/lib/supabase/server";

/**
 * Carregador de cobranças atrasadas para a tela de Inadimplentes (Req 13.1).
 *
 * "Atrasada" é um estado DERIVADO (Req 5.5), nunca armazenado: cobrança
 * `pendente` com vencimento no passado (`due_date < hoje`) e não excluída. A
 * seleção acontece aqui, na query, e a agregação por jogador fica no helper
 * puro `aggregateDelinquents` (`lib/delinquency.ts`), fácil de testar.
 *
 * MULTI-TENANT (tarefa 21.7): a leitura é escopada ao futebol ATIVO
 * (`.eq('club_id', clubId)`), e o join traz apenas os jogadores do mesmo clube
 * — nunca cruza futebóis. A leitura usa o cliente ligado à sessão, de modo que
 * a RLS também se aplique (presidente/tesoureiro do clube enxergam as
 * cobranças do próprio futebol).
 */

/** Formato bruto retornado pela query (join com `players`). */
interface OverdueChargeRow {
  player_id: string;
  amount_cents: number;
  due_date: string;
  period: string | null;
  player: { name: string; nickname: string | null } | null;
}

/**
 * Carrega as cobranças atrasadas (pendentes e vencidas) do futebol informado,
 * já no formato de entrada do agregador. Cobranças cujo jogador foi removido
 * são ignoradas (não há nome a exibir).
 *
 * O filtro explícito por `club_id` escopa a lista ao futebol ATIVO e, somado ao
 * join com `players` do mesmo clube, impede qualquer cruzamento entre futebóis
 * (defesa em profundidade junto à RLS).
 */
export async function loadOverdueCharges(
  clubId: string,
  now: Date = new Date(),
): Promise<OverdueCharge[]> {
  const supabase = await createClient();
  const today = todayISO(now);

  const { data, error } = await supabase
    .from("charges")
    .select(
      "player_id, amount_cents, due_date, period, player:players(name, nickname)",
    )
    .eq("club_id", clubId)
    .eq("status", "pendente")
    .lt("due_date", today)
    .is("deleted_at", null)
    .order("due_date", { ascending: true })
    .returns<OverdueChargeRow[]>();

  if (error || !data) return [];

  return data
    .filter((row): row is OverdueChargeRow & { player: NonNullable<OverdueChargeRow["player"]> } =>
      row.player != null,
    )
    .map((row) => ({
      playerId: row.player_id,
      playerName: row.player.name,
      playerNickname: row.player.nickname,
      amountCents: row.amount_cents,
      dueDate: row.due_date,
      period: row.period,
    }));
}
