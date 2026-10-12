import { describe, expect, it } from "vitest";

import {
  emptyPlayerFormValues,
  playerRowToFormValues,
  playerSchema,
  type PlayerRow,
} from "./player";

/**
 * Testes do schema Zod de Jogadores (Requisitos 2.1–2.5).
 *
 * Cobrem: validação de e-mail, isento exige motivo, intervalo do nível
 * técnico, conversão de valores personalizados (string pt-BR → centavos/null),
 * validação de telefone BR e o conversor linha-do-banco → formulário.
 */

/** Payload base válido (strings/booleano, como vêm do formulário). */
function validInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "João da Silva",
    nickname: "Jô",
    email: "joao@email.com",
    phone: "(11) 90000-0000",
    type: "mensalista",
    status: "ativo",
    skillLevel: "2",
    isExempt: false,
    exemptReason: "",
    customMonthlyCents: "",
    customDropInCents: "",
    ...overrides,
  };
}

describe("playerSchema — nome", () => {
  it("exige o nome", () => {
    expect(playerSchema.safeParse(validInput({ name: "" })).success).toBe(
      false,
    );
  });

  it("faz trim do nome", () => {
    const result = playerSchema.parse(validInput({ name: "  Pedro  " }));
    expect(result.name).toBe("Pedro");
  });
});

describe("playerSchema — validação de e-mail (Req 2.5)", () => {
  it("aceita e-mail válido e normaliza para minúsculas", () => {
    const result = playerSchema.parse(validInput({ email: "JOAO@Email.COM" }));
    expect(result.email).toBe("joao@email.com");
  });

  it("aceita e-mail ausente (campo opcional) como null", () => {
    const result = playerSchema.parse(validInput({ email: "" }));
    expect(result.email).toBeNull();
  });

  it("rejeita e-mail com formato inválido", () => {
    expect(
      playerSchema.safeParse(validInput({ email: "nao-eh-email" })).success,
    ).toBe(false);
  });

  it("rejeita e-mail sem domínio", () => {
    expect(
      playerSchema.safeParse(validInput({ email: "joao@" })).success,
    ).toBe(false);
  });
});

describe("playerSchema — validação de telefone (Req 2.5)", () => {
  it("aceita telefone fixo com DDD (10 dígitos)", () => {
    const result = playerSchema.parse(validInput({ phone: "(11) 3000-0000" }));
    expect(result.phone).toBe("(11) 3000-0000");
  });

  it("aceita celular com DDD (11 dígitos)", () => {
    const result = playerSchema.parse(validInput({ phone: "11999998888" }));
    expect(result.phone).toBe("11999998888");
  });

  it("aceita telefone ausente como null", () => {
    const result = playerSchema.parse(validInput({ phone: "" }));
    expect(result.phone).toBeNull();
  });

  it("rejeita telefone com poucos dígitos", () => {
    expect(
      playerSchema.safeParse(validInput({ phone: "99999" })).success,
    ).toBe(false);
  });

  it("rejeita telefone com dígitos demais", () => {
    expect(
      playerSchema.safeParse(validInput({ phone: "119999988887" })).success,
    ).toBe(false);
  });

  it("rejeita telefone com caracteres não permitidos", () => {
    expect(
      playerSchema.safeParse(validInput({ phone: "11 9999-abcd" })).success,
    ).toBe(false);
  });
});

describe("playerSchema — isento exige motivo (Req 2.2)", () => {
  it("rejeita isento sem motivo", () => {
    const result = playerSchema.safeParse(
      validInput({ isExempt: true, exemptReason: "" }),
    );
    expect(result.success).toBe(false);
  });

  it("aponta o erro no campo exemptReason", () => {
    const result = playerSchema.safeParse(
      validInput({ isExempt: true, exemptReason: "   " }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain("exemptReason");
    }
  });

  it("aceita isento com motivo", () => {
    const result = playerSchema.parse(
      validInput({ isExempt: true, exemptReason: "goleiro" }),
    );
    expect(result.isExempt).toBe(true);
    expect(result.exemptReason).toBe("goleiro");
  });

  it("aceita não isento sem motivo (motivo vira null)", () => {
    const result = playerSchema.parse(
      validInput({ isExempt: false, exemptReason: "" }),
    );
    expect(result.isExempt).toBe(false);
    expect(result.exemptReason).toBeNull();
  });
});

describe("playerSchema — nível técnico 1..3 (Req 2.1)", () => {
  it("aceita níveis dentro do intervalo", () => {
    for (const lvl of ["1", "2", "3"]) {
      const result = playerSchema.parse(validInput({ skillLevel: lvl }));
      expect(result.skillLevel).toBe(Number(lvl));
    }
  });

  it("rejeita nível 0", () => {
    expect(
      playerSchema.safeParse(validInput({ skillLevel: "0" })).success,
    ).toBe(false);
  });

  it("rejeita nível 4", () => {
    expect(
      playerSchema.safeParse(validInput({ skillLevel: "4" })).success,
    ).toBe(false);
  });

  it("rejeita nível não inteiro", () => {
    expect(
      playerSchema.safeParse(validInput({ skillLevel: "2.5" })).success,
    ).toBe(false);
  });
});

describe("playerSchema — tipo e status", () => {
  it("aceita todos os tipos válidos", () => {
    for (const type of ["mensalista", "avulso", "convidado"]) {
      expect(playerSchema.safeParse(validInput({ type })).success).toBe(true);
    }
  });

  it("rejeita tipo inválido", () => {
    expect(
      playerSchema.safeParse(validInput({ type: "visitante" })).success,
    ).toBe(false);
  });

  it("rejeita status inválido", () => {
    expect(
      playerSchema.safeParse(validInput({ status: "suspenso" })).success,
    ).toBe(false);
  });
});

describe("playerSchema — valores personalizados (Req 2.3/2.4)", () => {
  it("converte valor personalizado pt-BR para centavos", () => {
    const result = playerSchema.parse(
      validInput({ customMonthlyCents: "50,00", customDropInCents: "15" }),
    );
    expect(result.customMonthlyCents).toBe(5000);
    expect(result.customDropInCents).toBe(1500);
  });

  it("trata milhar com ponto e decimal com vírgula", () => {
    const result = playerSchema.parse(
      validInput({ customMonthlyCents: "1.234,56" }),
    );
    expect(result.customMonthlyCents).toBe(123456);
  });

  it("remove prefixo R$ e espaços", () => {
    const result = playerSchema.parse(
      validInput({ customDropInCents: "R$ 20,00" }),
    );
    expect(result.customDropInCents).toBe(2000);
  });

  it("campo vazio vira null (usa padrão das Configurações)", () => {
    const result = playerSchema.parse(
      validInput({ customMonthlyCents: "", customDropInCents: "" }),
    );
    expect(result.customMonthlyCents).toBeNull();
    expect(result.customDropInCents).toBeNull();
  });

  it("rejeita valor personalizado inválido", () => {
    expect(
      playerSchema.safeParse(validInput({ customMonthlyCents: "abc" }))
        .success,
    ).toBe(false);
  });

  it("rejeita valor personalizado negativo", () => {
    expect(
      playerSchema.safeParse(validInput({ customDropInCents: "-10,00" }))
        .success,
    ).toBe(false);
  });
});

describe("playerSchema — apelido", () => {
  it("apelido vazio vira null", () => {
    const result = playerSchema.parse(validInput({ nickname: "" }));
    expect(result.nickname).toBeNull();
  });

  it("faz trim do apelido", () => {
    const result = playerSchema.parse(validInput({ nickname: "  Jô  " }));
    expect(result.nickname).toBe("Jô");
  });
});

describe("playerSchema — campos opcionais como null (regressão)", () => {
  // O `readFormData` da Server Action usa `formData.get(...)`, que devolve
  // `null` quando o campo não está no DOM (ex.: `exemptReason` com a checkbox
  // de isenção desmarcada; `email`/`phone`/`nickname` quando ausentes). O
  // schema PRECISA aceitar `null` nesses opcionais — do contrário a validação
  // falhava e o cadastro era rejeitado silenciosamente (erro em campo oculto).
  it("aceita exemptReason null quando não isento (bug do cadastro silencioso)", () => {
    const result = playerSchema.safeParse(
      validInput({ isExempt: false, exemptReason: null }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.exemptReason).toBeNull();
    }
  });

  it("aceita nickname, email e phone como null (campos ausentes no form)", () => {
    const result = playerSchema.safeParse(
      validInput({ nickname: null, email: null, phone: null }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nickname).toBeNull();
      expect(result.data.email).toBeNull();
      expect(result.data.phone).toBeNull();
    }
  });

  it("valida o payload exato produzido por readFormData (não isento)", () => {
    // Espelha o objeto que a Server Action monta a partir do FormData.
    const fromFormData = {
      name: "Juliana",
      nickname: "",
      email: "",
      phone: "",
      type: "mensalista",
      status: "ativo",
      skillLevel: "2",
      isExempt: false,
      exemptReason: null,
      customMonthlyCents: "",
      customDropInCents: "",
    };
    const result = playerSchema.safeParse(fromFormData);
    expect(result.success).toBe(true);
  });
});

describe("playerRowToFormValues", () => {
  const row: PlayerRow = {
    id: "uuid-1",
    name: "João da Silva",
    nickname: "Jô",
    email: "joao@email.com",
    phone: "11999998888",
    company: "Vivo",
    type: "mensalista",
    status: "ativo",
    skill_level: 2,
    is_exempt: true,
    exempt_reason: "goleiro",
    custom_monthly_cents: 5000,
    custom_drop_in_cents: null,
    deleted_at: null,
  };

  it("mapeia os campos da linha do banco para o formulário", () => {
    const values = playerRowToFormValues(row);
    expect(values.name).toBe("João da Silva");
    expect(values.nickname).toBe("Jô");
    expect(values.email).toBe("joao@email.com");
    expect(values.phone).toBe("11999998888");
    expect(values.type).toBe("mensalista");
    expect(values.status).toBe("ativo");
    expect(values.skillLevel).toBe("2");
    expect(values.isExempt).toBe(true);
    expect(values.exemptReason).toBe("goleiro");
  });

  it("converte centavos personalizados para string pt-BR e null para vazio", () => {
    const values = playerRowToFormValues(row);
    expect(values.customMonthlyCents).toBe("50,00");
    expect(values.customDropInCents).toBe("");
  });

  it("converte campos nulos (apelido/e-mail/telefone) para string vazia", () => {
    const values = playerRowToFormValues({
      ...row,
      nickname: null,
      email: null,
      phone: null,
      exempt_reason: null,
      is_exempt: false,
    });
    expect(values.nickname).toBe("");
    expect(values.email).toBe("");
    expect(values.phone).toBe("");
    expect(values.exemptReason).toBe("");
  });

  it("roundtrip: form → schema preserva o valor personalizado", () => {
    const values = playerRowToFormValues(row);
    const parsed = playerSchema.parse(values);
    expect(parsed.customMonthlyCents).toBe(row.custom_monthly_cents);
    expect(parsed.customDropInCents).toBeNull();
  });
});

describe("emptyPlayerFormValues", () => {
  it("produz valores em branco válidos para criação", () => {
    const values = emptyPlayerFormValues();
    const result = playerSchema.safeParse({ ...values, name: "Teste" });
    expect(result.success).toBe(true);
  });

  it("usa padrões sensatos (mensalista/ativo/nível 2/não isento)", () => {
    const values = emptyPlayerFormValues();
    expect(values.type).toBe("mensalista");
    expect(values.status).toBe("ativo");
    expect(values.skillLevel).toBe("2");
    expect(values.isExempt).toBe(false);
  });
});
