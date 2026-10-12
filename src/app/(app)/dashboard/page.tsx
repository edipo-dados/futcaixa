import { redirect } from "next/navigation";

import { BalanceChart } from "@/components/charts/BalanceChart";
import { CategoryBreakdownChart } from "@/components/charts/CategoryBreakdownChart";
import { IncomeExpenseChart } from "@/components/charts/IncomeExpenseChart";
import { GoalsSection } from "@/components/GoalsSection";
import { RecentExpensesSection } from "@/components/RecentExpensesSection";
import { RecentIncomesSection } from "@/components/RecentIncomesSection";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMembershipSession } from "@/lib/auth/membership";
import { currentPeriod, isValidPeriod } from "@/lib/date";
import { fromCents } from "@/lib/money";

import { MonthPicker } from "./month-picker";

import {
  getActiveGoals,
  getAdimplenciaRate,
  getBalanceSeries,
  getCategoryBreakdownMonth,
  getCategoryBreakdownYear,
  getCurrentBalanceCents,
  getIncomeBreakdownMonth,
  getIncomeBreakdownYear,
  getIncomeExpenseSeries,
  getMonthSummary,
  getPlayerCounts,
  getRecentExpenses,
  getRecentIncomes,
  getRunwayMonths,
} from "./data";

/**
 * Dashboard (Server Component) — acessível a QUALQUER membro ativo do futebol
 * (presidente, tesoureiro ou jogador), sem restrição por papel além de exigir
 * membership ativa.
 *
 * MULTI-TENANT (tarefa 21.8): resolve a sessão multi-tenant e opera sempre
 * sobre o futebol ATIVO. Sem clube ativo (estado "sem futebol") redireciona ao
 * onboarding `/sem-futebol`, como as demais telas internas. Os cards, gráficos,
 * runway, metas e últimas despesas leem SOMENTE as views agregadas (Req 8.8),
 * sempre filtradas por `club_id` do clube ativo — nunca cruzando futebóis. O
 * saldo atual já embute `settings.initial_balance_cents` do clube (via
 * `v_balance_history`). A RLS no Postgres é a autoridade final; o filtro por
 * `club_id` nos loaders é defesa em profundidade + isolamento no dashboard.
 *
 * Mobile-first: grade de 1 coluna no celular, 2 em telas pequenas e 4 em
 * telas grandes.
 */

/** Formata o percentual de adimplência (ou "—" quando não há cobranças). */
function formatRate(rate: number | null): string {
  if (rate == null) return "—";
  // A view devolve o percentual com 2 casas; normalizamos para pt-BR.
  return `${rate.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}%`;
}

/**
 * Formata o runway (Req 8.5): "X,X meses" (1 casa decimal, pt-BR) ou
 * "Sem despesas recentes" quando não há como calcular (média de despesas zero
 * ou sem histórico recente — divisão por zero tratada no helper).
 */
function formatRunway(months: number | null): string {
  if (months == null) return "Sem despesas recentes";
  const value = months.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${value} ${months === 1 ? "mês" : "meses"}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string | string[] }>;
}) {
  const session = await getMembershipSession();

  // Sem sessão → login (defesa em profundidade junto ao middleware/layout).
  if (!session) {
    redirect("/login");
  }

  // Sem futebol ativo → onboarding (ponto de entrada do seletor de futebol).
  if (session.hasNoClub || !session.activeClub) {
    redirect("/sem-futebol");
  }

  const clubId = session.activeClub.clubId;
  const nowPeriod = currentPeriod();

  // Mês selecionado via `?mes=YYYY-MM`. Sem valor/ inválido ou futuro → mês
  // atual. Não deixamos navegar para o futuro (não há dados além do mês atual).
  const rawMes = Array.isArray((await searchParams).mes)
    ? (await searchParams).mes?.[0]
    : (await searchParams).mes;
  const period =
    typeof rawMes === "string" && isValidPeriod(rawMes) && rawMes <= nowPeriod
      ? rawMes
      : nowPeriod;
  const year = Number(period.slice(0, 4));

  const [
    balanceCents,
    summary,
    rate,
    runwayMonths,
    incomeExpenseSeries,
    balanceSeries,
    categoryMonth,
    categoryYear,
    incomeMonth,
    incomeYear,
    playerCounts,
    goals,
    recentExpenses,
    recentIncomes,
  ] = await Promise.all([
    getCurrentBalanceCents(clubId, period),
    getMonthSummary(clubId, period),
    getAdimplenciaRate(clubId, period),
    getRunwayMonths(clubId, period),
    getIncomeExpenseSeries(clubId, period, 12),
    getBalanceSeries(clubId, period, 12),
    getCategoryBreakdownMonth(clubId, period),
    getCategoryBreakdownYear(clubId, year),
    getIncomeBreakdownMonth(clubId, period),
    getIncomeBreakdownYear(clubId, year),
    getPlayerCounts(clubId),
    getActiveGoals(clubId),
    getRecentExpenses(clubId, 10),
    getRecentIncomes(clubId, 10),
  ]);

  const resultCents = summary.incomeCents - summary.expenseCents;

  const cards = [
    { label: "Saldo atual", value: fromCents(balanceCents) },
    { label: "Receitas do mês", value: fromCents(summary.incomeCents) },
    { label: "Despesas do mês", value: fromCents(summary.expenseCents) },
    { label: "Resultado do mês", value: fromCents(resultCents) },
    { label: "Jogadores ativos", value: String(playerCounts.ativos) },
    { label: "Mensalistas", value: String(playerCounts.mensalistas) },
    { label: "Adimplência do mês", value: formatRate(rate) },
    { label: "Runway (média 3 meses)", value: formatRunway(runwayMonths) },
  ];

  return (
    <main className="container py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="mt-1 text-muted-foreground">
            Visão geral do caixa de{" "}
            <span className="font-medium">{session.activeClub.clubName}</span>.
          </p>
        </div>
        <MonthPicker period={period} currentPeriodValue={nowPeriod} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Gráficos (Req 8.2, 8.3, 8.4) — 1 coluna no celular, 2 em telas grandes. */}
      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Receitas vs despesas (12 meses)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <IncomeExpenseChart data={incomeExpenseSeries} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Evolução do saldo</CardTitle>
          </CardHeader>
          <CardContent>
            <BalanceChart data={balanceSeries} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Receitas por categoria (mês)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryBreakdownChart data={incomeMonth} valueLabel="Receita" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Despesas por categoria (mês)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryBreakdownChart data={categoryMonth} valueLabel="Despesa" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Receitas por categoria (ano {year})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryBreakdownChart data={incomeYear} valueLabel="Receita" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Despesas por categoria (ano {year})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryBreakdownChart data={categoryYear} valueLabel="Despesa" />
          </CardContent>
        </Card>
      </section>

      {/* Metas e vaquinhas (Req 8.6) — só aparece quando há metas ativas. */}
      <GoalsSection goals={goals} />

      {/* Transparência do caixa: últimas receitas e últimas despesas. */}
      <RecentIncomesSection incomes={recentIncomes} />
      <RecentExpensesSection expenses={recentExpenses} />
    </main>
  );
}
