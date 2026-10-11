import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getMembershipSession } from "@/lib/auth/membership";
import { formatDate, todayISO } from "@/lib/date";
import { ChargeRowActions } from "./charge-row-actions";
import { fromCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import {
  CHARGE_KIND_LABELS,
  CHARGE_STATUS_LABELS,
  type ChargeKind,
  type ChargeStatus,
} from "@/lib/validation/charge";

/**
 * Página de Cobranças (Server Component — admin/tesoureiro).
 *
 * Lista as cobranças não excluídas do FUTEBOL ATIVO (mais recentes por
 * vencimento), mostrando o jogador, o tipo, o valor em BRL, o vencimento, o
 * status e um indicador derivado de "Atrasada" (vencimento no passado E status
 * `pendente` — Req 11.4, nunca armazenado). A leitura usa o cliente ligado à
 * sessão, de modo que a RLS também se aplique.
 *
 * MULTI-TENANT (tarefa 21.5): a listagem é escopada ao clube ativo
 * (`.eq('club_id', ...)`). Sem futebol ativo, redireciona ao dashboard (padrão
 * das telas internas). Só presidente ou tesoureiro do clube ativo gerenciam
 * cobranças; a RLS no Postgres é a autoridade final.
 *
 * Transições de status: cada linha pendente/em análise oferece "Marcar paga"
 * (gera a receita vinculada e escopada ao clube — Req 11.5) e "Cancelar"
 * (auditado — Req 11.6/11.7) via `ChargeRowActions`. As cobranças pagas exibem
 * a data de pagamento.
 *
 * Requisitos: 11.3, 11.4, 11.5, 11.6, 11.7.
 */

/** Linha de cobrança com o jogador usado na exibição. */
interface ChargeListRow {
  id: string;
  amount_cents: number;
  description: string;
  kind: ChargeKind;
  period: string | null;
  due_date: string;
  status: ChargeStatus;
  paid_at: string | null;
  player: { name: string; nickname: string | null } | null;
}

async function loadCharges(clubId: string): Promise<ChargeListRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("charges")
    .select(
      "id, amount_cents, description, kind, period, due_date, status, paid_at, player:players(name, nickname)",
    )
    .eq("club_id", clubId)
    .is("deleted_at", null)
    .order("due_date", { ascending: false })
    .order("created_at", { ascending: false })
    .returns<ChargeListRow[]>();

  if (error || !data) return [];
  return data;
}

/** Classe do selo de status (cores por estado). */
function statusBadgeClass(status: ChargeStatus): string {
  switch (status) {
    case "paga":
      return "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200";
    case "em_analise":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200";
    case "cancelada":
      return "bg-muted text-muted-foreground";
    case "pendente":
    default:
      return "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200";
  }
}

export default async function CobrancasPage() {
  const session = await getMembershipSession();

  // Guard no servidor: sem futebol ativo não há o que escopar (Req 11.3).
  if (!session || !session.activeClub) {
    redirect("/dashboard");
  }

  // Só presidente ou tesoureiro do clube ativo gerenciam cobranças (Req 11.3).
  if (session.role !== "presidente" && session.role !== "tesoureiro") {
    redirect("/dashboard");
  }

  const charges = await loadCharges(session.activeClub.clubId);
  const today = todayISO();

  return (
    <div className="container max-w-4xl py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cobranças</h1>
          <p className="mt-1 text-muted-foreground">
            Cobranças dos jogadores (mensalidade, avulso, multa e vaquinha) com
            vencimento e status.
          </p>
        </div>
        <Button asChild>
          <Link href="/cobrancas/nova">
            <Plus aria-hidden="true" />
            Nova cobrança
          </Link>
        </Button>
      </div>

      {charges.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          Nenhuma cobrança cadastrada ainda. Clique em{" "}
          <span className="font-medium">Nova cobrança</span> para começar.
        </div>
      ) : (
        <ul className="space-y-2">
          {charges.map((c) => {
            const playerLabel = c.player
              ? c.player.nickname
                ? `${c.player.name} (${c.player.nickname})`
                : c.player.name
              : "Jogador removido";
            const isOverdue = c.status === "pendente" && c.due_date < today;
            // Botões de transição só para estados não terminais (Req 5.4).
            const canTransition =
              c.status === "pendente" || c.status === "em_analise";

            return (
              <li
                key={c.id}
                className="flex items-start gap-3 rounded-md border bg-card p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate font-medium">{playerLabel}</p>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {fromCents(c.amount_cents)}
                    </span>
                  </div>
                  {c.description ? (
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {c.description}
                    </p>
                  ) : null}
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium ${statusBadgeClass(
                        c.status,
                      )}`}
                    >
                      {CHARGE_STATUS_LABELS[c.status]}
                    </span>
                    {isOverdue && (
                      <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive">
                        Atrasada
                      </span>
                    )}
                    <span aria-hidden="true">·</span>
                    <span>{CHARGE_KIND_LABELS[c.kind]}</span>
                    <span aria-hidden="true">·</span>
                    <span>Vence {formatDate(c.due_date)}</span>
                    {c.period ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Ref. {c.period}</span>
                      </>
                    ) : null}
                    {c.status === "paga" && c.paid_at ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Paga em {formatDate(c.paid_at)}</span>
                      </>
                    ) : null}
                  </p>
                  {canTransition ? <ChargeRowActions chargeId={c.id} /> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
