import { describe, expect, it } from "vitest";

import {
  resolveActiveClub,
  type ActiveMembership,
} from "@/lib/auth/membership";

/** Helper para montar uma membership ativa com defaults enxutos. */
function membership(overrides: Partial<ActiveMembership> = {}): ActiveMembership {
  return {
    membershipId: "m1",
    clubId: "club-1",
    clubName: "Futebol A",
    role: "jogador",
    playerId: null,
    ...overrides,
  };
}

describe("resolveActiveClub", () => {
  it("retorna null quando não há membership (estado sem futebol)", () => {
    expect(resolveActiveClub([], null)).toBeNull();
    expect(resolveActiveClub([], "club-1")).toBeNull();
  });

  it("retorna a única membership, ignorando o cookie", () => {
    const only = membership({ clubId: "club-1" });
    expect(resolveActiveClub([only], null)).toBe(only);
    expect(resolveActiveClub([only], "club-outro")).toBe(only);
  });

  it("com mais de uma, escolhe a membership do club_id preferido", () => {
    const a = membership({ clubId: "club-1", clubName: "A" });
    const b = membership({ clubId: "club-2", clubName: "B" });
    expect(resolveActiveClub([a, b], "club-2")).toBe(b);
  });

  it("com mais de uma e cookie ausente, faz fallback para a primeira", () => {
    const a = membership({ clubId: "club-1", clubName: "A" });
    const b = membership({ clubId: "club-2", clubName: "B" });
    expect(resolveActiveClub([a, b], null)).toBe(a);
  });

  it("com mais de uma e cookie inválido, faz fallback para a primeira", () => {
    const a = membership({ clubId: "club-1", clubName: "A" });
    const b = membership({ clubId: "club-2", clubName: "B" });
    expect(resolveActiveClub([a, b], "club-inexistente")).toBe(a);
  });
});
