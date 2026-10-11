import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ChargeKind } from "@/lib/validation/charge";
import type { PendingProofRow } from "@/lib/validation/proof-review";

/**
 * Carregadores de dados da tela de Aprovações (server-side, tarefa 9.6).
 *
 * A revisão lista as cobranças atualmente `em_analise` com o comprovante mais
 * recente `em_analise` de cada uma (join charges + players + payment_proofs).
 * A leitura usa o cliente ligado à sessão: a RLS garante que apenas
 * presidente/tesoureiro do clube enxergam comprovantes de terceiros.
 *
 * MULTI-TENANT (tarefa 21): a fila é escopada ao FUTEBOL ATIVO via `club_id`.
 * Filtramos tanto `payment_proofs.club_id` quanto `charges.club_id` pelo clube
 * ativo (ambas as tabelas carregam `club_id`) para não listar comprovantes de
 * outro futebol — defesa em profundidade; a RLS no Postgres é a autoridade
 * final.
 */

interface PendingProofQueryRow {
  id: string;
  file_path: string;
  created_at: string;
  charge: {
    id: string;
    club_id: string;
    amount_cents: number;
    description: string;
    kind: ChargeKind;
    period: string | null;
    due_date: string;
    status: string;
    deleted_at: string | null;
    player: { name: string; nickname: string | null } | null;
  } | null;
}

/**
 * Carrega os comprovantes `em_analise` do FUTEBOL ATIVO cujas cobranças também
 * estão `em_analise` (não excluídas), ordenados do mais recente para o mais
 * antigo.
 *
 * Mantém apenas o comprovante mais recente por cobrança: se um jogador reenviar
 * um comprovante, exibimos o último, evitando duplicar a mesma cobrança na
 * fila de revisão.
 *
 * @param clubId `clubs.id` do futebol ativo; escopa a fila ao clube.
 */
export async function loadPendingProofs(
  clubId: string,
): Promise<PendingProofRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payment_proofs")
    .select(
      "id, file_path, created_at, charge:charges!inner(id, club_id, amount_cents, description, kind, period, due_date, status, deleted_at, player:players(name, nickname))",
    )
    .eq("status", "em_analise")
    .eq("club_id", clubId)
    .eq("charge.club_id", clubId)
    .order("created_at", { ascending: false })
    .returns<PendingProofQueryRow[]>();

  if (error || !data) return [];

  const seenCharges = new Set<string>();
  const rows: PendingProofRow[] = [];

  for (const row of data) {
    const charge = row.charge;
    // Só cobranças do clube ativo, em análise e não excluídas entram na fila.
    if (
      !charge ||
      charge.club_id !== clubId ||
      charge.deleted_at !== null ||
      charge.status !== "em_analise"
    ) {
      continue;
    }
    // Apenas o comprovante mais recente por cobrança (a lista já vem desc).
    if (seenCharges.has(charge.id)) continue;
    seenCharges.add(charge.id);

    rows.push({
      proofId: row.id,
      filePath: row.file_path,
      createdAt: row.created_at,
      chargeId: charge.id,
      amountCents: charge.amount_cents,
      description: charge.description,
      kind: charge.kind,
      period: charge.period,
      dueDate: charge.due_date,
      playerName: charge.player?.name ?? "Jogador removido",
      playerNickname: charge.player?.nickname ?? null,
    });
  }

  return rows;
}
