// Algoritmo de sorteio de times (100% client-side).
//
// Objetivo: a partir de uma lista de jogadores com nível técnico (1..3),
// distribuir em T times equilibrados, por rodadas:
//   - jogadores são agrupados em potes por nível;
//   - a cada rodada cada time recebe exatamente 1 jogador;
//   - a ordem dos times é embaralhada a cada rodada;
//   - na 1ª rodada garantimos que as N primeiras retiradas caiam em N times
//     distintos (uma cor diferente para cada uma das N primeiras retiradas);
//   - sobras (total não divisível por T) caem em rodadas parciais, em times
//     diferentes, de modo que os tamanhos difiram no máximo em 1.
//
// Determinismo: aceita uma seed numérica opcional para reproduzir resultados
// nos testes. Sem seed, usa Math.random.

/** Jogador de entrada do sorteio. */
export interface Player {
  /** Nome exibido do jogador. */
  name: string;
  /** Nível técnico: 1 (mais fraco) .. 3 (mais forte). */
  level: 1 | 2 | 3;
}

/** Opções de configuração do sorteio. */
export interface DraftOptions {
  /** Número de times (>= 2). */
  teams: number;
  /** Rótulos de cor dos times; o tamanho deve ser igual a `teams`. */
  colors: string[];
  /** Seed opcional para resultados reproduzíveis. */
  seed?: number;
}

/** Um time do resultado: a cor e os jogadores que caíram nele. */
export interface DraftTeam {
  /** Cor/rótulo do time. */
  color: string;
  /** Jogadores atribuídos ao time, na ordem de retirada. */
  players: Player[];
}

/** Resultado do sorteio: um time por cor, na ordem das cores informadas. */
export type DraftResult = DraftTeam[];

/**
 * Gerador pseudo-aleatório mulberry32: determinístico a partir de uma seed
 * numérica. Retorna uma função que produz floats em [0, 1).
 */
export function mulberry32(seed: number): () => number {
  // Mantém o estado como inteiro de 32 bits sem sinal.
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Embaralha uma cópia do array (Fisher–Yates) usando a função de aleatoriedade
 * fornecida. Não altera o array original.
 */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

/**
 * Valida as entradas do sorteio. Lança erro com mensagem clara em pt-BR quando
 * algo estiver inválido.
 */
function validateInputs(players: Player[], options: DraftOptions): void {
  const { teams, colors } = options;

  if (!Array.isArray(players) || players.length === 0) {
    throw new Error("A lista de jogadores não pode estar vazia.");
  }

  if (!Number.isInteger(teams) || teams < 2) {
    throw new Error(
      "O número de times deve ser um inteiro maior ou igual a 2.",
    );
  }

  if (!Array.isArray(colors) || colors.length !== teams) {
    throw new Error(
      `A quantidade de cores (${colors?.length ?? 0}) deve ser igual ao número de times (${teams}).`,
    );
  }

  const uniqueColors = new Set(colors);
  if (uniqueColors.size !== colors.length) {
    throw new Error("As cores dos times devem ser distintas.");
  }

  if (players.length < teams) {
    throw new Error(
      `São necessários ao menos ${teams} jogadores para formar ${teams} times.`,
    );
  }

  for (const player of players) {
    if (
      !player ||
      typeof player.name !== "string" ||
      player.name.trim() === ""
    ) {
      throw new Error("Todo jogador deve ter um nome não vazio.");
    }
    if (![1, 2, 3].includes(player.level)) {
      throw new Error(
        `Nível inválido para "${player.name}": deve ser 1, 2 ou 3.`,
      );
    }
  }
}

/**
 * Monta a fila de retirada dos jogadores: potes por nível, do mais forte ao
 * mais fraco, embaralhando os jogadores dentro de cada pote. Processar nível a
 * nível garante que os fortes sejam espalhados entre os times antes dos fracos,
 * e vice-versa, mantendo o equilíbrio.
 */
function buildDraftQueue(players: Player[], random: () => number): Player[] {
  // Agrupa por nível (3 = mais forte ... 1 = mais fraco).
  const pots: Record<number, Player[]> = { 3: [], 2: [], 1: [] };
  for (const player of players) {
    pots[player.level].push(player);
  }

  // Concatena os potes do mais forte ao mais fraco, embaralhando cada pote.
  const queue: Player[] = [];
  for (const level of [3, 2, 1]) {
    queue.push(...shuffle(pots[level], random));
  }
  return queue;
}

/**
 * Executa o sorteio por rodadas.
 *
 * @param players Lista de jogadores com nível 1..3.
 * @param options Número de times, cores e seed opcional.
 * @returns Um time por cor (mapa cor → jogadores), na ordem das cores.
 */
export function drawTeams(
  players: Player[],
  options: DraftOptions,
): DraftResult {
  validateInputs(players, options);

  const { teams, colors } = options;
  const random =
    options.seed === undefined ? Math.random : mulberry32(options.seed);

  // Fila de retirada: potes por nível, do mais forte ao mais fraco.
  const queue = buildDraftQueue(players, random);

  // Índices dos times (0..T-1), que serão embaralhados por rodada.
  const teamIndices = Array.from({ length: teams }, (_, i) => i);

  // Acumuladores de cada time.
  const buckets: Player[][] = Array.from({ length: teams }, () => []);

  let position = 0;
  let round = 0;

  // Enquanto houver jogadores, distribui 1 por time por rodada.
  while (position < queue.length) {
    // Ordem dos times para esta rodada.
    //
    // 1ª rodada: ordem fixa 0..T-1 (sem embaralhar), garantindo que as N
    // primeiras retiradas produzam N cores distintas, na ordem das cores. Isso
    // atende ao Req 9.5 de forma determinística.
    //
    // Demais rodadas: ordem embaralhada (Req 9.4).
    const order = round === 0 ? teamIndices : shuffle(teamIndices, random);

    for (const teamIndex of order) {
      if (position >= queue.length) {
        // Rodada parcial: acabaram os jogadores no meio da rodada. As sobras
        // caem em times diferentes porque cada time recebe no máximo 1 por
        // rodada (Req 9.7).
        break;
      }
      buckets[teamIndex].push(queue[position]);
      position += 1;
    }

    round += 1;
  }

  // Monta o resultado na ordem das cores informadas.
  return colors.map((color, index) => ({
    color,
    players: buckets[index],
  }));
}
