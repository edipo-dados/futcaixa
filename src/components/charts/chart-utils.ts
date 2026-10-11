import { fromCents } from "@/lib/money";

/**
 * Utilitários compartilhados pelos gráficos (tarefa 11.2).
 *
 * Recharts trabalha com números (não com centavos formatados), então as séries
 * carregam o valor em reais (`number`) para desenhar os eixos/barras, enquanto
 * o tooltip reconverte para centavos e usa `fromCents` para exibir BRL. Isso
 * mantém a regra de ouro (valor é centavos inteiro) e só formata na borda.
 */

/** Converte centavos (inteiro) → reais (number) para o Recharts. */
export function centsToReais(cents: number): number {
  return cents / 100;
}

/** Converte reais (number vindo do dado do gráfico) → BRL `R$ 1.234,56`. */
export function reaisToBRL(reais: number): string {
  // Arredonda para o centavo mais próximo antes de formatar, evitando ruído
  // de ponto flutuante quando `fromCents` exige inteiro.
  return fromCents(Math.round(reais * 100));
}

/**
 * Formata um período `YYYY-MM` como `MM/YYYY` (rótulo dos eixos/tooltips).
 * Se o valor não casar com o formato esperado, devolve-o inalterado.
 */
export function formatMonthLabel(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;
  const [, year, month] = match;
  return `${month}/${year}`;
}

/** Rótulo compacto do eixo Y em BRL (ex.: `R$ 1,2 mil`). */
export function formatAxisBRL(reais: number): string {
  const abs = Math.abs(reais);
  if (abs >= 1000) {
    const thousands = reais / 1000;
    return `R$ ${thousands.toLocaleString("pt-BR", {
      maximumFractionDigits: 1,
    })} mil`;
  }
  return `R$ ${reais.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}

/** Paleta estável para fatias de categoria (reaproveita tokens do tema). */
export const CATEGORY_COLORS = [
  "hsl(142.1 76.2% 36.3%)", // primary (verde)
  "hsl(221.2 83.2% 53.3%)", // azul
  "hsl(24.6 95% 53.1%)", // laranja
  "hsl(262.1 83.3% 57.8%)", // roxo
  "hsl(0 84.2% 60.2%)", // destructive (vermelho)
  "hsl(47.9 95.8% 53.1%)", // amarelo
  "hsl(188.7 94.5% 42.7%)", // ciano
  "hsl(329.5 76.3% 56.1%)", // rosa
] as const;

/** Cor de uma fatia pelo índice (circular). */
export function categoryColor(index: number): string {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length];
}
