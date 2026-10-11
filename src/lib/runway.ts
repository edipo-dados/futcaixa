/**
 * Runway do caixa (Req 8.5).
 *
 * O "Runway" responde: por quantos MESES o saldo atual cobre as despesas, com
 * base na MÉDIA de despesas dos últimos 3 meses. Este módulo é PURO (sem
 * banco), apenas aritmético, para ser facilmente testável; a leitura das
 * views e do saldo acontece no loader do dashboard (`dashboard/data.ts`).
 *
 * Convenções desta implementação:
 *
 * - A média é calculada sobre os meses EFETIVAMENTE fornecidos:
 *   `soma(despesas) / quantidade de meses do array`. Se o chamador passar
 *   menos de 3 meses (histórico curto), a média usa a quantidade disponível,
 *   não um divisor fixo 3 — evita subestimar a média quando faltam meses.
 *
 * - Tratamento de divisão por zero (o ponto central da tarefa): se a média for
 *   `<= 0` (sem despesas no período, ou array vazio), NÃO há divisão possível
 *   e o runway é indefinido/"infinito". Nesse caso devolvemos `null`, e a UI
 *   mostra algo como "—" ou "Sem despesas recentes".
 *
 * - Saldo não positivo: se o saldo for `<= 0`, o runway calculado seria 0 ou
 *   negativo (caixa já no vermelho). Escolhemos devolver `max(0, valor)` —
 *   isto é, 0 meses de cobertura — porque "runway negativo" não tem leitura
 *   útil para o usuário (não existe cobertura negativa). O valor é um número
 *   fracionário (ex.: 3.5 meses).
 */

/**
 * Calcula o runway em meses a partir do saldo atual (centavos) e das despesas
 * (centavos) dos últimos meses.
 *
 * @param balanceCents saldo atual em caixa, em centavos (inteiro; pode ser
 *   negativo se o caixa estiver no vermelho).
 * @param last3MonthsExpenseCents despesas em centavos dos últimos meses
 *   (idealmente 3). A média é tirada sobre a quantidade de itens do array.
 * @returns número de meses de cobertura (fracionário, `>= 0`), ou `null`
 *   quando a média de despesas é `<= 0` (divisão por zero / sem despesas).
 */
export function computeRunwayMonths(
  balanceCents: number,
  last3MonthsExpenseCents: readonly number[],
): number | null {
  // Array vazio: nenhuma despesa para formar média → runway indefinido.
  if (last3MonthsExpenseCents.length === 0) {
    return null;
  }

  const sum = last3MonthsExpenseCents.reduce(
    (total, cents) => total + cents,
    0,
  );
  const average = sum / last3MonthsExpenseCents.length;

  // Tratamento de divisão por zero: média não positiva → runway indefinido.
  if (average <= 0) {
    return null;
  }

  const runway = balanceCents / average;

  // Saldo não positivo renderiza runway 0 ou negativo; limitamos a 0.
  return Math.max(0, runway);
}
