import { describe, expect, it } from "vitest";

import {
  createClubSchema,
  monetaryStringToCents,
  toCreateClubRpcArgs,
} from "./club";

/**
 * Testes do schema Zod de criação de futebol (tarefa 20.1).
 *
 * Cobrem: conversão de moeda pt-BR → centavos, defaults coerentes com a tabela
 * `settings`, validação de nome/dias/limites de texto e o mapeamento para os
 * argumentos (`p_*`) da RPC `create_club`.
 */

/** Payload base válido (strings, como viriam do formulário). */
function validInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Pelada do Sábado",
    pixKey: "chave@pix.com",
    pixReceiverName: "FUTEBOL FC",
    pixCity: "SAO PAULO",
    defaultMonthlyCents: "50,00",
    defaultDropInCents: "15,00",
    dueDay: "10",
    generationDay: "1",
    initialBalanceCents: "1.000,00",
    ...overrides,
  };
}

describe("monetaryStringToCents", () => {
  it("converte string pt-BR com milhar e decimal", () => {
    expect(monetaryStringToCents("1.500,00")).toBe(150000);
    expect(monetaryStringToCents("50,00")).toBe(5000);
    expect(monetaryStringToCents("R$ 100")).toBe(10000);
  });

  it("trata string vazia como zero", () => {
    expect(monetaryStringToCents("")).toBe(0);
  });

  it("retorna NaN para valores inválidos ou negativos", () => {
    expect(Number.isNaN(monetaryStringToCents("abc"))).toBe(true);
    expect(Number.isNaN(monetaryStringToCents("-5"))).toBe(true);
  });
});

describe("createClubSchema", () => {
  it("valida e converte um payload completo", () => {
    const result = createClubSchema.parse(validInput());
    expect(result.name).toBe("Pelada do Sábado");
    expect(result.defaultMonthlyCents).toBe(5000);
    expect(result.defaultDropInCents).toBe(1500);
    expect(result.initialBalanceCents).toBe(100000);
    expect(result.dueDay).toBe(10);
    expect(result.generationDay).toBe(1);
  });

  it("aplica defaults quando campos opcionais são omitidos", () => {
    const result = createClubSchema.parse({ name: "Só o nome" });
    expect(result.pixKey).toBe("");
    expect(result.pixReceiverName).toBe("");
    expect(result.pixCity).toBe("");
    expect(result.defaultMonthlyCents).toBe(0);
    expect(result.defaultDropInCents).toBe(0);
    expect(result.initialBalanceCents).toBe(0);
    expect(result.dueDay).toBe(10);
    expect(result.generationDay).toBe(1);
    expect(result.logoPath).toBeUndefined();
  });

  it("exige o nome do futebol", () => {
    const result = createClubSchema.safeParse(validInput({ name: "   " }));
    expect(result.success).toBe(false);
  });

  it("rejeita dia de vencimento fora de 1..28", () => {
    expect(createClubSchema.safeParse(validInput({ dueDay: "0" })).success).toBe(
      false,
    );
    expect(
      createClubSchema.safeParse(validInput({ dueDay: "31" })).success,
    ).toBe(false);
  });

  it("rejeita chave Pix acima de 77 caracteres", () => {
    const result = createClubSchema.safeParse(
      validInput({ pixKey: "x".repeat(78) }),
    );
    expect(result.success).toBe(false);
  });

  it("rejeita valor monetário negativo", () => {
    const result = createClubSchema.safeParse(
      validInput({ initialBalanceCents: "-10,00" }),
    );
    expect(result.success).toBe(false);
  });
});

describe("toCreateClubRpcArgs", () => {
  it("mapeia a saída validada para os argumentos p_* da RPC", () => {
    const input = createClubSchema.parse(validInput({ logoPath: "logos/x.png" }));
    const args = toCreateClubRpcArgs(input);
    expect(args).toEqual({
      p_name: "Pelada do Sábado",
      p_pix_key: "chave@pix.com",
      p_pix_receiver_name: "FUTEBOL FC",
      p_pix_city: "SAO PAULO",
      p_default_monthly_cents: 5000,
      p_default_drop_in_cents: 1500,
      p_due_day: 10,
      p_generation_day: 1,
      p_initial_balance_cents: 100000,
      p_logo_path: "logos/x.png",
    });
  });

  it("usa null para logo ausente", () => {
    const input = createClubSchema.parse(validInput());
    const args = toCreateClubRpcArgs(input);
    expect(args.p_logo_path).toBeNull();
  });
});
