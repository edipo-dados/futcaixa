/**
 * Metas / vaquinhas (Req 8.6).
 *
 * O dashboard mostra cada meta com uma barra de progresso (ex.: "Jogo de
 * camisas — R$ 800 — 62%"). Este módulo é PURO (sem banco), apenas aritmético,
 * para ser facilmente testável; a leitura da tabela `goals` acontece no loader
 * do dashboard (`dashboard/data.ts`).
 *
 * Convenções desta implementação:
 *
 * - O progresso é `current_cents / target_cents * 100`, SEMPRE limitado ao
 *   intervalo `[0, 100]`. Mesmo que uma meta ultrapasse o alvo (vaquinha que
 *   arrecadou além do previsto), a barra não passa de 100% — o excesso não tem
 *   leitura útil na barra, e `current_cents`/`target_cents` continuam
 *   disponíveis para quem quiser exibir o valor exato.
 *
 * - Tratamento de divisão por zero: embora o schema garanta `target_cents > 0`
 *   (constraint `goals_target_cents_check`), tratamos defensivamente um alvo
 *   `<= 0` devolvendo `percent: 0` em vez de dividir por zero (evita `NaN`/
 *   `Infinity` caso a invariante do banco mude ou o helper seja reusado fora
 *   do fluxo da tabela).
 */

/** Resultado do cálculo de progresso de uma meta. */
export interface GoalProgress {
  /** Percentual concluído, limitado a `[0, 100]`. */
  percent: number;
  /** Valor acumulado (centavos), repassado para a borda de apresentação. */
  currentCents: number;
  /** Valor-alvo (centavos), repassado para a borda de apresentação. */
  targetCents: number;
}

/**
 * Calcula o progresso de uma meta a partir do valor acumulado e do alvo (ambos
 * em centavos).
 *
 * @param currentCents valor acumulado, em centavos (inteiro, `>= 0`).
 * @param targetCents valor-alvo, em centavos (inteiro, idealmente `> 0`).
 * @returns `{ percent, currentCents, targetCents }` com `percent` limitado a
 *   `[0, 100]`. Quando `targetCents <= 0`, devolve `percent: 0` (evita divisão
 *   por zero).
 */
export function computeGoalProgress(
  currentCents: number,
  targetCents: number,
): GoalProgress {
  // Alvo não positivo: divisão por zero / meta sem sentido → progresso 0.
  if (targetCents <= 0) {
    return { percent: 0, currentCents, targetCents };
  }

  const raw = (currentCents / targetCents) * 100;

  // Limita ao intervalo [0, 100]: nem negativo, nem acima do alvo.
  const percent = Math.min(100, Math.max(0, raw));

  return { percent, currentCents, targetCents };
}
