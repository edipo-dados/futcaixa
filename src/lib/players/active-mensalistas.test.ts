import { describe, expect, it, vi } from "vitest";

import {
  ACTIVE_MENSALISTA_FILTER,
  applyActiveMensalistaFilter,
} from "./active-mensalistas";

/**
 * Testes do filtro compartilhado de "mensalistas ativos" (Req 2.6 / 5.1).
 *
 * O ponto central da tarefa 5.2 é garantir que um jogador inativado deixe de
 * entrar na geração automática. Isso é expresso pelo critério `status = 'ativo'`
 * aplicado por este helper, que o cron (tarefa 8.2) reutilizará. Aqui validamos
 * que o helper aplica exatamente os filtros esperados, encadeando corretamente.
 */

/** Query builder falso que registra os filtros aplicados, encadeável. */
function createFakeQuery() {
  const eqCalls: Array<[string, string | number | boolean]> = [];
  const isCalls: Array<[string, null]> = [];

  const query = {
    eq(column: string, value: string | number | boolean) {
      eqCalls.push([column, value]);
      return query;
    },
    is(column: string, value: null) {
      isCalls.push([column, value]);
      return query;
    },
  };

  return { query, eqCalls, isCalls };
}

describe("applyActiveMensalistaFilter", () => {
  it("filtra por tipo mensalista, status ativo, não isento e não excluído", () => {
    const { query, eqCalls, isCalls } = createFakeQuery();

    const result = applyActiveMensalistaFilter(query);

    // Encadeável: retorna o mesmo builder.
    expect(result).toBe(query);

    expect(eqCalls).toContainEqual(["type", "mensalista"]);
    // Req 2.6: inativos ficam de fora da geração automática.
    expect(eqCalls).toContainEqual(["status", "ativo"]);
    // Req 5.1: isentos (ex.: goleiro) ficam de fora.
    expect(eqCalls).toContainEqual(["is_exempt", false]);
    // Histórico preservado: inativar não é soft delete; só consideramos
    // registros não excluídos.
    expect(isCalls).toContainEqual(["deleted_at", null]);
  });

  it("aplica os filtros na ordem esperada", () => {
    const query = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
    };

    applyActiveMensalistaFilter(query);

    expect(query.eq).toHaveBeenNthCalledWith(1, "type", "mensalista");
    expect(query.eq).toHaveBeenNthCalledWith(2, "status", "ativo");
    expect(query.eq).toHaveBeenNthCalledWith(3, "is_exempt", false);
    expect(query.is).toHaveBeenCalledWith("deleted_at", null);
  });

  it("escopa por club_id quando informado (multi-tenant, Req 17.6)", () => {
    const { query, eqCalls } = createFakeQuery();

    applyActiveMensalistaFilter(query, "club-123");

    // Além do critério de elegibilidade, filtra pelo clube em processamento.
    expect(eqCalls).toContainEqual(["club_id", "club-123"]);
  });

  it("não aplica filtro de club_id quando omitido", () => {
    const { query, eqCalls } = createFakeQuery();

    applyActiveMensalistaFilter(query);

    expect(eqCalls.some(([column]) => column === "club_id")).toBe(false);
  });

  it("expõe as constantes do critério de elegibilidade", () => {
    expect(ACTIVE_MENSALISTA_FILTER).toEqual({
      type: "mensalista",
      status: "ativo",
      isExempt: false,
    });
  });
});
