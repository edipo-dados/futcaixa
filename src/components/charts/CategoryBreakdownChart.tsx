"use client";

import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { CategorySlice } from "@/app/(app)/dashboard/data";

import {
  categoryColor,
  centsToReais,
  formatAxisBRL,
  reaisToBRL,
} from "./chart-utils";

/**
 * Gráfico de barras horizontais de despesas por categoria (Req 8.3).
 *
 * Client Component (Recharts usa o DOM). Serve tanto para o recorte do mês
 * quanto para o acumulado do ano — basta instanciar com a série adequada
 * (`getCategoryBreakdownMonth` / `getCategoryBreakdownYear`). Barras
 * horizontais para acomodar nomes de categoria sem cortar em telas estreitas.
 */

interface CategoryBreakdownChartProps {
  data: CategorySlice[];
  /** Rótulo do valor no tooltip (ex.: "Despesa" ou "Receita"). */
  valueLabel?: string;
}

interface ChartRow {
  categoria: string;
  valor: number;
}

export function CategoryBreakdownChart({
  data,
  valueLabel = "Despesa",
}: CategoryBreakdownChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Sem dados
      </div>
    );
  }

  const rows: ChartRow[] = data.map((slice) => ({
    categoria: slice.categoryName,
    valor: centsToReais(slice.valueCents),
  }));

  // Altura proporcional ao número de categorias, com um piso para poucas
  // fatias — mantém legível no celular sem barras exageradamente altas.
  const height = Math.max(192, rows.length * 44 + 32);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        layout="vertical"
        data={rows}
        margin={{ top: 8, right: 56, bottom: 0, left: 8 }}
      >
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={formatAxisBRL}
          hide
        />
        <YAxis
          type="category"
          dataKey="categoria"
          tick={{ fontSize: 12, fill: "hsl(var(--foreground))" }}
          width={110}
        />
        <Tooltip
          formatter={(value: number) => [reaisToBRL(value), valueLabel]}
          cursor={{ fill: "hsl(var(--muted))" }}
          contentStyle={{
            borderRadius: 8,
            border: "1px solid hsl(var(--border))",
            fontSize: 12,
          }}
        />
        <Bar dataKey="valor" radius={[0, 4, 4, 0]}>
          {rows.map((row, index) => (
            <Cell key={row.categoria} fill={categoryColor(index)} />
          ))}
          <LabelList
            dataKey="valor"
            position="right"
            formatter={(value: number) => reaisToBRL(value)}
            style={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
