"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { IncomeExpensePoint } from "@/app/(app)/dashboard/data";

import {
  centsToReais,
  formatAxisBRL,
  formatMonthLabel,
  reaisToBRL,
} from "./chart-utils";

/**
 * Gráfico de barras agrupadas de receitas vs despesas mês a mês (Req 8.2).
 *
 * Client Component (Recharts usa o DOM). Recebe a série já carregada no
 * servidor a partir de `v_monthly_summary`. Mobile-first: o
 * `ResponsiveContainer` ajusta a largura ao contêiner e a altura é fixa para
 * caber bem no celular.
 */

interface IncomeExpenseChartProps {
  data: IncomeExpensePoint[];
}

interface ChartRow {
  month: string;
  label: string;
  receitas: number;
  despesas: number;
  resultado: number;
}

/** Rótulo pt-BR de cada série no tooltip/legenda. */
const SERIES_LABEL: Record<string, string> = {
  receitas: "Receitas",
  despesas: "Despesas",
  resultado: "Resultado",
};

export function IncomeExpenseChart({ data }: IncomeExpenseChartProps) {
  const hasData = data.some(
    (point) => point.incomeCents !== 0 || point.expenseCents !== 0,
  );

  if (!hasData) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Sem dados
      </div>
    );
  }

  const rows: ChartRow[] = data.map((point) => ({
    month: point.month,
    label: formatMonthLabel(point.month),
    receitas: centsToReais(point.incomeCents),
    despesas: centsToReais(point.expenseCents),
    resultado: centsToReais(point.incomeCents - point.expenseCents),
  }));

  return (
    <ResponsiveContainer width="100%" height={288}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="hsl(var(--border))"
          vertical={false}
        />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickMargin={8}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={formatAxisBRL}
          width={72}
        />
        <Tooltip
          formatter={(value: number, name) => [
            reaisToBRL(value),
            SERIES_LABEL[String(name)] ?? String(name),
          ]}
          labelFormatter={(label) => `Mês ${label}`}
          contentStyle={{
            borderRadius: 8,
            border: "1px solid hsl(var(--border))",
            fontSize: 12,
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 12 }}
          formatter={(value) => SERIES_LABEL[String(value)] ?? String(value)}
        />
        <Bar
          dataKey="receitas"
          fill="hsl(142.1 76.2% 36.3%)"
          radius={[4, 4, 0, 0]}
        />
        <Bar
          dataKey="despesas"
          fill="hsl(0 84.2% 60.2%)"
          radius={[4, 4, 0, 0]}
        />
        {/* Linha de resultado mensal (receitas − despesas): facilita ver se o
            mês fechou positivo ou negativo. */}
        <Line
          type="monotone"
          dataKey="resultado"
          stroke="hsl(217 91% 60%)"
          strokeWidth={2}
          dot={{ r: 2 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
