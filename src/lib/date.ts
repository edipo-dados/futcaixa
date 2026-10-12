/**
 * Utilitários de data.
 *
 * Todas as operações assumem o fuso `America/Sao_Paulo`. Trabalhamos sobre a
 * data civil (ano/mês/dia) nesse fuso para evitar o off-by-one que ocorre
 * quando o horário UTC cai no dia seguinte/anterior na virada do dia.
 */

export const APP_TIME_ZONE = "America/Sao_Paulo";

/** Partes de uma data civil (ano/mês/dia) já resolvidas no fuso do app. */
interface ZonedDateParts {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
}

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Resolve a data civil (ano/mês/dia) de um instante no fuso do app.
 */
function getZonedParts(date: Date): ZonedDateParts {
  if (Number.isNaN(date.getTime())) {
    throw new Error("Data inválida");
  }

  const parts = partsFormatter.formatToParts(date);
  const lookup = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((p) => p.type === type)?.value;
    if (value === undefined) {
      throw new Error(`Não foi possível extrair "${type}" da data`);
    }
    return Number(value);
  };

  return {
    year: lookup("year"),
    month: lookup("month"),
    day: lookup("day"),
  };
}

/**
 * Normaliza a entrada para um `Date`.
 * Aceita um `Date` ou uma string ISO (`YYYY-MM-DD` ou ISO completa).
 *
 * Para datas no formato `YYYY-MM-DD` (sem horário), o JS interpreta como
 * meia-noite UTC. Como só olhamos a data civil no fuso de SP, isso poderia
 * recuar um dia (SP está atrás do UTC). Para preservar o dia pretendido,
 * ancoramos ao meio-dia UTC, que mantém o mesmo dia civil em SP.
 */
function toDate(value: Date | string): Date {
  if (value instanceof Date) {
    return value;
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    // Meio-dia UTC garante o mesmo dia civil em America/Sao_Paulo.
    return new Date(`${y}-${m}-${d}T12:00:00.000Z`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Data inválida: "${value}"`);
  }
  return parsed;
}

/**
 * Formata uma data como `dd/mm/aaaa` no fuso `America/Sao_Paulo`.
 */
export function formatDate(value: Date | string): string {
  const { year, month, day } = getZonedParts(toDate(value));
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return `${dd}/${mm}/${year}`;
}

/**
 * Retorna o período (`YYYY-MM`) de uma data no fuso `America/Sao_Paulo`.
 * Usado para mensalidades, idempotência de crons e agregações por mês.
 */
export function toPeriod(value: Date | string): string {
  const { year, month } = getZonedParts(toDate(value));
  const mm = String(month).padStart(2, "0");
  return `${year}-${mm}`;
}

/**
 * Período (`YYYY-MM`) atual no fuso do app.
 */
export function currentPeriod(now: Date = new Date()): string {
  return toPeriod(now);
}

/**
 * Retorna a data civil atual (`YYYY-MM-DD`) no fuso do app. Útil para comparar
 * vencimentos ("atrasada" = vencimento < hoje) sem ruído de fuso.
 */
export function todayISO(now: Date = new Date()): string {
  const { year, month, day } = getZonedParts(now);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Calcula a data de vencimento padrão (`YYYY-MM-DD`) a partir do dia de
 * vencimento configurado (`settings.due_day`, Req 5.8).
 *
 * Regra: usa o `dueDay` no mês corrente; se esse dia já passou (hoje é depois
 * do vencimento no mês atual), avança para o mês seguinte — assim a cobrança
 * manual nasce com um vencimento futuro sensato. O `dueDay` é restrito a 1..28
 * nas Configurações, então o dia sempre existe em qualquer mês (sem risco de
 * "31 de fevereiro").
 *
 * @param dueDay dia do mês (1..28) vindo das Configurações.
 * @param now instante de referência (default: agora), no fuso do app.
 */
export function defaultDueDate(dueDay: number, now: Date = new Date()): string {
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) {
    throw new Error(
      `Dia de vencimento inválido: "${dueDay}" (esperado inteiro entre 1 e 28).`,
    );
  }

  const { year, month, day } = getZonedParts(now);
  let targetYear = year;
  let targetMonth = month; // 1..12

  // Se o dia de vencimento já passou neste mês, usa o próximo mês.
  if (dueDay < day) {
    targetMonth += 1;
    if (targetMonth > 12) {
      targetMonth = 1;
      targetYear += 1;
    }
  }

  const mm = String(targetMonth).padStart(2, "0");
  const dd = String(dueDay).padStart(2, "0");
  return `${targetYear}-${mm}-${dd}`;
}

/**
 * Valida um período no formato `YYYY-MM` (mês 01..12). Usado para sanear o
 * filtro de mês do dashboard vindo da URL.
 */
export function isValidPeriod(value: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return false;
  const month = Number(m[2]);
  return month >= 1 && month <= 12;
}

/**
 * Desloca um período `YYYY-MM` em `months` (pode ser negativo), devolvendo
 * outro `YYYY-MM`. Aritmética civil (ano*12 + mês), sem fuso. Centralizado aqui
 * para o dashboard (séries de 12 meses e navegação anterior/próximo do filtro).
 */
export function shiftPeriod(period: string, months: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) {
    throw new Error(`Período inválido: "${period}" (esperado YYYY-MM).`);
  }
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1; // 0..11
  const total = year * 12 + monthIdx + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  return `${ny}-${String(nm + 1).padStart(2, "0")}`;
}

/** Nomes dos meses em pt-BR (1..12 → índice 0..11). */
const MONTH_NAMES_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

/**
 * Formata um período `YYYY-MM` como rótulo pt-BR longo, ex.: "Outubro de 2026".
 * Usado no seletor de mês do dashboard.
 */
export function formatPeriodLabel(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period;
  const year = m[1];
  const monthIdx = Number(m[2]) - 1;
  const name = MONTH_NAMES_PT[monthIdx] ?? period;
  return `${name} de ${year}`;
}
