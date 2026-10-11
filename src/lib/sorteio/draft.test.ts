import { describe, expect, it } from "vitest";

import {
  drawTeams,
  mulberry32,
  shuffle,
  type DraftOptions,
  type DraftResult,
  type Player,
} from "@/lib/sorteio/draft";

// Seed fixa para resultados reproduzíveis nos testes.
const SEED = 12345;

/** Gera uma lista de jogadores com níveis cíclicos (1,2,3,1,2,3...). */
function makePlayers(count: number): Player[] {
  const levels: Array<1 | 2 | 3> = [1, 2, 3];
  return Array.from({ length: count }, (_, i) => ({
    name: `Jogador ${i + 1}`,
    level: levels[i % 3],
  }));
}

/** Soma o nível de todos os jogadores de um time. */
function teamLevelSum(players: Player[]): number {
  return players.reduce((acc, p) => acc + p.level, 0);
}

/** Lista plana de todos os jogadores do resultado. */
function allPlayers(result: DraftResult): Player[] {
  return result.flatMap((t) => t.players);
}

const COLORS_4 = ["Azul", "Vermelho", "Amarelo", "Verde"];
const COLORS_3 = ["Azul", "Vermelho", "Amarelo"];
const COLORS_2 = ["Azul", "Vermelho"];

describe("mulberry32", () => {
  it("é determinístico para a mesma seed", () => {
    const a = mulberry32(SEED);
    const b = mulberry32(SEED);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("produz floats em [0, 1)", () => {
    const rnd = mulberry32(SEED);
    for (let i = 0; i < 100; i++) {
      const v = rnd();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("shuffle", () => {
  it("não altera o array original e mantém os mesmos elementos", () => {
    const original = [1, 2, 3, 4, 5];
    const rnd = mulberry32(SEED);
    const result = shuffle(original, rnd);
    expect(original).toEqual([1, 2, 3, 4, 5]);
    expect([...result].sort((x, y) => x - y)).toEqual(original);
  });
});

describe("drawTeams — distribuição de cores (Req 9.5)", () => {
  it("as primeiras N retiradas produzem N cores diferentes", () => {
    const players = makePlayers(12);
    const result = drawTeams(players, {
      teams: 4,
      colors: COLORS_4,
      seed: SEED,
    });

    // Com players >= N, cada time deve receber ao menos 1 jogador na 1ª rodada.
    for (const team of result) {
      expect(team.players.length).toBeGreaterThanOrEqual(1);
    }

    // As N primeiras retiradas (uma por time) ocupam N cores distintas.
    const coresComJogador = result.filter((t) => t.players.length > 0);
    expect(coresComJogador).toHaveLength(4);
  });

  it("retorna os times na ordem das cores informadas", () => {
    const result = drawTeams(makePlayers(8), {
      teams: 4,
      colors: COLORS_4,
      seed: SEED,
    });
    expect(result.map((t) => t.color)).toEqual(COLORS_4);
  });
});

describe("drawTeams — equilíbrio de níveis (Req 9.6)", () => {
  it("mantém diferença mínima de soma de níveis (divisão exata)", () => {
    const players = makePlayers(12); // 12 / 4 = 3 por time
    const result = drawTeams(players, {
      teams: 4,
      colors: COLORS_4,
      seed: SEED,
    });

    const somas = result.map((t) => teamLevelSum(t.players));
    const diff = Math.max(...somas) - Math.min(...somas);
    // A diferença entre o time mais forte e o mais fraco deve ser pequena.
    expect(diff).toBeLessThanOrEqual(3);
  });

  it("mantém equilíbrio mesmo com sobras", () => {
    const players = makePlayers(14); // 14 / 4 => sobra 2
    const result = drawTeams(players, {
      teams: 4,
      colors: COLORS_4,
      seed: SEED,
    });

    const somas = result.map((t) => teamLevelSum(t.players));
    const diff = Math.max(...somas) - Math.min(...somas);
    expect(diff).toBeLessThanOrEqual(3);
  });

  it("não concentra os jogadores mais fracos em um único time", () => {
    // 9 jogadores: 3 de nível 1 (fracos), 3 de nível 2, 3 de nível 3.
    const players = makePlayers(9);
    const result = drawTeams(players, {
      teams: 3,
      colors: COLORS_3,
      seed: SEED,
    });

    // Cada time deve receber exatamente 1 jogador de nível 1.
    const fracosPorTime = result.map(
      (t) => t.players.filter((p) => p.level === 1).length,
    );
    expect(fracosPorTime).toEqual([1, 1, 1]);
  });
});

describe("drawTeams — sobras (Req 9.7)", () => {
  it("tamanhos de time diferem no máximo em 1 (sobra de 2)", () => {
    const players = makePlayers(14); // 14 / 4 => [4,4,3,3]
    const result = drawTeams(players, {
      teams: 4,
      colors: COLORS_4,
      seed: SEED,
    });

    const tamanhos = result.map((t) => t.players.length);
    const diff = Math.max(...tamanhos) - Math.min(...tamanhos);
    expect(diff).toBeLessThanOrEqual(1);
    // Exatamente 2 times com 1 jogador a mais.
    expect(tamanhos.filter((n) => n === Math.max(...tamanhos))).toHaveLength(2);
  });

  it("tamanhos de time diferem no máximo em 1 (sobra de 1)", () => {
    const players = makePlayers(13); // 13 / 4 => [4,3,3,3]
    const result = drawTeams(players, {
      teams: 4,
      colors: COLORS_4,
      seed: SEED,
    });

    const tamanhos = result.map((t) => t.players.length);
    const diff = Math.max(...tamanhos) - Math.min(...tamanhos);
    expect(diff).toBeLessThanOrEqual(1);
  });

  it("as sobras caem em times distintos", () => {
    const players = makePlayers(7); // 7 / 2 => [4,3] (sobra 1 em um time)
    const result = drawTeams(players, {
      teams: 2,
      colors: COLORS_2,
      seed: SEED,
    });

    const tamanhos = result.map((t) => t.players.length).sort((a, b) => b - a);
    expect(tamanhos).toEqual([4, 3]);
  });
});

describe("drawTeams — determinismo (Req 9.11)", () => {
  it("mesma seed produz exatamente o mesmo resultado", () => {
    const players = makePlayers(11);
    const opts: DraftOptions = { teams: 3, colors: COLORS_3, seed: SEED };
    const a = drawTeams(players, opts);
    const b = drawTeams(players, opts);
    expect(a).toEqual(b);
  });

  it("seeds diferentes normalmente produzem arranjos diferentes", () => {
    const players = makePlayers(12);
    const a = drawTeams(players, { teams: 4, colors: COLORS_4, seed: 1 });
    const b = drawTeams(players, { teams: 4, colors: COLORS_4, seed: 999 });
    // Compara apenas os nomes por time (a ordem interna já é suficiente).
    const namesA = a.map((t) => t.players.map((p) => p.name));
    const namesB = b.map((t) => t.players.map((p) => p.name));
    expect(namesA).not.toEqual(namesB);
  });
});

describe("drawTeams — conservação dos jogadores", () => {
  it("atribui cada jogador exatamente uma vez (sem perda nem duplicação)", () => {
    const players = makePlayers(17);
    const result = drawTeams(players, {
      teams: 4,
      colors: COLORS_4,
      seed: SEED,
    });

    const atribuidos = allPlayers(result);
    expect(atribuidos).toHaveLength(players.length);

    const nomesOriginais = players.map((p) => p.name).sort();
    const nomesAtribuidos = atribuidos.map((p) => p.name).sort();
    expect(nomesAtribuidos).toEqual(nomesOriginais);

    // Nenhum nome duplicado.
    expect(new Set(nomesAtribuidos).size).toBe(players.length);
  });
});

describe("drawTeams — validação de entradas", () => {
  it("rejeita lista de jogadores vazia", () => {
    expect(() =>
      drawTeams([], { teams: 2, colors: COLORS_2, seed: SEED }),
    ).toThrow();
  });

  it("rejeita menos de 2 times", () => {
    expect(() =>
      drawTeams(makePlayers(4), { teams: 1, colors: ["Azul"], seed: SEED }),
    ).toThrow();
  });

  it("rejeita número de cores diferente do número de times", () => {
    expect(() =>
      drawTeams(makePlayers(6), { teams: 3, colors: COLORS_2, seed: SEED }),
    ).toThrow();
  });

  it("rejeita cores repetidas", () => {
    expect(() =>
      drawTeams(makePlayers(6), {
        teams: 2,
        colors: ["Azul", "Azul"],
        seed: SEED,
      }),
    ).toThrow();
  });

  it("rejeita menos jogadores que times", () => {
    expect(() =>
      drawTeams(makePlayers(2), { teams: 4, colors: COLORS_4, seed: SEED }),
    ).toThrow();
  });

  it("rejeita nível fora do intervalo 1..3", () => {
    const invalidos = [{ name: "X", level: 5 as unknown as 1 }];
    expect(() =>
      drawTeams(invalidos, { teams: 2, colors: COLORS_2, seed: SEED }),
    ).toThrow();
  });

  it("rejeita jogador sem nome", () => {
    const invalidos: Player[] = [{ name: "  ", level: 1 }];
    expect(() =>
      drawTeams(invalidos, { teams: 2, colors: COLORS_2, seed: SEED }),
    ).toThrow();
  });
});
