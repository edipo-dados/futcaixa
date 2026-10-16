import { describe, expect, it } from "vitest";

import { changePasswordSchema } from "./account";

/**
 * Testes do schema de troca de senha (aba "Meu cadastro").
 *
 * Cobre o tamanho mínimo da nova senha e a conferência (password === confirm),
 * espelhando o estilo de category.test.ts.
 */

describe("changePasswordSchema", () => {
  it("aceita um par válido (senha e confirmação iguais)", () => {
    const result = changePasswordSchema.safeParse({
      password: "segredo1",
      confirm: "segredo1",
    });
    expect(result.success).toBe(true);
  });

  it("rejeita senha com menos de 6 caracteres", () => {
    const result = changePasswordSchema.safeParse({
      password: "abc",
      confirm: "abc",
    });
    expect(result.success).toBe(false);
  });

  it("rejeita confirmação divergente com erro no campo confirm", () => {
    const result = changePasswordSchema.safeParse({
      password: "segredo1",
      confirm: "segredo2",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path[0] === "confirm",
      );
      expect(issue?.message).toBe("As senhas não conferem.");
    }
  });
});
