import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlayerFlowSection } from "@/components/PlayerFlowSection";
import type { PlayerFlow } from "@/lib/dashboard/player-flow";

// O gráfico (Recharts/ResponsiveContainer) não renderiza no jsdom; aqui só
// importam as listas e mensagens.
vi.mock("@/components/charts/PlayerFlowChart", () => ({
  PlayerFlowChart: () => null,
}));

afterEach(() => cleanup());

function flow(overrides: Partial<PlayerFlow> = {}): PlayerFlow {
  return {
    startPeriod: "2026-10",
    series: [{ month: "2026-10", entries: 1, exits: 2 }],
    selectedPeriod: "2026-10",
    selectedBeforeStart: false,
    entries: [
      {
        playerId: "p1",
        name: "Ana",
        nickname: "Aninha",
        date: "2026-10-05T15:00:00Z",
      },
    ],
    exits: [
      {
        playerId: "p2",
        name: "Bruno",
        nickname: null,
        date: "2026-10-10T15:00:00Z",
        reason: "inativado",
        approximate: true,
      },
      {
        playerId: "p3",
        name: "Carlos",
        nickname: null,
        date: "2026-10-12T15:00:00Z",
        reason: "excluido",
        approximate: false,
      },
    ],
    ...overrides,
  };
}

describe("PlayerFlowSection", () => {
  it("lista quem entrou e quem saiu, com motivo e data aproximada", () => {
    render(<PlayerFlowSection flow={flow()} />);

    expect(
      screen.getByText("Entraram em Outubro de 2026 (1)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Ana (Aninha)")).toBeInTheDocument();
    expect(
      screen.getByText("Saíram em Outubro de 2026 (2)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Inativado")).toBeInTheDocument();
    expect(screen.getByText("Excluído")).toBeInTheDocument();

    const brunoItem = screen.getByText("Bruno").closest("li");
    const carlosItem = screen.getByText("Carlos").closest("li");
    expect(brunoItem).toHaveTextContent("10/10/2026 (data aproximada)");
    expect(carlosItem).not.toHaveTextContent("data aproximada");
  });

  it("mostra mensagens de vazio", () => {
    render(<PlayerFlowSection flow={flow({ entries: [], exits: [] })} />);
    expect(screen.getByText("Nenhuma entrada neste mês.")).toBeInTheDocument();
    expect(screen.getByText("Nenhuma saída neste mês.")).toBeInTheDocument();
  });

  it("avisa quando o mês selecionado é anterior ao histórico", () => {
    render(
      <PlayerFlowSection
        flow={flow({
          selectedPeriod: "2026-09",
          selectedBeforeStart: true,
          entries: [],
          exits: [],
        })}
      />,
    );
    expect(
      screen.getByText("Histórico disponível a partir de Outubro de 2026."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Entraram em/)).not.toBeInTheDocument();
  });

  it("mostra erro quando o carregamento falhou", () => {
    render(<PlayerFlowSection flow={null} />);
    expect(
      screen.getByText("Não foi possível carregar as movimentações."),
    ).toBeInTheDocument();
  });
});
