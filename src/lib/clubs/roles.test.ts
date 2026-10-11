import { describe, expect, it } from "vitest";

import {
  countActivePresidents,
  isClubRole,
  isLastPresidentDemotion,
  type MemberRoleView,
  validateRoleChange,
} from "@/lib/clubs/roles";

/**
 * Testes das regras PURAS de papéis (tarefa 20.4).
 *
 * Foco crítico: a guarda do ÚLTIMO presidente (Req 5.5). Os cenários cobrem
 * o rebaixamento do último presidente (proibido), o caso em que há um segundo
 * presidente (permitido), e as bordas (membro inexistente, inativo, status
 * não-ativo, "troca" sem efeito).
 */

/** Monta rapidamente uma lista de membros para os testes. */
function members(
  rows: Array<Partial<MemberRoleView> & { membershipId: string }>,
): MemberRoleView[] {
  return rows.map((r) => ({
    membershipId: r.membershipId,
    role: r.role ?? "jogador",
    status: r.status ?? "ativo",
  }));
}

describe("isClubRole", () => {
  it("aceita os três papéis válidos", () => {
    expect(isClubRole("presidente")).toBe(true);
    expect(isClubRole("tesoureiro")).toBe(true);
    expect(isClubRole("jogador")).toBe(true);
  });

  it("rejeita valores inválidos", () => {
    expect(isClubRole("admin")).toBe(false);
    expect(isClubRole("")).toBe(false);
    expect(isClubRole(null)).toBe(false);
    expect(isClubRole(42)).toBe(false);
  });
});

describe("countActivePresidents", () => {
  it("conta apenas presidentes ATIVOS", () => {
    const list = members([
      { membershipId: "a", role: "presidente", status: "ativo" },
      { membershipId: "b", role: "presidente", status: "ativo" },
      { membershipId: "c", role: "presidente", status: "recusado" }, // não conta
      { membershipId: "d", role: "tesoureiro", status: "ativo" }, // não conta
      { membershipId: "e", role: "jogador", status: "pendente" }, // não conta
    ]);
    expect(countActivePresidents(list)).toBe(2);
  });

  it("retorna 0 em lista vazia", () => {
    expect(countActivePresidents([])).toBe(0);
  });
});

describe("isLastPresidentDemotion (guarda do último presidente — Req 5.5)", () => {
  it("bloqueia rebaixar o ÚNICO presidente ativo para tesoureiro", () => {
    const list = members([
      { membershipId: "pres", role: "presidente", status: "ativo" },
      { membershipId: "j1", role: "jogador", status: "ativo" },
    ]);
    expect(isLastPresidentDemotion(list, "pres", "tesoureiro")).toBe(true);
  });

  it("bloqueia rebaixar o ÚNICO presidente ativo para jogador", () => {
    const list = members([
      { membershipId: "pres", role: "presidente", status: "ativo" },
    ]);
    expect(isLastPresidentDemotion(list, "pres", "jogador")).toBe(true);
  });

  it("permite rebaixar um presidente quando há OUTRO presidente ativo", () => {
    const list = members([
      { membershipId: "pres1", role: "presidente", status: "ativo" },
      { membershipId: "pres2", role: "presidente", status: "ativo" },
    ]);
    expect(isLastPresidentDemotion(list, "pres1", "jogador")).toBe(false);
  });

  it("não considera presidentes NÃO-ativos como salvaguarda", () => {
    // Só há 1 presidente ATIVO; o outro está recusado, logo não conta.
    const list = members([
      { membershipId: "pres1", role: "presidente", status: "ativo" },
      { membershipId: "pres2", role: "presidente", status: "recusado" },
    ]);
    expect(isLastPresidentDemotion(list, "pres1", "jogador")).toBe(true);
  });

  it("manter presidente→presidente não é rebaixamento", () => {
    const list = members([
      { membershipId: "pres", role: "presidente", status: "ativo" },
    ]);
    expect(isLastPresidentDemotion(list, "pres", "presidente")).toBe(false);
  });

  it("promover um jogador a tesoureiro não é rebaixamento de presidente", () => {
    const list = members([
      { membershipId: "pres", role: "presidente", status: "ativo" },
      { membershipId: "j1", role: "jogador", status: "ativo" },
    ]);
    expect(isLastPresidentDemotion(list, "j1", "tesoureiro")).toBe(false);
  });

  it("membro inexistente não caracteriza esvaziamento", () => {
    const list = members([
      { membershipId: "pres", role: "presidente", status: "ativo" },
    ]);
    expect(isLastPresidentDemotion(list, "fantasma", "jogador")).toBe(false);
  });

  it("alvo não-ativo não caracteriza esvaziamento", () => {
    const list = members([
      { membershipId: "pres", role: "presidente", status: "pendente" },
    ]);
    expect(isLastPresidentDemotion(list, "pres", "jogador")).toBe(false);
  });
});

describe("validateRoleChange", () => {
  const list = members([
    { membershipId: "pres", role: "presidente", status: "ativo" },
    { membershipId: "tes", role: "tesoureiro", status: "ativo" },
    { membershipId: "pend", role: "jogador", status: "pendente" },
  ]);

  it("rejeita papel inválido", () => {
    const r = validateRoleChange(list, "tes", "admin");
    expect(r).toEqual({ ok: false, message: "Papel inválido." });
  });

  it("rejeita membro inexistente", () => {
    const r = validateRoleChange(list, "fantasma", "tesoureiro");
    expect(r).toEqual({ ok: false, message: "Membro não encontrado." });
  });

  it("rejeita alterar papel de membro não-ativo", () => {
    const r = validateRoleChange(list, "pend", "tesoureiro");
    expect(r).toEqual({
      ok: false,
      message: "Só é possível alterar o papel de membros ativos.",
    });
  });

  it("rejeita rebaixar o último presidente com a mensagem padrão", () => {
    const r = validateRoleChange(list, "pres", "jogador");
    expect(r).toEqual({
      ok: false,
      message: "O clube precisa de ao menos um presidente.",
    });
  });

  it("aceita uma promoção válida", () => {
    const r = validateRoleChange(list, "tes", "presidente");
    expect(r).toEqual({ ok: true, role: "presidente" });
  });
});
