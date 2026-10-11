import { describe, expect, it } from "vitest";

import {
  APPROVAL_PLAYER_TYPES,
  canManageMembers,
  messageForReason,
  parseApprovalPlayerType,
  reasonFromPgCode,
} from "./approveMember";

/**
 * Testes da lógica pura de aprovação/recusa de membros (tarefa 20.3).
 *
 * Cobrem o guard de presidente (Req 4.8), a validação do tipo de jogador
 * (Req 4.6) e o mapeamento de códigos de erro da RPC → mensagem (Req 4.8).
 */

describe("parseApprovalPlayerType", () => {
  it("aceita os tipos aprováveis (mensalista/avulso)", () => {
    for (const tipo of APPROVAL_PLAYER_TYPES) {
      expect(parseApprovalPlayerType(tipo)).toBe(tipo);
    }
  });

  it("normaliza espaços ao redor", () => {
    expect(parseApprovalPlayerType("  mensalista  ")).toBe("mensalista");
  });

  it("rejeita 'convidado' (não é opção de aprovação)", () => {
    expect(parseApprovalPlayerType("convidado")).toBeNull();
  });

  it("rejeita valores inválidos ou não-string", () => {
    expect(parseApprovalPlayerType("")).toBeNull();
    expect(parseApprovalPlayerType("qualquer")).toBeNull();
    expect(parseApprovalPlayerType(null)).toBeNull();
    expect(parseApprovalPlayerType(undefined)).toBeNull();
    expect(parseApprovalPlayerType(123)).toBeNull();
  });
});

describe("canManageMembers", () => {
  it("permite apenas o presidente (Req 4.8)", () => {
    expect(canManageMembers("presidente")).toBe(true);
  });

  it("nega tesoureiro, jogador e estado sem clube", () => {
    expect(canManageMembers("tesoureiro")).toBe(false);
    expect(canManageMembers("jogador")).toBe(false);
    expect(canManageMembers(null)).toBe(false);
    expect(canManageMembers(undefined)).toBe(false);
  });
});

describe("reasonFromPgCode / messageForReason", () => {
  it("mapeia os SQLSTATE conhecidos da RPC", () => {
    expect(reasonFromPgCode("28000")).toBe("unauthenticated");
    expect(reasonFromPgCode("42501")).toBe("not_president");
    expect(reasonFromPgCode("22023")).toBe("invalid_type");
    expect(reasonFromPgCode("23505")).toBe("already_linked");
    expect(reasonFromPgCode("P0002")).toBe("not_found");
  });

  it("cai em 'unknown' para código ausente ou desconhecido", () => {
    expect(reasonFromPgCode(null)).toBe("unknown");
    expect(reasonFromPgCode(undefined)).toBe("unknown");
    expect(reasonFromPgCode("99999")).toBe("unknown");
  });

  it("devolve uma mensagem pt-BR não vazia para cada classe", () => {
    for (const code of ["28000", "42501", "22023", "23505", "P0002", "99999"]) {
      const reason = reasonFromPgCode(code);
      expect(messageForReason(reason).length).toBeGreaterThan(0);
    }
  });
});
