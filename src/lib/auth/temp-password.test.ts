import { describe, expect, it } from "vitest";

import { generateTempPassword } from "./temp-password";

/**
 * Testes da geração de senha temporária (§3.5).
 *
 * Rodamos em laço para cobrir a aleatoriedade: comprimento fixo, alfabeto sem
 * ambíguos, garantia de ao menos uma de cada classe e ausência de repetição
 * trivial entre chamadas.
 */

const ALLOWED = /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]+$/;
const AMBIGUOUS = /[0O1lI]/;

describe("generateTempPassword", () => {
  it("tem sempre 12 caracteres", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateTempPassword()).toHaveLength(12);
    }
  });

  it("usa apenas o alfabeto permitido", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateTempPassword()).toMatch(ALLOWED);
    }
  });

  it("não contém caracteres ambíguos (0 O 1 l I)", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateTempPassword()).not.toMatch(AMBIGUOUS);
    }
  });

  it("contém ao menos uma maiúscula, uma minúscula e um dígito", () => {
    for (let i = 0; i < 200; i += 1) {
      const pwd = generateTempPassword();
      expect(pwd).toMatch(/[A-Z]/);
      expect(pwd).toMatch(/[a-z]/);
      expect(pwd).toMatch(/[0-9]/);
    }
  });

  it("gera valores diferentes entre chamadas", () => {
    expect(generateTempPassword()).not.toBe(generateTempPassword());
  });
});
