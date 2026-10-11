import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Volleyball } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getMembershipSession } from "@/lib/auth/membership";
import { formatDate } from "@/lib/date";
import { fromCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import {
  TRANSACTION_KIND_LABELS,
  type TransactionKind,
} from "@/lib/validation/transaction";

import { DeleteTransactionButton } from "./delete-transaction-button";
import { ProofLink } from "./proof-link";

/**
 * Página de Lançamentos (Server Component — presidente/tesoureiro, Req 9.11).
 *
 * MULTI-TENANT (tarefa 21.4): lista os lançamentos não excluídos (soft delete)
 * do FUTEBOL ATIVO (`.eq('club_id', clubId)`), do mais recente ao mais antigo,
 * com data, tipo, valor formatado em BRL, categoria, descrição, jogador (quando
 * houver) e um indicador/visualizador de comprovante. A leitura usa o cliente
 * ligado à sessão, de modo que a RLS também se aplica; ainda assim filtramos por
 * `club_id` explicitamente (defesa em profundidade).
 *
 * Guard de acesso: sem futebol ativo → redirect ao onboarding "sem futebol"
 * (padrão das telas internas); somente `presidente` ou `tesoureiro` do clube
 * ativo gerenciam lançamentos (Req 9.11). A RLS reforça a regra no banco.
 *
 * Requisitos: 9.1, 9.7, 9.9, 9.11.
 */

/** Linha de lançamento com os relacionamentos usados na exibição. */
interface TransactionListRow {
  id: string;
  kind: TransactionKind;
  amount_cents: number;
  occurred_on: string;
  description: string;
  proof_path: string | null;
  category: { name: string } | null;
  player: { name: string; nickname: string | null } | null;
}

async function loadTransactions(
  clubId: string,
): Promise<TransactionListRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select(
      "id, kind, amount_cents, occurred_on, description, proof_path, category:categories(name), player:players(name, nickname)",
    )
    .eq("club_id", clubId)
    .is("deleted_at", null)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .returns<TransactionListRow[]>();

  if (error || !data) return [];
  return data;
}

export default async function LancamentosPage() {
  const session = await getMembershipSession();

  // Sem sessão ou sem futebol ativo: cai no fluxo de onboarding "sem futebol".
  if (!session || session.hasNoClub || !session.activeClub) {
    redirect("/sem-futebol");
  }

  // Guard no servidor: só presidente/tesoureiro gerenciam lançamentos (Req 9.11).
  if (session.role !== "presidente" && session.role !== "tesoureiro") {
    redirect("/dashboard");
  }

  const transactions = await loadTransactions(session.activeClub.clubId);

  return (
    <div className="container max-w-4xl py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Lançamentos</h1>
          <p className="mt-1 text-muted-foreground">
            Receitas e despesas do caixa, com categoria e comprovante.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button asChild variant="outline">
            <Link href="/lancamentos/dia-do-jogo">
              <Volleyball aria-hidden="true" />
              Despesa do dia do jogo
            </Link>
          </Button>
          <Button asChild>
            <Link href="/lancamentos/novo">
              <Plus aria-hidden="true" />
              Novo lançamento
            </Link>
          </Button>
        </div>
      </div>

      {transactions.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          Nenhum lançamento registrado ainda. Clique em{" "}
          <span className="font-medium">Novo lançamento</span> para começar.
        </div>
      ) : (
        <ul className="space-y-2">
          {transactions.map((t) => {
            const isReceita = t.kind === "receita";
            const playerLabel = t.player
              ? t.player.nickname
                ? `${t.player.name} (${t.player.nickname})`
                : t.player.name
              : null;

            return (
              <li
                key={t.id}
                className="flex items-start gap-3 rounded-md border bg-card p-4"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/lancamentos/${t.id}/editar`}
                    className="block rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate font-medium">{t.description}</p>
                      <span
                        className={`shrink-0 font-semibold tabular-nums ${
                          isReceita
                            ? "text-green-700 dark:text-green-400"
                            : "text-destructive"
                        }`}
                      >
                        {isReceita ? "+" : "−"} {fromCents(t.amount_cents)}
                      </span>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>{formatDate(t.occurred_on)}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          isReceita
                            ? "rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-800 dark:bg-green-950 dark:text-green-200"
                            : "rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-800 dark:bg-red-950 dark:text-red-200"
                        }
                      >
                        {TRANSACTION_KIND_LABELS[t.kind]}
                      </span>
                      {t.category?.name ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{t.category.name}</span>
                        </>
                      ) : null}
                      {playerLabel ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{playerLabel}</span>
                        </>
                      ) : null}
                    </p>
                  </Link>
                  {t.proof_path ? (
                    <div className="mt-2">
                      <ProofLink path={t.proof_path} />
                    </div>
                  ) : null}
                </div>
                <DeleteTransactionButton transactionId={t.id} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
