import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { ActiveGoal } from "@/app/(app)/dashboard/data";
import { computeGoalProgress } from "@/lib/goals";
import { fromCents } from "@/lib/money";

interface GoalsSectionProps {
  goals: ActiveGoal[];
}

/** Formata o percentual da meta em pt-BR (ex.: "62%", "62,5%"). */
function formatPercent(percent: number): string {
  return `${percent.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })}%`;
}

/**
 * Seção de metas/vaquinhas do dashboard (Req 8.6).
 *
 * Componente presentacional (sem estado): para cada meta ativa exibe o título,
 * "R$ acumulado / R$ alvo" (fromCents), o percentual e uma barra de progresso.
 * O cálculo do percentual (limitado a 0..100) vem do helper puro
 * `computeGoalProgress`. Mobile-first: lista empilhada no celular, duas colunas
 * em telas largas.
 *
 * Não renderiza nada quando não há metas ativas — o `page.tsx` decide se mostra
 * a seção, mas protegemos aqui também para o componente ser seguro de reusar.
 */
export function GoalsSection({ goals }: GoalsSectionProps) {
  if (goals.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="mb-3 text-lg font-semibold">Metas e vaquinhas</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {goals.map((goal) => {
          const { percent } = computeGoalProgress(
            goal.currentCents,
            goal.targetCents,
          );

          return (
            <Card key={goal.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{goal.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="tabular-nums text-muted-foreground">
                    {fromCents(goal.currentCents)} / {fromCents(goal.targetCents)}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatPercent(percent)}
                  </span>
                </div>
                <Progress
                  value={percent}
                  aria-label={`Progresso da meta ${goal.title}`}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
