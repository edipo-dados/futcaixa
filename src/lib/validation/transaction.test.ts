import { describe, expect, it } from "vitest";

import {
  TRANSACTION_KINDS,
  emptyTransactionFormValues,
  rowToForm,
  transactionSchema,
  type TransactionRow,
} from "./transaction";

/**
 * Testes do schema de validação de Lançamentos (Req 3.1, 3.10).
 *
 * Cobre o núcleo funcional: conversão de valor para centavos, rejeição de
 * valores ≤ 0 (Req 3.10), validação de data civil, campos obrigatórios e o
 * tratamento do jogador opcional. As regras de upload/soft delete vivem na
 * Server Action (dependem do banco/Storage) e não são cobertas aqui.
 */

const baseInput = {
  kind: "despesa",
  amountCents: "25,00",
  occurredOn: "2024-05-10",
  categoryId: "cat-1",
  description: "Aluguel da quadra",
  playerId: "",
};

describe("TRANSACTION_KINDS", () => {
  it("contém exatamente receita e despesa", () => {
    expect([...TRANSACTION_KINDS]).toEqual(["receita", "despesa"]);
  });
});

describe("transactionSchema — valor (Req 3.1, 3.10)", () => {
  it("converte string pt-BR para centavos", () => {
    const result = transactionSchema.safeParse({
      ...baseInput,
      amountCents: "1.234,56",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amountCents).toBe(123456);
    }
  });

  it("aceita valor inteiro sem casas decimais", () => {
    const result = transactionSchema.safeParse({
      ...baseInput,
      amountCents: "25",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amountCents).toBe(2500);
    }
  });

  it("rejeita valor igual a zero (Req 3.10)", () => {
    const result = transactionSchema.safeParse({
      ...baseInput,
      amountCents: "0",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("maior que zero");
    }
  });

  it("rejeita valor negativo (Req 3.10)", () => {
    const result = transactionSchema.safeParse({
      ...baseInput,
      amountCents: "-10,00",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("maior que zero");
    }
  });

  it("rejeita valor vazio", () => {
    const result = transactionSchema.safeParse({
      ...baseInput,
      amountCents: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejeita valor não numérico", () => {
    const result = transactionSchema.safeParse({
      ...baseInput,
      amountCents: "abc",
    });
    expect(result.success).toBe(false);
  });
});

describe("transactionSchema — data (Req 3.1)", () => {
  it("aceita data civil válida (YYYY-MM-DD)", () => {
    const result = transactionSchema.safeParse(baseInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.occurredOn).toBe("2024-05-10");
    }
  });

  it("rejeita data inexistente (ex.: 31/02)", () => {
    const result = transactionSchema.safeParse({
      ...baseInput,
      occurredOn: "2024-02-31",
    });
    expect(result.success).toBe(false);
  });

  it("rejeita formato de data inválido", () => {
    const result = transactionSchema.safeParse({
      ...baseInput,
      occurredOn: "10/05/2024",
    });
    expect(result.success).toBe(false);
  });
});

describe("transactionSchema — campos obrigatórios e opcionais", () => {
  it("rejeita tipo inválido", () => {
    const result = transactionSchema.safeParse({ ...baseInput, kind: "x" });
    expect(result.success).toBe(false);
  });

  it("rejeita categoria vazia", () => {
    const result = transactionSchema.safeParse({
      ...baseInput,
      categoryId: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejeita descrição vazia", () => {
    const result = transactionSchema.safeParse({
      ...baseInput,
      description: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("normaliza jogador vazio para null (opcional)", () => {
    const result = transactionSchema.safeParse(baseInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.playerId).toBeNull();
    }
  });

  it("mantém o jogador quando informado", () => {
    const result = transactionSchema.safeParse({
      ...baseInput,
      playerId: "player-9",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.playerId).toBe("player-9");
    }
  });
});

describe("rowToForm", () => {
  it("converte a linha do banco em valores de formulário", () => {
    const row: TransactionRow = {
      id: "t-1",
      kind: "receita",
      amount_cents: 2550,
      occurred_on: "2024-05-10",
      category_id: "cat-1",
      description: "Mensalidade",
      player_id: "player-9",
      charge_id: null,
      proof_path: null,
      recurring_id: null,
      created_by: "profile-1",
      deleted_at: null,
    };
    expect(rowToForm(row)).toEqual({
      kind: "receita",
      amountCents: "25,50",
      occurredOn: "2024-05-10",
      categoryId: "cat-1",
      description: "Mensalidade",
      playerId: "player-9",
    });
  });

  it("converte player_id nulo em string vazia", () => {
    const row: TransactionRow = {
      id: "t-2",
      kind: "despesa",
      amount_cents: 10000,
      occurred_on: "2024-01-01",
      category_id: "cat-2",
      description: "Bolas",
      player_id: null,
      charge_id: null,
      proof_path: null,
      recurring_id: null,
      created_by: "profile-1",
      deleted_at: null,
    };
    expect(rowToForm(row).playerId).toBe("");
  });
});

describe("emptyTransactionFormValues", () => {
  it("usa despesa como tipo padrão e preenche a data de hoje", () => {
    const values = emptyTransactionFormValues();
    expect(values.kind).toBe("despesa");
    expect(values.amountCents).toBe("");
    expect(values.categoryId).toBe("");
    expect(values.occurredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("aceita um tipo padrão explícito (atalho de receita)", () => {
    expect(emptyTransactionFormValues("receita").kind).toBe("receita");
  });
});
