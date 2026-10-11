/**
 * Agregação de inadimplentes (Req 7.1).
 *
 * "Atrasada" é um estado DERIVADO (vencimento no passado E status `pendente`,
 * Req 5.5), nunca armazenado. A seleção das cobranças atrasadas acontece na
 * query (ver `inadimplentes/data.ts`); este módulo é PURO (sem banco) e apenas
 * agrupa as cobranças já filtradas por jogador, para ser facilmente testável.
 *
 * Convenção de "meses em atraso": é a quantidade de MESES DISTINTOS entre as
 * cobranças atrasadas do jogador (não a diferença de calendário até hoje).
 * Usa o `period` (`YYYY-MM`) quando presente — típico de mensalidades — e, na
 * ausência, deriva o mês a partir do `dueDate` (os 7 primeiros caracteres de
 * uma data `YYYY-MM-DD`). Assim, duas cobranças do mesmo mês contam como 1 mês
 * e duas de meses diferentes contam como 2.
 */

/**
 * Cobrança atrasada de entrada para a agregação. Reúne os campos do jogador
 * (via join) e os campos relevantes da cobrança. É intencionalmente simples
 * (sem dependência de tipos de banco) para manter o helper puro e testável.
 */
export interface OverdueCharge {
  playerId: string;
  playerName: string;
  playerNickname?: string | null;
  amountCents: number;
  /** Data de vencimento (`YYYY-MM-DD`). */
  dueDate: string;
  /** Período de referência (`YYYY-MM`), presente em mensalidades. */
  period?: string | null;
}

/**
 * Linha agregada por jogador exibida na tela de inadimplentes (Req 7.1).
 */
export interface DelinquentRow {
  playerId: string;
  playerName: string;
  playerNickname: string | null;
  /** Soma do valor devido (centavos) das cobranças atrasadas do jogador. */
  totalCents: number;
  /** Quantidade de meses DISTINTOS em atraso. */
  monthsOverdue: number;
  /** Quantidade de cobranças atrasadas do jogador. */
  chargeCount: number;
}

/**
 * Resolve o mês (`YYYY-MM`) de uma cobrança: usa `period` quando presente,
 * senão os 7 primeiros caracteres do `dueDate` (`YYYY-MM-DD` → `YYYY-MM`).
 */
function monthKeyOf(charge: OverdueCharge): string {
  if (charge.period) {
    return charge.period;
  }
  return charge.dueDate.slice(0, 7);
}

/**
 * Agrupa cobranças atrasadas por jogador e computa, para cada um, o total
 * devido, a quantidade de meses distintos em atraso e o número de cobranças.
 *
 * O resultado é ordenado por `totalCents` em ordem decrescente (quem deve mais
 * aparece primeiro); em caso de empate, desempata pelo nome do jogador em
 * ordem alfabética (pt-BR) para uma ordenação estável e previsível.
 *
 * @param charges cobranças já filtradas como atrasadas (pendentes e vencidas).
 */
export function aggregateDelinquents(
  charges: readonly OverdueCharge[],
): DelinquentRow[] {
  interface Accumulator {
    playerId: string;
    playerName: string;
    playerNickname: string | null;
    totalCents: number;
    chargeCount: number;
    months: Set<string>;
  }

  const byPlayer = new Map<string, Accumulator>();

  for (const charge of charges) {
    let acc = byPlayer.get(charge.playerId);
    if (!acc) {
      acc = {
        playerId: charge.playerId,
        playerName: charge.playerName,
        playerNickname: charge.playerNickname ?? null,
        totalCents: 0,
        chargeCount: 0,
        months: new Set<string>(),
      };
      byPlayer.set(charge.playerId, acc);
    }

    acc.totalCents += charge.amountCents;
    acc.chargeCount += 1;
    acc.months.add(monthKeyOf(charge));
  }

  const rows: DelinquentRow[] = Array.from(byPlayer.values()).map((acc) => ({
    playerId: acc.playerId,
    playerName: acc.playerName,
    playerNickname: acc.playerNickname,
    totalCents: acc.totalCents,
    monthsOverdue: acc.months.size,
    chargeCount: acc.chargeCount,
  }));

  rows.sort((a, b) => {
    if (b.totalCents !== a.totalCents) {
      return b.totalCents - a.totalCents;
    }
    return a.playerName.localeCompare(b.playerName, "pt-BR");
  });

  return rows;
}
