"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { BalancePoint } from "@/app/(app)/dashboard/data";

import {
  centsToReais,
  formatAxisBRL,
  formatMonthLabel,
  reaisToBRL,
} from "./chart-utils";

/**
 * Gráfico de área da evolução do saldo ao longo do tempo (Req 8.4).
 *
 * Client Component (Recharts usa o DOM). Recebe a série já carregada no
 * servidor a partir de `v_balance_history` (saldo acumulado). Mobile-first.
 */

interface BalanceChartProps {
  data: BalancePoint[];
}

interface ChartRow {
  month: string;
  label: string;
  saldo: number;
}

export function BalanceChart({ data }: BalanceChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Sem dados
      </div>
    );
  }

  const rows: ChartRow[] = data.map((point) => ({
    month: point.month,
    label: formatMonthLabel(point.month),
    saldo: centsToReais(point.balanceCents),
  }));

  return (
    <ResponsiveContainer width="100%" height={288}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="saldoFill" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="5%"
              stopColor="hsl(142.1 76.2% 36.3%)"
              stopOpacity={0.3}
            />
            <stop
              offset="95%"
              stopColor="hsl(142.1 76.2% 36.3%)"
              stopOpacity={0}
            />
          </linearGradient>
        </defs>
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
          formatter={(value: number) => [reaisToBRL(value), "Saldo"]}
          labelFormatter={(label) => `Mês ${label}`}
          contentStyle={{
            borderRadius: 8,
            border: "1px solid hsl(var(--border))",
            fontSize: 12,
          }}
        />
        <Area
          type="monotone"
          dataKey="saldo"
          stroke="hsl(142.1 76.2% 36.3%)"
          strokeWidth={2}
          fill="url(#saldoFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
