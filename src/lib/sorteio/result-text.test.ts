import { describe, expect, it } from "vitest";

import { buildDraftResultText } from "@/lib/sorteio/result-text";
import type { DraftResult } from "@/lib/sorteio/draft";

const RESULT: DraftResult = [
  {
    color: "Azul",
    players: [
      { name: "Ronaldinho", level: 3 },
      { name: "Cafu", level: 2 },
    ],
  },
  {
    color: "Vermelho",
    players: [
      { name: "Roberto", level: 1 },
      { name: "Marta", level: 3 },
    ],
  },
];

describe("buildDraftResultText", () => {
  it("inclui o cabeçalho padrão com emoji", () => {
    const text = buildDraftResultText(RESULT);
    expect(text.startsWith("⚽ Times sorteados")).toBe(true);
  });

  it("permite customizar o título", () => {
    const text = buildDraftResultText(RESULT, { title: "Pelada de sábado" });
    expect(text.startsWith("Pelada de sábado")).toBe(true);
    expect(text).not.toContain("Times sorteados");
  });

  it("usa o título padrão quando o título é vazio ou só espaços", () => {
    expect(buildDraftResultText(RESULT, { title: "   " })).toContain(
      "⚽ Times sorteados",
    );
  });

  it("contém o nome de cada cor de time", () => {
    const text = buildDraftResultText(RESULT);
    for (const team of RESULT) {
      expect(text).toContain(team.color);
    }
  });

  it("contém o nome de cada jogador", () => {
    const text = buildDraftResultText(RESULT);
    for (const team of RESULT) {
      for (const player of team.players) {
        expect(text).toContain(player.name);
      }
    }
  });

  it("usa marcador de lista para cada jogador", () => {
    const text = buildDraftResultText(RESULT);
    const bulletCount = (text.match(/•/g) ?? []).length;
    const totalPlayers = RESULT.reduce((n, t) => n + t.players.length, 0);
    expect(bulletCount).toBe(totalPlayers);
  });

  it("mapeia cores conhecidas para emojis de círculo colorido", () => {
    const text = buildDraftResultText(RESULT);
    expect(text).toContain("🔵 Azul");
    expect(text).toContain("🔴 Vermelho");
  });

  it("não inclui níveis por padrão", () => {
    const text = buildDraftResultText(RESULT);
    expect(text).not.toContain("nível");
  });

  it("inclui os níveis quando solicitado", () => {
    const text = buildDraftResultText(RESULT, { includeLevels: true });
    expect(text).toContain("Ronaldinho (nível 3)");
    expect(text).toContain("Roberto (nível 1)");
  });

  it("separa os blocos de time por linha em branco", () => {
    const text = buildDraftResultText(RESULT);
    // Cabeçalho + 2 blocos => separados por "\n\n".
    const blocks = text.split("\n\n");
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toContain("Azul");
    expect(blocks[2]).toContain("Vermelho");
  });

  it("usa apenas o nome quando a cor não tem emoji conhecido", () => {
    const generic: DraftResult = [
      { color: "Time 1", players: [{ name: "Alex", level: 2 }] },
    ];
    const text = buildDraftResultText(generic);
    expect(text).toContain("Time 1\n• Alex");
  });

  it("indica time sem jogadores", () => {
    const withEmpty: DraftResult = [
      { color: "Azul", players: [{ name: "Alex", level: 2 }] },
      { color: "Vermelho", players: [] },
    ];
    const text = buildDraftResultText(withEmpty);
    expect(text).toContain("(sem jogadores)");
  });

  it("é determinística: mesma entrada produz a mesma saída", () => {
    expect(buildDraftResultText(RESULT)).toBe(buildDraftResultText(RESULT));
  });
});
