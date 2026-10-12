import type { RecentIncome } from "@/app/(app)/dashboard/data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/date";
import { fromCents } from "@/lib/money";

interface RecentIncomesSectionProps {
  incomes: RecentIncome[];
}

/**
 * Seção "Últimas receitas" do dashboard — espelho de `RecentExpensesSection`
 * para o lado das ENTRADAS. Dá transparência de onde o dinheiro entrou
 * (mensalidades, avulsos, doações...): categoria, data, descrição e valor.
 * Não expõe identidade individual de jogador. Não renderiza nada em banco
 * vazio.
 */
export function RecentIncomesSection({ incomes }: RecentIncomesSectionProps) {
  if (incomes.length === 0) return null;

  return (
    <section className="mt-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Últimas receitas</CardTitle>
          <p className="text-sm text-muted-foreground">
            Entradas recentes do caixa (transparência).
          </p>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {incomes.map((income) => (
              <li
                key={income.id}
                className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium">
                      {income.categoryName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(income.occurredOn)}
                    </span>
                  </div>
                  {income.description && (
                    <p className="truncate text-sm text-muted-foreground">
                      {income.description}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-green-700 dark:text-green-300">
                  {fromCents(income.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}
