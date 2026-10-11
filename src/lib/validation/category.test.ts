import { describe, expect, it } from "vitest";

import {
  CATEGORY_KINDS,
  createCategorySchema,
  renameCategorySchema,
} from "./category";

/**
 * Testes do schema de validação de Categorias (Req 3.3).
 *
 * Cobre o núcleo funcional: normalização de nome (trim), validação de tipo,
 * limites de tamanho e campos obrigatórios. As regras de uso/exclusão vivem na
 * Server Action (dependem do banco) e não são cobertas aqui.
 */

describe("CATEGORY_KINDS", () => {
  it("contém exatamente receita e despesa", () => {
    expect([...CATEGORY_KINDS]).toEqual(["receita", "despesa"]);
  });
});

describe("createCategorySchema", () => {
  it("aceita um tipo e nome válidos", () => {
    const result = createCategorySchema.safeParse({
      kind: "despesa",
      name: "Churrasco",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ kind: "despesa", name: "Churrasco" });
    }
  });

  it("remove espaços em volta do nome (trim)", () => {
    const result = createCategorySchema.safeParse({
      kind: "receita",
      name: "  Doação  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Doação");
    }
  });

  it("rejeita nome vazio", () => {
    const result = createCategorySchema.safeParse({
      kind: "despesa",
      name: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("rejeita nome ausente", () => {
    const result = createCategorySchema.safeParse({ kind: "despesa" });
    expect(result.success).toBe(false);
  });

  it("rejeita tipo inválido", () => {
    const result = createCategorySchema.safeParse({
      kind: "investimento",
      name: "Qualquer",
    });
    expect(result.success).toBe(false);
  });

  it("rejeita nome acima de 60 caracteres", () => {
    const result = createCategorySchema.safeParse({
      kind: "despesa",
      name: "a".repeat(61),
    });
    expect(result.success).toBe(false);
  });

  it("aceita nome exatamente no limite de 60 caracteres", () => {
    const result = createCategorySchema.safeParse({
      kind: "despesa",
      name: "a".repeat(60),
    });
    expect(result.success).toBe(true);
  });
});

describe("renameCategorySchema", () => {
  it("aceita id e novo nome válidos", () => {
    const result = renameCategorySchema.safeParse({
      id: "abc-123",
      name: "Novo nome",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ id: "abc-123", name: "Novo nome" });
    }
  });

  it("remove espaços em volta do nome (trim)", () => {
    const result = renameCategorySchema.safeParse({
      id: "abc-123",
      name: "  Água/Gelo  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Água/Gelo");
    }
  });

  it("rejeita id vazio", () => {
    const result = renameCategorySchema.safeParse({ id: "  ", name: "Nome" });
    expect(result.success).toBe(false);
  });

  it("rejeita nome vazio", () => {
    const result = renameCategorySchema.safeParse({ id: "abc-123", name: "" });
    expect(result.success).toBe(false);
  });

  it("rejeita nome acima de 60 caracteres", () => {
    const result = renameCategorySchema.safeParse({
      id: "abc-123",
      name: "a".repeat(61),
    });
    expect(result.success).toBe(false);
  });
});
