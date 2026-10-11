import { ExpenseProofLink } from "@/app/(app)/dashboard/expense-proof-link";
import type { RecentExpense } from "@/app/(app)/dashboard/data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/date";
import { fromCents } from "@/lib/money";

interface RecentExpensesSectionProps {
  expenses: RecentExpense[];
}

/**
 * Seção "Últimas despesas" do dashboard (tarefa 11.5 — Req 8.7).
 *
 * Lista as despesas mais recentes a nível de caixa para dar TRANSPARÊNCIA ao
 * grupo: data, categoria, descrição e valor (BRL). Quando a despesa tem
 * comprovante, exibe o botão "Ver comprovante" (`ExpenseProofLink`), que abre o
 * arquivo por URL assinada do servidor. A lista NÃO expõe identidade individual
 * (são despesas de caixa, não cobranças por jogador — Req 8.8).
 *
 * Mobile-first: cada despesa é uma linha empilhada no celular; em telas largas
 * data/categoria/valor se alinham horizontalmente. Não renderiza nada quando
 * não há despesas, para o dashboard ficar limpo em banco vazio.
 */
export function RecentExpensesSection({
  expenses,
}: RecentExpensesSectionProps) {
  if (expenses.length === 0) return null;

  return (
    <section className="mt-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Últimas despesas</CardTitle>
          <p className="text-sm text-muted-foreground">
            Despesas recentes do caixa, com comprovante quando disponível
            (transparência).
          </p>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {expenses.map((expense) => (
              <li
                key={expense.id}
                className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium">
                      {expense.categoryName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(expense.occurredOn)}
                    </span>
                  </div>
                  {expense.description && (
                    <p className="truncate text-sm text-muted-foreground">
                      {expense.description}
                    </p>
                  )}
                  {expense.proofPath && (
                    <div className="mt-1">
                      <ExpenseProofLink path={expense.proofPath} />
                    </div>
                  )}
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {fromCents(expense.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
