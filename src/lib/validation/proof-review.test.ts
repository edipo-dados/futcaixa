import { describe, expect, it } from "vitest";

import {
  PROOF_STATUS_LABELS,
  REJECT_REASON_MAX,
  validateRejectReason,
} from "./proof-review";

/**
 * Testes da validação de revisão de comprovante (tarefa 9.6, Req 6.6/6.7).
 *
 * Cobre o núcleo funcional do motivo de rejeição: obrigatório (fica
 * registrado na auditoria — Req 6.7), limite de tamanho e normalização
 * (trim). A integração com banco/Storage e as transições de status vivem nas
 * Server Actions e não são cobertas aqui.
 */
describe("validateRejectReason", () => {
  it("aceita um motivo válido e apara os espaços das bordas", () => {
    const result = validateRejectReason("  valor divergente  ");
    expect(result).toEqual({ ok: true, reason: "valor divergente" });
  });

  it("rejeita motivo vazio ou só espaços (obrigatório p/ auditoria)", () => {
    expect(validateRejectReason("")).toEqual({
      ok: false,
      error: "Informe o motivo da rejeição.",
    });
    expect(validateRejectReason("   ").ok).toBe(false);
  });

  it("rejeita valores que não são string", () => {
    expect(validateRejectReason(null).ok).toBe(false);
    expect(validateRejectReason(undefined).ok).toBe(false);
    expect(validateRejectReason(123).ok).toBe(false);
  });

  it("aceita exatamente no limite de tamanho", () => {
    const atLimit = "a".repeat(REJECT_REASON_MAX);
    expect(validateRejectReason(atLimit)).toEqual({
      ok: true,
      reason: atLimit,
    });
  });

  it("rejeita acima do limite de tamanho", () => {
    const tooLong = "a".repeat(REJECT_REASON_MAX + 1);
    const result = validateRejectReason(tooLong);
    expect(result).toEqual({
      ok: false,
      error: `O motivo deve ter no máximo ${REJECT_REASON_MAX} caracteres.`,
    });
  });
});

describe("PROOF_STATUS_LABELS", () => {
  it("tem rótulo pt-BR para cada status", () => {
    expect(PROOF_STATUS_LABELS.em_analise).toBe("Em análise");
    expect(PROOF_STATUS_LABELS.aprovado).toBe("Aprovado");
    expect(PROOF_STATUS_LABELS.rejeitado).toBe("Rejeitado");
  });
});
