import { describe, expect, it } from "vitest";

import { mapResetError } from "./reset-password-error";

/**
 * Testes do mapeamento de errcode -> mensagem pt-BR do reset de senha.
 */

describe("mapResetError", () => {
  it("mapeia 28000 (não autenticado)", () => {
    expect(mapResetError("28000")).toBe("Sua sessão expirou. Entre novamente.");
  });

  it("mapeia 42501 (não autorizado)", () => {
    expect(mapResetError("42501")).toBe("Apenas o presidente pode resetar.");
  });

  it("mapeia P0002 (jogador não encontrado)", () => {
    expect(mapResetError("P0002")).toBe(
      "Jogador não encontrado neste futebol.",
    );
  });

  it("mapeia 22023 (sem conta de acesso)", () => {
    expect(mapResetError("22023")).toBe(
      "Este jogador ainda não tem conta de acesso; não há senha para resetar.",
    );
  });

  it("usa a mensagem padrão para códigos desconhecidos", () => {
    expect(mapResetError("XXXXX")).toBe(
      "Não foi possível resetar a senha. Tente novamente.",
    );
  });
});
