import { describe, expect, it } from "vitest";

import {
  DAY_OF_MONTH_MAX,
  DAY_OF_MONTH_MIN,
  emptyRecurringFormValues,
  recurringSchema,
  rowToForm,
  type RecurringRow,
} from "./recurring";

/**
 * Testes do schema de validação de Despesas Recorrentes (Req 4.1, 4.4).
 *
 * Cobre o núcleo funcional: conversão de valor para centavos, rejeição de
 * valores ≤ 0, intervalo do dia do mês (1..28), campos obrigatórios e o
 * tratamento do indicador ativa/inativa. A geração automática e a idempotência
 * (last_generated_period) vivem no cron (tarefa 7.2) e não são cobertas aqui.
 */

const baseInput = {
  amountCents: "250,00",
  categoryId: "cat-1",
  description: "Aluguel mensal da quadra",
  dayOfMonth: "10",
  isActive: "on",
};

describe("recurringSchema — valor (Req 4.1)", () => {
  it("converte string pt-BR para centavos", () => {
    const result = recurringSchema.safeParse({
      ...baseInput,
      amountCents: "1.234,56",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amountCents).toBe(123456);
    }
  });

  it("aceita valor inteiro sem casas decimais", () => {
    const result = recurringSchema.safeParse({ ...baseInput, amountCents: "250" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amountCents).toBe(25000);
    }
  });

  it("rejeita valor igual a zero", () => {
    const result = recurringSchema.safeParse({ ...baseInput, amountCents: "0" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("maior que zero");
    }
  });

  it("rejeita valor negativo", () => {
    const result = recurringSchema.safeParse({
      ...baseInput,
      amountCents: "-10,00",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("maior que zero");
    }
  });

  it("rejeita valor vazio", () => {
    const result = recurringSchema.safeParse({ ...baseInput, amountCents: "" });
    expect(result.success).toBe(false);
  });

  it("rejeita valor não numérico", () => {
    const result = recurringSchema.safeParse({ ...baseInput, amountCents: "abc" });
    expect(result.success).toBe(false);
  });
});

describe("recurringSchema — dia do mês (Req 4.1)", () => {
  it("aceita o limite inferior (1)", () => {
    const result = recurringSchema.safeParse({ ...baseInput, dayOfMonth: "1" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dayOfMonth).toBe(DAY_OF_MONTH_MIN);
    }
  });

  it("aceita o limite superior (28)", () => {
    const result = recurringSchema.safeParse({ ...baseInput, dayOfMonth: "28" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dayOfMonth).toBe(DAY_OF_MONTH_MAX);
    }
  });

  it("rejeita dia 0 (abaixo do intervalo)", () => {
    const result = recurringSchema.safeParse({ ...baseInput, dayOfMonth: "0" });
    expect(result.success).toBe(false);
  });

  it("rejeita dia 29 (acima do intervalo)", () => {
    const result = recurringSchema.safeParse({ ...baseInput, dayOfMonth: "29" });
    expect(result.success).toBe(false);
  });

  it("rejeita dia 31 (acima do intervalo, evita meses curtos)", () => {
    const result = recurringSchema.safeParse({ ...baseInput, dayOfMonth: "31" });
    expect(result.success).toBe(false);
  });

  it("rejeita dia fracionário", () => {
    const result = recurringSchema.safeParse({ ...baseInput, dayOfMonth: "10.5" });
    expect(result.success).toBe(false);
  });

  it("rejeita dia não numérico", () => {
    const result = recurringSchema.safeParse({ ...baseInput, dayOfMonth: "xyz" });
    expect(result.success).toBe(false);
  });
});

describe("recurringSchema — campos obrigatórios", () => {
  it("rejeita categoria vazia", () => {
    const result = recurringSchema.safeParse({ ...baseInput, categoryId: "" });
    expect(result.success).toBe(false);
  });

  it("rejeita descrição vazia", () => {
    const result = recurringSchema.safeParse({ ...baseInput, description: "   " });
    expect(result.success).toBe(false);
  });
});

describe("recurringSchema — ativa/inativa (Req 4.4)", () => {
  it('interpreta "on" como ativa', () => {
    const result = recurringSchema.safeParse({ ...baseInput, isActive: "on" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isActive).toBe(true);
    }
  });

  it("interpreta ausência do campo como inativa", () => {
    const { isActive: _omit, ...withoutActive } = baseInput;
    void _omit;
    const result = recurringSchema.safeParse(withoutActive);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isActive).toBe(false);
    }
  });

  it("aceita boolean diretamente", () => {
    const result = recurringSchema.safeParse({ ...baseInput, isActive: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isActive).toBe(true);
    }
  });
});

describe("rowToForm", () => {
  it("converte a linha do banco em valores de formulário", () => {
    const row: RecurringRow = {
      id: "r-1",
      amount_cents: 25000,
      category_id: "cat-1",
      description: "Aluguel da quadra",
      day_of_month: 10,
      is_active: true,
      last_generated_period: "2024-05",
    };
    expect(rowToForm(row)).toEqual({
      amountCents: "250,00",
      categoryId: "cat-1",
      description: "Aluguel da quadra",
      dayOfMonth: "10",
      isActive: true,
    });
  });

  it("não expõe last_generated_period no formulário (gerido pelo cron)", () => {
    const row: RecurringRow = {
      id: "r-2",
      amount_cents: 10000,
      category_id: "cat-2",
      description: "Bolas",
      day_of_month: 5,
      is_active: false,
      last_generated_period: "2024-01",
    };
    const form = rowToForm(row);
    expect(form).not.toHaveProperty("lastGeneratedPeriod");
    expect(form).not.toHaveProperty("last_generated_period");
    expect(form.isActive).toBe(false);
  });
});

describe("emptyRecurringFormValues", () => {
  it("nasce ativa, com dia 1 e campos em branco", () => {
    const values = emptyRecurringFormValues();
    expect(values.amountCents).toBe("");
    expect(values.categoryId).toBe("");
    expect(values.description).toBe("");
    expect(values.dayOfMonth).toBe("1");
    expect(values.isActive).toBe(true);
  });
});
