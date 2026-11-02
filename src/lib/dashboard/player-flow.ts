import { shiftPeriod, toPeriod } from "@/lib/date";

/**
 * Agregação pura de ENTRADAS e SAÍDAS de jogadores por mês (dashboard).
 *
 * - ENTRADA = `players.created_at`.
 * - SAÍDA = INATIVADO (status 'inativo'; data em `inactivated_at`, mantida por
 *   trigger desde a migration 039) OU EXCLUÍDO (soft delete `deleted_at`).
 *
 * Os meses são resolvidos no fuso `America/Sao_Paulo` (`toPeriod`), então um
 * cadastro às 01:00 UTC do dia 1º ainda pertence ao mês anterior.
 *
 * Regras de saída:
 * - Reativado (status 'ativo') não conta como saída por inativação, mesmo com
 *   `inactivated_at` residual. Se tiver `deleted_at`, conta como Excluído.
 * - Inativo sem `inactivated_at` (antes da migration ou backfill) usa
 *   `updated_at` como data APROXIMADA.
 * - Excluído que também está inativo conta UMA vez, na data do PRIMEIRO evento
 *   de saída (o jogador deixou o elenco no primeiro evento; o segundo não é uma
 *   nova saída). Empate exato de instante → "Excluído".
 *
 * O histórico começa em `PLAYER_FLOW_START_PERIOD`; eventos anteriores (ou
 * posteriores ao mês corrente) são ignorados.
 */

/** Primeiro mês do histórico de entradas/saídas. */
export const PLAYER_FLOW_START_PERIOD = "2026-10";

export type PlayerExitReason = "inativado" | "excluido";

/** Linha normalizada de jogador (camelCase), vinda do loader. */
export interface PlayerFlowInput {
  id: string;
  name: string;
  nickname: string | null;
  status: "ativo" | "inativo";
  /** ISO timestamptz. */
  createdAt: string;
  /** ISO timestamptz. */
  updatedAt: string;
  deletedAt: string | null;
  /** Ausente/undefined antes da migration 039. */
  inactivatedAt?: string | null;
  /** Ausente/undefined antes da migration 039. */
  inactivatedAtApprox?: boolean | null;
}

/** Evento de saída resolvido de um jogador. */
export interface PlayerExit {
  date: string;
  reason: PlayerExitReason;
  approximate: boolean;
}

/** Ponto da série mensal do gráfico. */
export interface PlayerFlowMonthPoint {
  month: string;
  entries: number;
  exits: number;
}

export interface PlayerFlowEntryItem {
  playerId: string;
  name: string;
  nickname: string | null;
  date: string;
}

export interface PlayerFlowExitItem extends PlayerFlowEntryItem {
  reason: PlayerExitReason;
  approximate: boolean;
}

export interface PlayerFlow {
  startPeriod: string;
  /** startPeriod..currentPeriod, contínua, com zeros nos meses vazios. */
  series: PlayerFlowMonthPoint[];
  selectedPeriod: string;
  /** `selectedPeriod < startPeriod` (sem histórico para o mês). */
  selectedBeforeStart: boolean;
  /** Entradas do mês selecionado. */
  entries: PlayerFlowEntryItem[];
  /** Saídas do mês selecionado. */
  exits: PlayerFlowExitItem[];
}

/** Instante em ms, ou `null` se a data for inválida. */
function timeOf(value: string): number | null {
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Período `YYYY-MM` em SP, ou `null` se a data for inválida. */
function safePeriod(value: string): string | null {
  try {
    return toPeriod(value);
  } catch {
    return null;
  }
}

/**
 * Resolve o (único) evento de saída de um jogador, ou `null` se ele não saiu.
 * Datas inválidas descartam o candidato correspondente.
 */
export function resolvePlayerExit(player: PlayerFlowInput): PlayerExit | null {
  const candidates: { exit: PlayerExit; time: number }[] = [];

  if (player.status === "inativo") {
    const date = player.inactivatedAt ?? player.updatedAt;
    const time = timeOf(date);
    if (time != null) {
      candidates.push({
        exit: {
          date,
          reason: "inativado",
          approximate:
            player.inactivatedAt == null || player.inactivatedAtApprox === true,
        },
        time,
      });
    }
  }

  if (player.deletedAt != null) {
    const time = timeOf(player.deletedAt);
    if (time != null) {
      candidates.push({
        exit: {
          date: player.deletedAt,
          reason: "excluido",
          approximate: false,
        },
        time,
      });
    }
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].exit;

  const [inactivation, deletion] = candidates;
  // Primeiro evento vence; empate → exclusão.
  return inactivation.time < deletion.time ? inactivation.exit : deletion.exit;
}

/** Ordena por data crescente, desempate por nome (pt-BR). */
function byDateThenName(a: PlayerFlowEntryItem, b: PlayerFlowEntryItem) {
  const diff = (timeOf(a.date) ?? 0) - (timeOf(b.date) ?? 0);
  if (diff !== 0) return diff;
  return a.name.localeCompare(b.name, "pt-BR");
}

/**
 * Monta a série mensal (startPeriod..currentPeriod) e as listas de quem
 * entrou/saiu no mês selecionado.
 */
export function buildPlayerFlow(
  players: PlayerFlowInput[],
  options: {
    selectedPeriod: string;
    currentPeriod: string;
    startPeriod?: string;
  },
): PlayerFlow {
  const startPeriod = options.startPeriod ?? PLAYER_FLOW_START_PERIOD;
  const { selectedPeriod, currentPeriod } = options;
  const selectedBeforeStart = selectedPeriod < startPeriod;

  const series: PlayerFlowMonthPoint[] = [];
  const byMonth = new Map<string, PlayerFlowMonthPoint>();
  for (
    let month = startPeriod;
    month <= currentPeriod;
    month = shiftPeriod(month, 1)
  ) {
    const point = { month, entries: 0, exits: 0 };
    series.push(point);
    byMonth.set(month, point);
  }

  const entries: PlayerFlowEntryItem[] = [];
  const exits: PlayerFlowExitItem[] = [];

  for (const player of players) {
    const base = {
      playerId: player.id,
      name: player.name,
      nickname: player.nickname,
    };

    // Entrada: só meses dentro da janela [startPeriod, currentPeriod].
    const entryMonth = safePeriod(player.createdAt);
    const entryPoint = entryMonth ? byMonth.get(entryMonth) : undefined;
    if (entryPoint) {
      entryPoint.entries += 1;
      if (entryMonth === selectedPeriod) {
        entries.push({ ...base, date: player.createdAt });
      }
    }

    const exit = resolvePlayerExit(player);
    if (exit) {
      const exitMonth = safePeriod(exit.date);
      const exitPoint = exitMonth ? byMonth.get(exitMonth) : undefined;
      if (exitPoint) {
        exitPoint.exits += 1;
        if (exitMonth === selectedPeriod) {
          exits.push({
            ...base,
            date: exit.date,
            reason: exit.reason,
            approximate: exit.approximate,
          });
        }
      }
    }
  }

  entries.sort(byDateThenName);
  exits.sort(byDateThenName);

  return {
    startPeriod,
    series,
    selectedPeriod,
    selectedBeforeStart,
    entries: selectedBeforeStart ? [] : entries,
    exits: selectedBeforeStart ? [] : exits,
  };
}
