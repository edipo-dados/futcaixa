import { describe, expect, it } from "vitest";

import {
  CHARGE_KINDS,
  TXID_PATTERN,
  chargeSchema,
  emptyChargeFormValues,
  generateTxid,
  isValidPeriod,
} from "./charge";

/**
 * Testes do schema de validação de Cobranças avulsas manuais (Req 5.3, 5.8) e
 * do gerador de txid (Req 6.2).
 *
 * Cobre o núcleo funcional: valor > 0, enum de tipo, mensalidade exige período,
 * validade do vencimento, campos obrigatórios e o formato/variabilidade do
 * txid. Transições de status e pagamento vivem na tarefa 8.3.
 */

const baseInput = {
  playerId: "player-1",
  amountCents: "25,00",
  description: "Avulso do jogo de sábado",
  kind: "avulso" as const,
  dueDate: "2024-06-10",
  period: "",
};

// ─── Valor (Req 5.3) ─────────────────────────────────────────────────────────

describe("chargeSchema — valor (Req 5.3)", () => {
  it("converte string pt-BR para centavos", () => {
    const result = chargeSchema.safeParse({
      ...baseInput,
      amountCents: "1.234,56",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amountCents).toBe(123456);
    }
  });

  it("aceita valor inteiro sem casas decimais", () => {
    const result = chargeSchema.safeParse({ ...baseInput, amountCents: "40" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amountCents).toBe(4000);
    }
  });

  it("rejeita valor igual a zero", () => {
    const result = chargeSchema.safeParse({ ...baseInput, amountCents: "0" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("maior que zero");
    }
  });

  it("rejeita valor negativo", () => {
    const result = chargeSchema.safeParse({
      ...baseInput,
      amountCents: "-10,00",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("maior que zero");
    }
  });

  it("rejeita valor vazio", () => {
    const result = chargeSchema.safeParse({ ...baseInput, amountCents: "" });
    expect(result.success).toBe(false);
  });

  it("rejeita valor não numérico", () => {
    const result = chargeSchema.safeParse({ ...baseInput, amountCents: "abc" });
    expect(result.success).toBe(false);
  });
});

// ─── Tipo (enum, Req 5.3) ─────────────────────────────────────────────────────

describe("chargeSchema — tipo (Req 5.3)", () => {
  it.each(CHARGE_KINDS)("aceita o tipo válido %s", (kind) => {
    const input =
      kind === "mensalidade"
        ? { ...baseInput, kind, period: "2024-06" }
        : { ...baseInput, kind };
    const result = chargeSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe(kind);
    }
  });

  it("rejeita tipo fora do enum", () => {
    const result = chargeSchema.safeParse({ ...baseInput, kind: "doacao" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("inválido");
    }
  });
});

// ─── Mensalidade exige período (Req 5.2) ──────────────────────────────────────

describe("chargeSchema — período da mensalidade (Req 5.2)", () => {
  it("mensalidade com período válido passa", () => {
    const result = chargeSchema.safeParse({
      ...baseInput,
      kind: "mensalidade",
      period: "2024-06",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.period).toBe("2024-06");
    }
  });

  it("mensalidade sem período é rejeitada", () => {
    const result = chargeSchema.safeParse({
      ...baseInput,
      kind: "mensalidade",
      period: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "period");
      expect(issue?.message).toContain("período");
    }
  });

  it("mensalidade com período malformado é rejeitada", () => {
    const result = chargeSchema.safeParse({
      ...baseInput,
      kind: "mensalidade",
      period: "2024/06",
    });
    expect(result.success).toBe(false);
  });

  it("mensalidade com mês inválido (13) é rejeitada", () => {
    const result = chargeSchema.safeParse({
      ...baseInput,
      kind: "mensalidade",
      period: "2024-13",
    });
    expect(result.success).toBe(false);
  });

  it("avulso não exige período (vazio vira undefined)", () => {
    const result = chargeSchema.safeParse({ ...baseInput, kind: "avulso" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.period).toBeUndefined();
    }
  });

  it("tipo não-mensalidade com período inválido é rejeitado", () => {
    const result = chargeSchema.safeParse({
      ...baseInput,
      kind: "multa",
      period: "junho",
    });
    expect(result.success).toBe(false);
  });
});

// ─── Vencimento (data válida, Req 5.3/5.8) ────────────────────────────────────

describe("chargeSchema — vencimento (Req 5.3/5.8)", () => {
  it("aceita data civil válida", () => {
    const result = chargeSchema.safeParse({
      ...baseInput,
      dueDate: "2024-02-29",
    });
    expect(result.success).toBe(true);
  });

  it("rejeita data impossível (31/02)", () => {
    const result = chargeSchema.safeParse({
      ...baseInput,
      dueDate: "2024-02-31",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "dueDate");
      expect(issue?.message).toContain("inválida");
    }
  });

  it("rejeita formato não ISO", () => {
    const result = chargeSchema.safeParse({
      ...baseInput,
      dueDate: "10/06/2024",
    });
    expect(result.success).toBe(false);
  });

  it("rejeita vencimento vazio", () => {
    const result = chargeSchema.safeParse({ ...baseInput, dueDate: "" });
    expect(result.success).toBe(false);
  });
});

// ─── Campos obrigatórios ──────────────────────────────────────────────────────

describe("chargeSchema — campos obrigatórios (Req 5.3)", () => {
  it("rejeita jogador vazio", () => {
    const result = chargeSchema.safeParse({ ...baseInput, playerId: "" });
    expect(result.success).toBe(false);
  });

  it("rejeita descrição vazia", () => {
    const result = chargeSchema.safeParse({ ...baseInput, description: "   " });
    expect(result.success).toBe(false);
  });
});

// ─── isValidPeriod ────────────────────────────────────────────────────────────

describe("isValidPeriod", () => {
  it("aceita AAAA-MM válido", () => {
    expect(isValidPeriod("2024-01")).toBe(true);
    expect(isValidPeriod("2024-12")).toBe(true);
  });

  it("rejeita mês fora de 01..12", () => {
    expect(isValidPeriod("2024-00")).toBe(false);
    expect(isValidPeriod("2024-13")).toBe(false);
  });

  it("rejeita formatos errados", () => {
    expect(isValidPeriod("2024-6")).toBe(false);
    expect(isValidPeriod("2024/06")).toBe(false);
    expect(isValidPeriod("06-2024")).toBe(false);
    expect(isValidPeriod("")).toBe(false);
  });
});

// ─── generateTxid (Req 6.2) ───────────────────────────────────────────────────

describe("generateTxid (Req 6.2)", () => {
  it("gera txid alfanumérico com no máximo 25 caracteres", () => {
    const txid = generateTxid();
    expect(txid).toMatch(TXID_PATTERN);
    expect(txid.length).toBeLessThanOrEqual(25);
    expect(txid.length).toBeGreaterThan(0);
  });

  it("é URL-safe (sem símbolos reservados)", () => {
    const txid = generateTxid();
    expect(encodeURIComponent(txid)).toBe(txid);
  });

  it("produz valores distintos entre chamadas (unicidade prática)", () => {
    const count = 1000;
    const set = new Set<string>();
    for (let i = 0; i < count; i += 1) {
      set.add(generateTxid());
    }
    expect(set.size).toBe(count);
  });
});

// ─── emptyChargeFormValues ────────────────────────────────────────────────────

describe("emptyChargeFormValues", () => {
  it("nasce como avulso e com campos em branco", () => {
    const values = emptyChargeFormValues();
    expect(values.playerId).toBe("");
    expect(values.amountCents).toBe("");
    expect(values.description).toBe("");
    expect(values.kind).toBe("avulso");
    expect(values.dueDate).toBe("");
    expect(values.period).toBe("");
  });

  it("aplica o vencimento e período padrão informados", () => {
    const values = emptyChargeFormValues("2024-06-10", "2024-06");
    expect(values.dueDate).toBe("2024-06-10");
    expect(values.period).toBe("2024-06");
  });
});
