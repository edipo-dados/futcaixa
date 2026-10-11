import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MembershipSession } from "@/lib/auth/membership";
import { Sidebar } from "@/components/layout/Sidebar";

const useSessionMock = vi.fn<() => MembershipSession>();

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => useSessionMock(),
}));

// A troca de futebol é uma Server Action (server-only); nos testes de UI só nos
// importa que o seletor aparece/desaparece, não a navegação em si.
vi.mock("@/app/(app)/trocar-futebol/actions", () => ({
  setActiveClub: vi.fn(),
}));

function baseSession(
  overrides: Partial<MembershipSession> = {},
): MembershipSession {
  const memberships = overrides.memberships ?? [
    {
      membershipId: "m-0",
      clubId: "club-a",
      clubName: "Clube A",
      role: "presidente" as const,
      playerId: null,
    },
  ];
  const activeClub =
    overrides.activeClub !== undefined ? overrides.activeClub : memberships[0];
  return {
    userId: "user-1",
    fullName: "Fulano",
    isSystemAdmin: false,
    memberships,
    hasNoClub: memberships.length === 0,
    activeClub,
    role: activeClub?.role ?? null,
    playerId: null,
    ...overrides,
  };
}

describe("Sidebar (tarefa 23.2)", () => {
  afterEach(() => {
    cleanup();
    useSessionMock.mockReset();
  });

  it("com um único futebol exibe o nome sem seletor de troca", () => {
    useSessionMock.mockReturnValue(baseSession());

    render(<Sidebar />);

    // O nome do clube aparece (como texto), mas não há seletor de troca.
    expect(screen.getAllByText("Clube A").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("combobox", { name: "Trocar de futebol" }),
    ).toBeNull();
  });

  it("com mais de um futebol exibe o seletor de troca com todos os clubes", () => {
    const memberships = [
      {
        membershipId: "m-0",
        clubId: "club-a",
        clubName: "Clube A",
        role: "presidente" as const,
        playerId: null,
      },
      {
        membershipId: "m-1",
        clubId: "club-b",
        clubName: "Clube B",
        role: "jogador" as const,
        playerId: null,
      },
    ];
    useSessionMock.mockReturnValue(
      baseSession({ memberships, activeClub: memberships[0] }),
    );

    render(<Sidebar />);

    const selects = screen.getAllByRole("combobox", {
      name: "Trocar de futebol",
    });
    expect(selects.length).toBeGreaterThan(0);
    // Opções para cada clube ativo.
    expect(screen.getAllByRole("option", { name: "Clube A" }).length).toBe(
      selects.length,
    );
    expect(screen.getAllByRole("option", { name: "Clube B" }).length).toBe(
      selects.length,
    );
  });

  it("oculta a entrada de administração da plataforma para não-admin", () => {
    useSessionMock.mockReturnValue(baseSession({ isSystemAdmin: false }));

    render(<Sidebar />);

    expect(
      screen.queryByRole("link", { name: "Administração da plataforma" }),
    ).toBeNull();
  });

  it("exibe a entrada de administração da plataforma para system_admin", () => {
    useSessionMock.mockReturnValue(baseSession({ isSystemAdmin: true }));

    render(<Sidebar />);

    const links = screen.getAllByRole("link", {
      name: "Administração da plataforma",
    });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute("href", "/admin/solicitacoes");
  });

  it("oculta 'Ser presidente' para quem já é presidente de algum futebol", () => {
    // baseSession() torna o usuário presidente do Clube A.
    useSessionMock.mockReturnValue(baseSession());

    render(<Sidebar />);

    expect(screen.queryByRole("link", { name: "Ser presidente" })).toBeNull();
  });

  it("exibe 'Ser presidente' para um jogador comum (não presidente, não admin)", () => {
    const memberships = [
      {
        membershipId: "m-0",
        clubId: "club-a",
        clubName: "Clube A",
        role: "jogador" as const,
        playerId: null,
      },
    ];
    useSessionMock.mockReturnValue(
      baseSession({ memberships, activeClub: memberships[0] }),
    );

    render(<Sidebar />);

    const links = screen.getAllByRole("link", { name: "Ser presidente" });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute("href", "/ser-presidente");
  });
});
