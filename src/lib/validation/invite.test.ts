import { describe, expect, it } from "vitest";

import { joinClubSchema } from "./invite";

/**
 * Testes do schema de validação do fluxo de convite (tarefa 20.2 — Req 4.3).
 *
 * O payload da Server Action de entrada é mínimo: apenas o `clubId` (UUID)
 * resolvido do convite. Validamos o formato por defesa em profundidade — a RLS
 * é a autoridade real, mas rejeitar um `clubId` malformado cedo evita uma
 * ida inútil ao banco e torna o erro previsível.
 */

const VALID_UUID = "56e343c2-15b3-4e2c-bd75-e17876ab466f";

describe("joinClubSchema", () => {
  it("aceita um clubId em formato UUID", () => {
    const result = joinClubSchema.safeParse({ clubId: VALID_UUID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clubId).toBe(VALID_UUID);
    }
  });

  it("rejeita um clubId que não é UUID", () => {
    const result = joinClubSchema.safeParse({ clubId: "nao-e-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejeita clubId ausente", () => {
    const result = joinClubSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejeita clubId vazio", () => {
    const result = joinClubSchema.safeParse({ clubId: "" });
    expect(result.success).toBe(false);
  });
});
