import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getMembershipSession } from "@/lib/auth/membership";
import { fromCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

import { RecurringActiveToggle } from "./recurring-active-toggle";

/**
 * Página de Despesas Recorrentes (Server Component — presidente/tesoureiro).
 *
 * Lista as despesas recorrentes do FUTEBOL ATIVO com descrição, categoria,
 * valor formatado em BRL, dia do mês, selo de ativa/inativa e o último período
 * já gerado (quando houver). A leitura usa o cliente ligado à sessão, de modo
 * que a RLS também se aplique.
 *
 * MULTI-TENANT (tarefa 21.6): a listagem é escopada ao clube ativo
 * (`.eq('club_id', ...)`); sem futebol ativo, redireciona ao dashboard (padrão
 * das telas internas). Apenas presidente/tesoureiro gerenciam (Req 10.1); o
 * guard abaixo é a barreira de UX no servidor e a RLS é a autoridade final.
 *
 * Requisitos: 10.1 (cadastro por clube), 10.4 (ativar/desativar).
 */

/** Linha de despesa recorrente com a categoria usada na exibição. */
interface RecurringListRow {
  id: string;
  amount_cents: number;
  description: string;
  day_of_month: number;
  is_active: boolean;
  last_generated_period: string | null;
  category: { name: string } | null;
}

async function loadRecurring(clubId: string): Promise<RecurringListRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recurring_expenses")
    .select(
      "id, amount_cents, description, day_of_month, is_active, last_generated_period, category:categories(name)",
    )
    .eq("club_id", clubId)
    .order("is_active", { ascending: false })
    .order("day_of_month", { ascending: true })
    .order("created_at", { ascending: false })
    .returns<RecurringListRow[]>();

  if (error || !data) return [];
  return data;
}

export default async function RecorrentesPage() {
  const session = await getMembershipSession();

  // Guard no servidor: sem futebol ativo não há o que escopar (Req 6.3) e só
  // presidente/tesoureiro gerenciam despesas recorrentes (Req 10.1).
  if (!session || !session.activeClub) {
    redirect("/dashboard");
  }
  if (session.role !== "presidente" && session.role !== "tesoureiro") {
    redirect("/dashboard");
  }

  const recurring = await loadRecurring(session.activeClub.clubId);

  return (
    <div className="container max-w-4xl py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Despesas recorrentes</h1>
          <p className="mt-1 text-muted-foreground">
            Despesas que se repetem (ex.: aluguel da quadra) e são lançadas
            automaticamente no dia configurado.
          </p>
        </div>
        <Button asChild>
          <Link href="/recorrentes/nova">
            <Plus aria-hidden="true" />
            Nova despesa recorrente
          </Link>
        </Button>
      </div>

      {recurring.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          Nenhuma despesa recorrente cadastrada ainda. Clique em{" "}
          <span className="font-medium">Nova despesa recorrente</span> para
          começar.
        </div>
      ) : (
        <ul className="space-y-2">
          {recurring.map((r) => (
            <li
              key={r.id}
              className="flex items-start gap-3 rounded-md border bg-card p-4"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/recorrentes/${r.id}/editar`}
                  className="block rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate font-medium">{r.description}</p>
                    <span className="shrink-0 font-semibold tabular-nums text-destructive">
                      {fromCents(r.amount_cents)}
                    </span>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span
                      className={
                        r.is_active
                          ? "rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-800 dark:bg-green-950 dark:text-green-200"
                          : "rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground"
                      }
                    >
                      {r.is_active ? "Ativa" : "Inativa"}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>Todo dia {r.day_of_month}</span>
                    {r.category?.name ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{r.category.name}</span>
                      </>
                    ) : null}
                    {r.last_generated_period ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Último gerado: {r.last_generated_period}</span>
                      </>
                    ) : null}
                  </p>
                </Link>
              </div>
              <RecurringActiveToggle
                recurringId={r.id}
                isActive={r.is_active}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
