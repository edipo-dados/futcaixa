import { describe, expect, it } from "vitest";

import {
  settingsRowToFormValues,
  settingsSchema,
  type SettingsRow,
} from "./settings";

/**
 * Testes do schema Zod de Configurações.
 *
 * Cobrem: conversão de moeda pt-BR → centavos, validação de dias (1..28),
 * limites de texto (nome, Pix) e o conversor linha-do-banco → formulário.
 */

/** Payload base válido (strings, como vêm do formulário). */
function validInput(overrides: Record<string, unknown> = {}) {
  return {
    clubName: "Pelada do Sábado",
    logoPath: null,
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

describe("settingsSchema — conversão monetária", () => {
  it("converte string pt-BR com separadores para centavos", () => {
    const result = settingsSchema.parse(validInput());
    expect(result.defaultMonthlyCents).toBe(5000);
    expect(result.defaultDropInCents).toBe(1500);
    expect(result.initialBalanceCents).toBe(100000);
  });

  it("aceita string numérica simples sem separadores", () => {
    const result = settingsSchema.parse(
      validInput({ defaultMonthlyCents: "50" }),
    );
    expect(result.defaultMonthlyCents).toBe(5000);
  });

  it("trata string vazia como zero", () => {
    const result = settingsSchema.parse(
      validInput({ defaultDropInCents: "" }),
    );
    expect(result.defaultDropInCents).toBe(0);
  });

  it("remove o prefixo R$ e espaços", () => {
    const result = settingsSchema.parse(
      validInput({ initialBalanceCents: "R$ 1.234,56" }),
    );
    expect(result.initialBalanceCents).toBe(123456);
  });

  it("rejeita valor monetário inválido (texto)", () => {
    const result = settingsSchema.safeParse(
      validInput({ defaultMonthlyCents: "abc" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejeita valor monetário negativo", () => {
    const result = settingsSchema.safeParse(
      validInput({ defaultMonthlyCents: "-10,00" }),
    );
    expect(result.success).toBe(false);
  });
});

describe("settingsSchema — nome do clube", () => {
  it("exige nome do futebol", () => {
    const result = settingsSchema.safeParse(validInput({ clubName: "" }));
    expect(result.success).toBe(false);
  });

  it("faz trim do nome", () => {
    const result = settingsSchema.parse(
      validInput({ clubName: "  Time  " }),
    );
    expect(result.clubName).toBe("Time");
  });

  it("rejeita nome com mais de 100 caracteres", () => {
    const result = settingsSchema.safeParse(
      validInput({ clubName: "a".repeat(101) }),
    );
    expect(result.success).toBe(false);
  });
});

describe("settingsSchema — dias de vencimento e geração", () => {
  it("aceita dias dentro do intervalo 1..28", () => {
    const result = settingsSchema.parse(
      validInput({ dueDay: "28", generationDay: "1" }),
    );
    expect(result.dueDay).toBe(28);
    expect(result.generationDay).toBe(1);
  });

  it("rejeita dia maior que 28", () => {
    const result = settingsSchema.safeParse(validInput({ dueDay: "31" }));
    expect(result.success).toBe(false);
  });

  it("rejeita dia menor que 1", () => {
    const result = settingsSchema.safeParse(
      validInput({ generationDay: "0" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejeita dia não inteiro", () => {
    const result = settingsSchema.safeParse(validInput({ dueDay: "10,5" }));
    expect(result.success).toBe(false);
  });
});

describe("settingsSchema — limites dos campos Pix", () => {
  it("rejeita nome de recebedor com mais de 25 caracteres", () => {
    const result = settingsSchema.safeParse(
      validInput({ pixReceiverName: "a".repeat(26) }),
    );
    expect(result.success).toBe(false);
  });

  it("rejeita cidade com mais de 15 caracteres", () => {
    const result = settingsSchema.safeParse(
      validInput({ pixCity: "a".repeat(16) }),
    );
    expect(result.success).toBe(false);
  });

  it("aceita campos Pix vazios (configuração parcial)", () => {
    const result = settingsSchema.safeParse(
      validInput({ pixKey: "", pixReceiverName: "", pixCity: "" }),
    );
    expect(result.success).toBe(true);
  });
});

describe("settingsRowToFormValues", () => {
  const row: SettingsRow = {
    club_id: "11111111-1111-1111-1111-111111111111",
    club_name: "Pelada do Sábado",
    logo_path: "logos/logo.png",
    pix_key: "chave@pix.com",
    pix_receiver_name: "FUTEBOL FC",
    pix_city: "SAO PAULO",
    default_monthly_cents: 5000,
    default_drop_in_cents: 1500,
    due_day: 10,
    generation_day: 1,
    initial_balance_cents: 123456,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  };

  it("converte centavos para string decimal pt-BR", () => {
    const values = settingsRowToFormValues(row);
    expect(values.defaultMonthlyCents).toBe("50,00");
    expect(values.defaultDropInCents).toBe("15,00");
    expect(values.initialBalanceCents).toBe("1234,56");
  });

  it("exibe 0,00 para valor zero", () => {
    const values = settingsRowToFormValues({
      ...row,
      default_monthly_cents: 0,
    });
    expect(values.defaultMonthlyCents).toBe("0,00");
  });

  it("mapeia os campos de texto e dias corretamente", () => {
    const values = settingsRowToFormValues(row);
    expect(values.clubName).toBe("Pelada do Sábado");
    expect(values.logoPath).toBe("logos/logo.png");
    expect(values.pixKey).toBe("chave@pix.com");
    expect(values.dueDay).toBe("10");
    expect(values.generationDay).toBe("1");
  });

  it("roundtrip: form → schema preserva os centavos originais", () => {
    const values = settingsRowToFormValues(row);
    const parsed = settingsSchema.parse(values);
    expect(parsed.defaultMonthlyCents).toBe(row.default_monthly_cents);
    expect(parsed.initialBalanceCents).toBe(row.initial_balance_cents);
  });
});
