import { describe, expect, it } from "vitest";

import {
  APP_NAV_ITEMS,
  navItemsForRole,
  ROLE_LABELS,
  type NavItem,
} from "@/lib/navigation";
import type { ClubRole } from "@/lib/auth/membership";

/**
 * A navegação precisa ficar em ESPELHO com o guard por papel do middleware
 * (`CLUB_ROUTE_ROLES` em `src/middleware.ts`). Replicamos aqui a tabela
 * esperada para que uma divergência quebre o teste (e não só a UX silenciosa).
 */
const EXPECTED_ROLES_BY_HREF: Record<string, readonly ClubRole[]> = {
  "/dashboard": ["presidente", "tesoureiro", "jogador"],
  "/meu-extrato": ["presidente", "tesoureiro", "jogador"],
  "/lancamentos": ["presidente", "tesoureiro"],
  "/cobrancas": ["presidente", "tesoureiro"],
  "/aprovacoes": ["presidente", "tesoureiro"],
  "/inadimplentes": ["presidente", "tesoureiro"],
  "/recorrentes": ["presidente", "tesoureiro"],
  "/jogadores": ["presidente"],
  "/membros": ["presidente"],
  "/membros/papeis": ["presidente"],
  "/categorias": ["presidente"],
  "/configuracoes": ["presidente"],
};

const hrefs = (items: readonly NavItem[]) => items.map((i) => i.href);

describe("navigation (multi-tenant / ClubRole)", () => {
  it("cada item exige exatamente os papéis esperados (espelho do middleware)", () => {
    for (const item of APP_NAV_ITEMS) {
      expect(
        EXPECTED_ROLES_BY_HREF[item.href],
        `rota sem papéis esperados: ${item.href}`,
      ).toBeDefined();
      expect([...item.roles].sort()).toEqual(
        [...EXPECTED_ROLES_BY_HREF[item.href]].sort(),
      );
    }
  });

  it("cobre todas as rotas esperadas, sem rota extra", () => {
    expect(hrefs(APP_NAV_ITEMS).sort()).toEqual(
      Object.keys(EXPECTED_ROLES_BY_HREF).sort(),
    );
  });

  it("presidente vê todos os itens (gestão + finanças + comuns)", () => {
    expect(hrefs(navItemsForRole("presidente"))).toEqual(hrefs(APP_NAV_ITEMS));
  });

  it("tesoureiro vê comuns + finanças, mas nenhuma rota de gestão", () => {
    const visible = hrefs(navItemsForRole("tesoureiro"));
    expect(visible).toContain("/dashboard");
    expect(visible).toContain("/meu-extrato");
    expect(visible).toContain("/lancamentos");
    expect(visible).toContain("/aprovacoes");
    for (const presidentOnly of [
      "/jogadores",
      "/membros",
      "/membros/papeis",
      "/categorias",
      "/configuracoes",
    ]) {
      expect(visible).not.toContain(presidentOnly);
    }
  });

  it("jogador vê apenas dashboard e meu-extrato", () => {
    expect(hrefs(navItemsForRole("jogador"))).toEqual([
      "/dashboard",
      "/meu-extrato",
    ]);
  });

  it("expõe rótulos pt-BR para todos os papéis (presidente, não admin)", () => {
    expect(ROLE_LABELS).toEqual({
      presidente: "Presidente",
      tesoureiro: "Tesoureiro",
      jogador: "Jogador",
    });
  });
});
