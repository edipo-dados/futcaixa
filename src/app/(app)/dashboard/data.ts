import "server-only";

import { currentPeriod } from "@/lib/date";
import { computeRunwayMonths } from "@/lib/runway";
import { createClient } from "@/lib/supabase/server";

/**
 * Carregadores de dados do Dashboard (Server Components).
 *
 * Os dashboards leem SOMENTE as views agregadas do Postgres — nunca as tabelas
 * base (Req 8.8). As views rodam como `security definer` (migrations 2.5/2.7 e
 * 2.18), de modo que todo usuário autenticado (inclusive `jogador`) consiga ler
 * os agregados sem jamais tocar em `transactions`/`charges`, que permanecem
 * restritas por RLS. Por isso usamos o cliente ligado à sessão.
 *
 * MULTI-TENANT (tarefa 21.8): toda leitura é escopada ao futebol ATIVO. As
 * views foram reescritas (migration 20250101000018) para PROJETAR `club_id`, e
 * a tabela `goals` carrega `club_id`. Por isso cada loader recebe o `clubId` do
 * clube ativo e aplica `.eq('club_id', clubId)` — nunca cruzando futebóis. O
 * saldo inicial do caixa vem da `settings.initial_balance_cents` do clube, já
 * embutido na view `v_balance_history` (particionada por `club_id`). A RLS no
 * Postgres é a autoridade final; o filtro explícito é defesa em profundidade e
 * garante isolamento no dashboard (`where club_id = <ativo>`).
 *
 * Tratamento de banco vazio / antes das migrations: cada loader devolve um
 * valor neutro (zeros ou `null`) quando a view não retorna linha ou falha,
 * para que o dashboard renderize mesmo sem dados.
 */

/** Resumo financeiro do mês (uma linha de `v_monthly_summary`). */
export interface MonthSummary {
  incomeCents: number;
  expenseCents: number;
  resultCents: number;
}

interface BalanceHistoryRow {
  month: string;
  balance_cents: number;
}

interface MonthlySummaryRow {
  income_cents: number;
  expense_cents: number;
  result_cents: number;
}

interface DelinquencyRateRow {
  rate_percent: number | null;
}

/**
 * Saldo atual em caixa (Req 8.1) a partir de `v_balance_history`, escopado ao
 * futebol ATIVO.
 *
 * O saldo é cumulativo (`initial_balance_cents` do clube + soma corrida de
 * resultados do mesmo clube), então o "saldo atual" é o `balance_cents` do mês
 * mais recente que não seja posterior ao período corrente. Pega-se a linha com
 * o maior `month <= período atual` do clube. Se não houver nenhum mês até o
 * período corrente (ex.: banco vazio ou só com lançamentos futuros), devolve 0.
 */
export async function getCurrentBalanceCents(
  clubId: string,
  period: string = currentPeriod(),
): Promise<number> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("v_balance_history")
    .select("month, balance_cents")
    .eq("club_id", clubId)
    .lte("month", period)
    .order("month", { ascending: false })
    .limit(1)
    .maybeSingle<BalanceHistoryRow>();

  if (error || !data) return 0;

  return data.balance_cents ?? 0;
}

/**
 * Resumo de receitas/despesas/resultado do período (Req 8.1) a partir de
 * `v_monthly_summary`, escopado ao futebol ATIVO. Devolve zeros quando não há
 * linha para o período (nenhum lançamento no mês ou banco vazio).
 */
export async function getMonthSummary(
  clubId: string,
  period: string = currentPeriod(),
): Promise<MonthSummary> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("v_monthly_summary")
    .select("income_cents, expense_cents, result_cents")
    .eq("club_id", clubId)
    .eq("month", period)
    .maybeSingle<MonthlySummaryRow>();

  if (error || !data) {
    return { incomeCents: 0, expenseCents: 0, resultCents: 0 };
  }

  return {
    incomeCents: data.income_cents ?? 0,
    expenseCents: data.expense_cents ?? 0,
    resultCents: data.result_cents ?? 0,
  };
}

/**
 * Percentual de adimplência do período (Req 8.1) a partir de
 * `v_delinquency_rate`, escopado ao futebol ATIVO. Devolve `null` quando não há
 * cobranças devidas no mês (sem linha na view), caso em que o card deve exibir
 * "—" em vez de "0%".
 */
export async function getAdimplenciaRate(
  clubId: string,
  period: string = currentPeriod(),
): Promise<number | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("v_delinquency_rate")
    .select("rate_percent")
    .eq("club_id", clubId)
    .eq("month", period)
    .maybeSingle<DelinquencyRateRow>();

  if (error || !data) return null;

  return data.rate_percent ?? null;
}

/* ===================================================================== *
 * Séries para os gráficos (tarefa 11.2 — Req 8.2, 8.3, 8.4)             *
 *                                                                       *
 * Recharts precisa de números (não centavos formatados), então os       *
 * loaders convertem os centavos (inteiro) para reais (number) na borda   *
 * de apresentação. O valor em centavos continua disponível no mesmo       *
 * ponto (`*Cents`) para o tooltip formatar com `fromCents`.               *
 * ===================================================================== */

/** Ponto da série receitas vs despesas (um mês). */
export interface IncomeExpensePoint {
  /** Período `YYYY-MM`. */
  month: string;
  incomeCents: number;
  expenseCents: number;
}

/** Ponto da série de evolução do saldo (um mês). */
export interface BalancePoint {
  /** Período `YYYY-MM`. */
  month: string;
  balanceCents: number;
}

/** Fatia de despesa por categoria. */
export interface CategorySlice {
  categoryName: string;
  expenseCents: number;
}

interface MonthlySeriesRow {
  month: string;
  income_cents: number;
  expense_cents: number;
}

interface CategoryBreakdownRow {
  month: string;
  category_name: string;
  expense_cents: number;
}

/**
 * Soma `months` meses ao período `YYYY-MM` informado (delta pode ser
 * negativo). Opera só sobre ano/mês civis, sem fuso, para calcular a janela
 * dos gráficos (ex.: 12 meses encerrando no período corrente).
 */
function shiftPeriod(period: string, months: number): string {
  const [yearStr, monthStr] = period.split("-");
  const base = Number(yearStr) * 12 + (Number(monthStr) - 1) + months;
  const year = Math.floor(base / 12);
  const month = (base % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Série de receitas vs despesas dos últimos `months` meses encerrando em
 * `upToPeriod` (Req 8.2), a partir de `v_monthly_summary`, escopada ao futebol
 * ATIVO.
 *
 * Devolve um ponto por mês da janela, em ordem crescente, preenchendo com
 * zeros os meses sem lançamento — assim o gráfico mostra uma linha contínua de
 * 12 meses mesmo quando faltam meses na view. Em erro/banco vazio devolve a
 * janela toda zerada.
 */
export async function getIncomeExpenseSeries(
  clubId: string,
  upToPeriod: string = currentPeriod(),
  months = 12,
): Promise<IncomeExpensePoint[]> {
  const fromPeriod = shiftPeriod(upToPeriod, -(months - 1));
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("v_monthly_summary")
    .select("month, income_cents, expense_cents")
    .eq("club_id", clubId)
    .gte("month", fromPeriod)
    .lte("month", upToPeriod)
    .order("month", { ascending: true })
    .returns<MonthlySeriesRow[]>();

  const byMonth = new Map<string, MonthlySeriesRow>();
  if (!error && data) {
    for (const row of data) byMonth.set(row.month, row);
  }

  const series: IncomeExpensePoint[] = [];
  for (let i = 0; i < months; i += 1) {
    const month = shiftPeriod(fromPeriod, i);
    const row = byMonth.get(month);
    series.push({
      month,
      incomeCents: row?.income_cents ?? 0,
      expenseCents: row?.expense_cents ?? 0,
    });
  }

  return series;
}

/**
 * Série de evolução do saldo dos últimos `months` meses encerrando em
 * `upToPeriod` (Req 8.4), a partir de `v_balance_history`, escopada ao futebol
 * ATIVO.
 *
 * O saldo é cumulativo; não faz sentido preencher meses faltantes com zero
 * (zeraria o acumulado). Em vez disso, devolvemos apenas as linhas presentes
 * na janela, em ordem crescente. Em erro/banco vazio devolve lista vazia (o
 * componente mostra "Sem dados").
 */
export async function getBalanceSeries(
  clubId: string,
  upToPeriod: string = currentPeriod(),
  months = 12,
): Promise<BalancePoint[]> {
  const fromPeriod = shiftPeriod(upToPeriod, -(months - 1));
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("v_balance_history")
    .select("month, balance_cents")
    .eq("club_id", clubId)
    .gte("month", fromPeriod)
    .lte("month", upToPeriod)
    .order("month", { ascending: true })
    .returns<BalanceHistoryRow[]>();

  if (error || !data) return [];

  return data.map((row) => ({
    month: row.month,
    balanceCents: row.balance_cents ?? 0,
  }));
}

/**
 * Despesas por categoria do mês informado (Req 8.3), a partir de
 * `v_category_breakdown`, escopadas ao futebol ATIVO. Ordenado por valor
 * decrescente. Em erro/banco vazio devolve lista vazia.
 */
export async function getCategoryBreakdownMonth(
  clubId: string,
  period: string = currentPeriod(),
): Promise<CategorySlice[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("v_category_breakdown")
    .select("month, category_name, expense_cents")
    .eq("club_id", clubId)
    .eq("month", period)
    .returns<CategoryBreakdownRow[]>();

  if (error || !data) return [];

  return data
    .map((row) => ({
      categoryName: row.category_name,
      expenseCents: row.expense_cents ?? 0,
    }))
    .sort((a, b) => b.expenseCents - a.expenseCents);
}

/**
 * Despesas por categoria acumuladas no ano `year` (Req 8.3), a partir de
 * `v_category_breakdown`, escopadas ao futebol ATIVO. Agrega todas as linhas
 * cujo `month` começa com o ano (`YYYY-`), somando por categoria. Ordenado por
 * valor decrescente. Em erro/banco vazio devolve lista vazia.
 */
export async function getCategoryBreakdownYear(
  clubId: string,
  year: number = Number(currentPeriod().slice(0, 4)),
): Promise<CategorySlice[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("v_category_breakdown")
    .select("month, category_name, expense_cents")
    .eq("club_id", clubId)
    .gte("month", `${year}-01`)
    .lte("month", `${year}-12`)
    .returns<CategoryBreakdownRow[]>();

  if (error || !data) return [];

  const byCategory = new Map<string, number>();
  for (const row of data) {
    const current = byCategory.get(row.category_name) ?? 0;
    byCategory.set(row.category_name, current + (row.expense_cents ?? 0));
  }

  return Array.from(byCategory.entries())
    .map(([categoryName, expenseCents]) => ({ categoryName, expenseCents }))
    .sort((a, b) => b.expenseCents - a.expenseCents);
}

/* ===================================================================== *
 * Runway (tarefa 11.3 — Req 8.5)                                        *
 * ===================================================================== */

interface MonthlyExpenseRow {
  month: string;
  expense_cents: number;
}

/**
 * Runway em meses (Req 8.5): por quanto tempo o saldo atual cobre o caixa,
 * com base na média de despesas dos últimos 3 meses — tudo do futebol ATIVO.
 *
 * Lê os até 3 meses mais recentes de `v_monthly_summary` do clube que não sejam
 * posteriores ao período corrente, reusa `getCurrentBalanceCents` para o saldo
 * e delega o cálculo ao helper puro `computeRunwayMonths` — que trata a divisão
 * por zero (média de despesas `<= 0` → `null`) e limita saldo não positivo a 0.
 *
 * Devolve `null` quando não há despesas recentes (nenhum mês na janela ou média
 * zero), caso em que o card exibe "Sem despesas recentes".
 */
export async function getRunwayMonths(
  clubId: string,
  period: string = currentPeriod(),
): Promise<number | null> {
  const supabase = await createClient();

  const [balanceCents, { data, error }] = await Promise.all([
    getCurrentBalanceCents(clubId, period),
    supabase
      .from("v_monthly_summary")
      .select("month, expense_cents")
      .eq("club_id", clubId)
      .lte("month", period)
      .order("month", { ascending: false })
      .limit(3)
      .returns<MonthlyExpenseRow[]>(),
  ]);

  if (error || !data) return null;

  const expenses = data.map((row) => row.expense_cents ?? 0);

  return computeRunwayMonths(balanceCents, expenses);
}

/* ===================================================================== *
 * Metas / vaquinhas (tarefa 11.4 — Req 8.6)                             *
 *                                                                       *
 * Diferente dos cards/gráficos, as metas leem a tabela `goals` direto    *
 * (não há view agregada): o RLS permite SELECT a qualquer membership     *
 * ativa do clube, e os dados não são individuais de jogador — são metas  *
 * coletivas do caixa. A tabela carrega `club_id` (migration 2.16), então *
 * a leitura é escopada ao futebol ATIVO. A escrita (CRUD) continua       *
 * restrita a presidente/tesoureiro.                                       *
 * ===================================================================== */

/** Meta/vaquinha ativa exibida no dashboard com barra de progresso. */
export interface ActiveGoal {
  id: string;
  title: string;
  targetCents: number;
  currentCents: number;
}

interface GoalRow {
  id: string;
  title: string;
  target_cents: number;
  current_cents: number;
}

/**
 * Lista as metas/vaquinhas ativas (Req 8.6) a partir da tabela `goals`,
 * escopadas ao futebol ATIVO (`.eq('club_id', clubId)`).
 *
 * Traz apenas `is_active = true`, ordenadas por data de criação (mais antigas
 * primeiro) para manter a ordem estável entre renders. Em erro/banco vazio
 * devolve lista vazia, para o dashboard renderizar sem a seção de metas.
 */
export async function getActiveGoals(clubId: string): Promise<ActiveGoal[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("goals")
    .select("id, title, target_cents, current_cents")
    .eq("club_id", clubId)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .returns<GoalRow[]>();

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    title: row.title,
    targetCents: row.target_cents ?? 0,
    currentCents: row.current_cents ?? 0,
  }));
}

/* ===================================================================== *
 * Últimas despesas com comprovante (tarefa 11.5 — Req 8.7)              *
 *                                                                       *
 * Transparência a nível de caixa: lista as despesas mais recentes para  *
 * qualquer membership ativa (inclusive `jogador`), lendo a view         *
 * `v_recent_expenses` (migration 2.10/2.18), que roda como DEFINER para  *
 * que o jogador — sem acesso direto a `transactions` (Req 8.8) — enxergue *
 * a lista. A view projeta `club_id`, então a leitura é escopada ao       *
 * futebol ATIVO. A view NÃO expõe identidade individual (player_id/nome): *
 * são despesas de caixa (Quadra, Goleiro, Bolas...), não cobranças por   *
 * jogador. O `proofPath` é só o caminho no bucket privado; a leitura do  *
 * arquivo exige URL assinada do servidor (Req 3.7/11.2).                 *
 * ===================================================================== */

/** Despesa recente exibida no dashboard (transparência). */
export interface RecentExpense {
  id: string;
  /** Data da despesa (`YYYY-MM-DD`). */
  occurredOn: string;
  amountCents: number;
  description: string;
  categoryName: string;
  /** Caminho do comprovante no bucket privado, ou `null` quando não há. */
  proofPath: string | null;
}

interface RecentExpenseRow {
  id: string;
  occurred_on: string;
  amount_cents: number;
  description: string;
  category_name: string;
  proof_path: string | null;
}

/**
 * Lista as últimas `limit` despesas (Req 8.7) a partir de `v_recent_expenses`,
 * escopadas ao futebol ATIVO (`.eq('club_id', clubId)`).
 *
 * A view já vem ordenada da mais recente para a mais antiga; aqui aplicamos
 * apenas o filtro por clube e o limite de exibição (padrão: 10). Em erro/banco
 * vazio devolve lista vazia, para o dashboard renderizar sem a seção de
 * despesas.
 */
export async function getRecentExpenses(
  clubId: string,
  limit = 10,
): Promise<RecentExpense[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("v_recent_expenses")
    .select(
      "id, occurred_on, amount_cents, description, category_name, proof_path",
    )
    .eq("club_id", clubId)
    .limit(limit)
    .returns<RecentExpenseRow[]>();

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    occurredOn: row.occurred_on,
    amountCents: row.amount_cents ?? 0,
    description: row.description,
    categoryName: row.category_name,
    proofPath: row.proof_path,
  }));
}
