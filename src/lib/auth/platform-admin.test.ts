import { describe, expect, it } from "vitest";

import { type MembershipSession } from "@/lib/auth/membership";
import { isPlatformAdmin, resolvePlatformAdminGuard } from "./platform-admin";

/**
 * Testes da guarda de plataforma (tarefa 19.2 — Requisitos 2.5, 17.3).
 *
 * Cobrem a função PURA que decide quem acessa/atua na administração da
 * plataforma (`system_admin`) e para onde o não-autorizado é redirecionado.
 */

/** Monta uma `MembershipSession` mínima para os cenários dos testes. */
function makeSession(overrides: Partial<MembershipSession> = {}): MembershipSession {
  return {
    userId: "user-1",
    fullName: "Fulano",
    isSystemAdmin: false,
    memberships: [],
    hasNoClub: true,
    activeClub: null,
    role: null,
    playerId: null,
    ...overrides,
  };
}

describe("resolvePlatformAdminGuard", () => {
  it("autoriza o system_admin", () => {
    const guard = resolvePlatformAdminGuard(
      makeSession({ isSystemAdmin: true }),
    );
    expect(guard.authorized).toBe(true);
  });

  it("manda usuário sem sessão para o onboarding", () => {
    const guard = resolvePlatformAdminGuard(null);
    expect(guard).toEqual({ authorized: false, redirectTo: "/sem-futebol" });
  });

  it("manda não-admin sem futebol para o onboarding", () => {
    const guard = resolvePlatformAdminGuard(
      makeSession({ isSystemAdmin: false, hasNoClub: true }),
    );
    expect(guard).toEqual({ authorized: false, redirectTo: "/sem-futebol" });
  });

  it("manda não-admin com futebol para o dashboard", () => {
    const guard = resolvePlatformAdminGuard(
      makeSession({
        isSystemAdmin: false,
        hasNoClub: false,
        role: "jogador",
      }),
    );
    expect(guard).toEqual({ authorized: false, redirectTo: "/dashboard" });
  });
});

describe("isPlatformAdmin", () => {
  it("é true apenas para system_admin", () => {
    expect(isPlatformAdmin(makeSession({ isSystemAdmin: true }))).toBe(true);
    expect(isPlatformAdmin(makeSession({ isSystemAdmin: false }))).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
  });
});
