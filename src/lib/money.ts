/**
 * Utilitários de dinheiro.
 *
 * Regra de ouro do FutCaixa: valores monetários são SEMPRE armazenados como
 * inteiro em centavos (nunca ponto flutuante). A conversão para BRL acontece
 * apenas na borda de apresentação.
 */

const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/**
 * Converte uma string digitada pelo usuário (ex.: "1.234,56", "R$ 25,00",
 * "25", "25,5") para inteiro em centavos.
 *
 * - Aceita separador de milhar "." e separador decimal "," (padrão pt-BR).
 * - Também tolera entrada com "." como separador decimal quando não há ",".
 * - Ignora símbolo de moeda, espaços e espaços não-quebráveis.
 * - Valores negativos são suportados (prefixo "-").
 *
 * @throws Error se a string não representar um número válido.
 */
export function toCents(input: string): number {
  if (typeof input !== "string") {
    throw new Error("toCents espera uma string");
  }

  // Remove símbolo de moeda, espaços (inclusive NBSP) e caracteres irrelevantes.
  let cleaned = input
    .replace(/\s|\u00a0/g, "")
    .replace(/r\$/gi, "")
    .trim();

  if (cleaned === "") {
    throw new Error(`Valor monetário inválido: "${input}"`);
  }

  const negative = cleaned.startsWith("-");
  if (negative) {
    cleaned = cleaned.slice(1);
  }

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  let normalized: string;
  if (hasComma) {
    // Formato pt-BR: "." é milhar e "," é decimal.
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    // Sem vírgula: tratamos o "." como separador decimal.
    normalized = cleaned;
  } else {
    normalized = cleaned;
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Valor monetário inválido: "${input}"`);
  }

  // Arredonda para evitar erros de ponto flutuante (ex.: 25.00 * 100).
  const cents = Math.round(Number(normalized) * 100);

  if (!Number.isFinite(cents)) {
    throw new Error(`Valor monetário inválido: "${input}"`);
  }

  return negative ? -cents : cents;
}

/**
 * Converte um inteiro em centavos para a string formatada em BRL
 * (ex.: 123456 → "R$ 1.234,56").
 *
 * @throws Error se o valor não for inteiro.
 */
export function fromCents(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`fromCents espera um inteiro de centavos, recebeu: ${cents}`);
  }

  return brlFormatter.format(cents / 100);
}
