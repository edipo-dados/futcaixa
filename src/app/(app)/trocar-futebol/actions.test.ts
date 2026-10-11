import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACTIVE_CLUB_COOKIE,
  type MembershipSession,
} from "@/lib/auth/membership";

// `redirect` lança no runtime do Next para interromper o fluxo; aqui lançamos
// um erro identificável para asserir o destino sem continuar a execução.
class RedirectError extends Error {
  constructor(public readonly to: string) {
    super(`REDIRECT:${to}`);
  }
}

const redirectMock = vi.fn((to: string) => {
  throw new RedirectError(to);
});
const cookieSetMock = vi.fn();
const getMembershipSessionMock =
  vi.fn<() => Promise<MembershipSession | null>>();

vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirectMock(to),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: cookieSetMock }),
}));

vi.mock("@/lib/auth/membership", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth/membership")>(
      "@/lib/auth/membership",
    );
  return {
    ...actual,
    getMembershipSession: () => getMembershipSessionMock(),
  };
});

import { setActiveClub } from "./actions";

function sessionWith(clubIds: string[]): MembershipSession {
  const memberships = clubIds.map((clubId, index) => ({
    membershipId: `m-${index}`,
    clubId,
    clubName: `Clube ${index}`,
    role: "presidente" as const,
    playerId: null,
  }));
  return {
    userId: "user-1",
    fullName: "Fulano",
    isSystemAdmin: false,
    memberships,
    hasNoClub: memberships.length === 0,
    activeClub: memberships[0] ?? null,
    role: memberships[0]?.role ?? null,
    playerId: null,
  };
}

async function callAndCaptureRedirect(clubId: string): Promise<string> {
  try {
    await setActiveClub(clubId);
  } catch (error) {
    if (error instanceof RedirectError) {
      return error.to;
    }
    throw error;
  }
  throw new Error("setActiveClub não redirecionou");
}

describe("setActiveClub", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    cookieSetMock.mockClear();
    getMembershipSessionMock.mockReset();
  });

  it("grava o cookie fc_active_club e redireciona ao dashboard quando há membership ativa", async () => {
    getMembershipSessionMock.mockResolvedValue(sessionWith(["club-a", "club-b"]));

    const to = await callAndCaptureRedirect("club-b");

    expect(cookieSetMock).toHaveBeenCalledTimes(1);
    expect(cookieSetMock).toHaveBeenCalledWith(
      ACTIVE_CLUB_COOKIE,
      "club-b",
      expect.objectContaining({ path: "/", sameSite: "lax" }),
    );
    expect(to).toBe("/dashboard");
  });

  it("rejeita clubId sem membership ativa: não grava cookie e volta ao dashboard", async () => {
    getMembershipSessionMock.mockResolvedValue(sessionWith(["club-a"]));

    const to = await callAndCaptureRedirect("club-intruso");

    expect(cookieSetMock).not.toHaveBeenCalled();
    expect(to).toBe("/dashboard");
  });

  it("redireciona ao login quando não há sessão", async () => {
    getMembershipSessionMock.mockResolvedValue(null);

    const to = await callAndCaptureRedirect("club-a");

    expect(cookieSetMock).not.toHaveBeenCalled();
    expect(to).toBe("/login");
  });

  it("ignora clubId vazio sem consultar a sessão nem gravar cookie", async () => {
    const to = await callAndCaptureRedirect("   ");

    expect(getMembershipSessionMock).not.toHaveBeenCalled();
    expect(cookieSetMock).not.toHaveBeenCalled();
    expect(to).toBe("/dashboard");
  });
});
