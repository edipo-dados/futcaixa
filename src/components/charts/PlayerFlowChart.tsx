"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PlayerFlowMonthPoint } from "@/lib/dashboard/player-flow";

import { formatMonthLabel } from "./chart-utils";

/**
 * Gráfico de barras de ENTRADAS e SAÍDAS de jogadores por mês.
 *
 * Client Component (Recharts usa o DOM). Recebe a série já agregada no
 * servidor (`buildPlayerFlow`). O wrapper tem `role="img"` com rótulo
 * acessível; o resumo textual fica no `figcaption` da seção (via
 * `aria-describedby`), e as listas abaixo do gráfico trazem os nomes.
 */
interface PlayerFlowChartProps {
  data: PlayerFlowMonthPoint[];
  /** id do elemento com o resumo textual do gráfico. */
  describedById?: string;
}

interface ChartRow {
  month: string;
  label: string;
  entradas: number;
  saidas: number;
}

/** Rótulo pt-BR de cada série no tooltip/legenda. */
const SERIES_LABEL: Record<string, string> = {
  entradas: "Entradas",
  saidas: "Saídas",
};

export function PlayerFlowChart({ data, describedById }: PlayerFlowChartProps) {
  const hasData = data.some((point) => point.entries > 0 || point.exits > 0);

  if (!hasData) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Sem movimentações
      </div>
    );
  }

  const rows: ChartRow[] = data.map((point) => ({
    month: point.month,
    label: formatMonthLabel(point.month),
    entradas: point.entries,
    saidas: point.exits,
  }));

  return (
    <div
      role="img"
      aria-label="Gráfico de barras de entradas e saídas de jogadores por mês"
      aria-describedby={describedById}
    >
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            width={32}
          />
          <Tooltip
            formatter={(value: number, name) => [
              value,
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
            dataKey="entradas"
            fill="hsl(142.1 76.2% 36.3%)"
            radius={[4, 4, 0, 0]}
          />
          <Bar
            dataKey="saidas"
            fill="hsl(0 84.2% 60.2%)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
