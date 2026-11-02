import { describe, expect, it } from "vitest";

import {
  buildPlayerFlow,
  resolvePlayerExit,
  type PlayerFlowInput,
} from "./player-flow";

let seq = 0;

/** Fábrica de jogador com defaults (ativo, datas em 15/10/2026). */
function player(overrides: Partial<PlayerFlowInput> = {}): PlayerFlowInput {
  seq += 1;
  return {
    id: `p-${seq}`,
    name: `Jogador ${seq}`,
    nickname: null,
    status: "ativo",
    createdAt: "2026-10-15T15:00:00Z",
    updatedAt: "2026-10-15T15:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

const OPTS = { selectedPeriod: "2026-10", currentPeriod: "2026-11" };

function totalExits(flow: ReturnType<typeof buildPlayerFlow>): number {
  return flow.series.reduce((sum, p) => sum + p.exits, 0);
}

describe("buildPlayerFlow — fuso America/Sao_Paulo", () => {
  it("01:00 UTC do dia 1º pertence ao mês anterior em SP", () => {
    const flow = buildPlayerFlow(
      [player({ createdAt: "2026-11-01T01:00:00Z" })],
      OPTS,
    );
    expect(flow.series).toEqual([
      { month: "2026-10", entries: 1, exits: 0 },
      { month: "2026-11", entries: 0, exits: 0 },
    ]);
    expect(flow.entries).toHaveLength(1);
  });

  it("03:30 UTC do dia 1º já é o próprio mês em SP", () => {
    const flow = buildPlayerFlow(
      [player({ createdAt: "2026-11-01T03:30:00Z" })],
      OPTS,
    );
    expect(flow.series[1]).toEqual({ month: "2026-11", entries: 1, exits: 0 });
    expect(flow.series[0].entries).toBe(0);
  });
});

describe("buildPlayerFlow — corte e série", () => {
  it("entrada anterior a 2026-10 não aparece", () => {
    const flow = buildPlayerFlow(
      [player({ createdAt: "2026-09-20T15:00:00Z" })],
      OPTS,
    );
    expect(flow.series.every((p) => p.entries === 0)).toBe(true);
    expect(flow.entries).toEqual([]);
  });

  it("série contínua com zeros nos meses vazios", () => {
    const flow = buildPlayerFlow([player()], {
      selectedPeriod: "2026-10",
      currentPeriod: "2026-12",
    });
    expect(flow.series).toEqual([
      { month: "2026-10", entries: 1, exits: 0 },
      { month: "2026-11", entries: 0, exits: 0 },
      { month: "2026-12", entries: 0, exits: 0 },
    ]);
  });

  it("série vazia quando o mês atual é anterior ao início", () => {
    const flow = buildPlayerFlow([player()], {
      selectedPeriod: "2026-09",
      currentPeriod: "2026-09",
    });
    expect(flow.series).toEqual([]);
  });

  it("saída anterior ao corte é ignorada", () => {
    const flow = buildPlayerFlow(
      [
        player({
          createdAt: "2026-08-01T15:00:00Z",
          status: "inativo",
          inactivatedAt: "2026-09-10T15:00:00Z",
          inactivatedAtApprox: false,
        }),
      ],
      OPTS,
    );
    expect(totalExits(flow)).toBe(0);
    expect(flow.exits).toEqual([]);
  });
});

describe("resolvePlayerExit", () => {
  it("inativação com data exata", () => {
    expect(
      resolvePlayerExit(
        player({
          status: "inativo",
          inactivatedAt: "2026-11-05T15:00:00Z",
          inactivatedAtApprox: false,
          updatedAt: "2026-11-20T15:00:00Z",
        }),
      ),
    ).toEqual({
      date: "2026-11-05T15:00:00Z",
      reason: "inativado",
      approximate: false,
    });
  });

  it("inativo sem inactivatedAt (antes da migration) usa updatedAt aproximado", () => {
    expect(
      resolvePlayerExit(
        player({ status: "inativo", updatedAt: "2026-10-20T15:00:00Z" }),
      ),
    ).toEqual({
      date: "2026-10-20T15:00:00Z",
      reason: "inativado",
      approximate: true,
    });
  });

  it("inativação do backfill (approx=true) é aproximada", () => {
    expect(
      resolvePlayerExit(
        player({
          status: "inativo",
          inactivatedAt: "2026-10-20T15:00:00Z",
          inactivatedAtApprox: true,
        }),
      )?.approximate,
    ).toBe(true);
  });

  it("reativado não conta como saída", () => {
    expect(
      resolvePlayerExit(
        player({ status: "ativo", inactivatedAt: "2026-10-20T15:00:00Z" }),
      ),
    ).toBeNull();
  });

  it("excluído (status ativo) conta como exclusão exata", () => {
    expect(
      resolvePlayerExit(player({ deletedAt: "2026-11-03T15:00:00Z" })),
    ).toEqual({
      date: "2026-11-03T15:00:00Z",
      reason: "excluido",
      approximate: false,
    });
  });

  it("excluído e inativo: vale a inativação quando vem antes", () => {
    const p = player({
      status: "inativo",
      inactivatedAt: "2026-10-20T15:00:00Z",
      inactivatedAtApprox: false,
      deletedAt: "2026-11-03T15:00:00Z",
    });
    expect(resolvePlayerExit(p)?.reason).toBe("inativado");

    const flow = buildPlayerFlow([p], OPTS);
    expect(flow.series).toEqual([
      { month: "2026-10", entries: 1, exits: 1 },
      { month: "2026-11", entries: 0, exits: 0 },
    ]);
    expect(totalExits(flow)).toBe(1);
  });

  it("excluído e inativo: inativação aproximada posterior → exclusão", () => {
    expect(
      resolvePlayerExit(
        player({
          status: "inativo",
          updatedAt: "2026-11-10T15:00:00Z",
          deletedAt: "2026-11-03T15:00:00Z",
        }),
      ),
    ).toEqual({
      date: "2026-11-03T15:00:00Z",
      reason: "excluido",
      approximate: false,
    });
  });

  it("empate exato de instante → exclusão", () => {
    expect(
      resolvePlayerExit(
        player({
          status: "inativo",
          inactivatedAt: "2026-11-03T15:00:00Z",
          deletedAt: "2026-11-03T15:00:00.000Z",
        }),
      )?.reason,
    ).toBe("excluido");
  });
});

describe("buildPlayerFlow — listas do mês selecionado", () => {
  it("só itens do mês, ordenados por data; contagens batem com a série", () => {
    const flow = buildPlayerFlow(
      [
        player({ name: "Carlos", createdAt: "2026-10-20T15:00:00Z" }),
        player({ name: "Bruno", createdAt: "2026-10-05T15:00:00Z" }),
        player({ name: "Ana", createdAt: "2026-10-20T15:00:00Z" }),
        player({ name: "Outro mês", createdAt: "2026-11-02T15:00:00Z" }),
        player({
          name: "Saiu",
          createdAt: "2026-09-01T15:00:00Z",
          deletedAt: "2026-10-25T15:00:00Z",
        }),
      ],
      OPTS,
    );
    expect(flow.entries.map((e) => e.name)).toEqual(["Bruno", "Ana", "Carlos"]);
    expect(flow.exits.map((e) => e.name)).toEqual(["Saiu"]);
    expect(flow.series[0]).toEqual({
      month: "2026-10",
      entries: flow.entries.length,
      exits: flow.exits.length,
    });
  });

  it("entra e sai no mesmo mês → aparece nas duas listas", () => {
    const flow = buildPlayerFlow(
      [
        player({
          name: "Rápido",
          status: "inativo",
          inactivatedAt: "2026-10-28T15:00:00Z",
          inactivatedAtApprox: false,
        }),
      ],
      OPTS,
    );
    expect(flow.entries.map((e) => e.name)).toEqual(["Rápido"]);
    expect(flow.exits).toEqual([
      expect.objectContaining({
        name: "Rápido",
        reason: "inativado",
        approximate: false,
      }),
    ]);
  });

  it("mês selecionado antes do início → listas vazias, série preenchida", () => {
    const flow = buildPlayerFlow([player()], {
      selectedPeriod: "2026-09",
      currentPeriod: "2026-11",
    });
    expect(flow.selectedBeforeStart).toBe(true);
    expect(flow.entries).toEqual([]);
    expect(flow.exits).toEqual([]);
    expect(flow.series).toHaveLength(2);
    expect(flow.series[0].entries).toBe(1);
  });

  it("data inválida não lança e não conta", () => {
    const flow = buildPlayerFlow([player({ createdAt: "não é data" })], OPTS);
    expect(flow.series.every((p) => p.entries === 0)).toBe(true);
    expect(flow.entries).toEqual([]);
  });
});
