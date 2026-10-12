import type { ClubRole } from "@/lib/auth/membership";

/**
 * Navegação da área autenticada `(app)` no modelo MULTI-TENANT (tarefa 23.1).
 *
 * O papel que filtra a navegação é o papel do usuário NO CLUBE ATIVO
 * (`memberships.role`, tipo {@link ClubRole}) — nunca mais um papel global de
 * `profiles` (Req 5.3). Os papéis são `presidente | tesoureiro | jogador`
 * (`presidente` substitui o antigo `admin`).
 *
 * `roles` lista os papéis que podem ver/acessar o item. Mantemos essas regras
 * em ESPELHO com o guard por papel do middleware (`CLUB_ROUTE_ROLES` em
 * `src/middleware.ts`):
 *   - dashboard e meu-extrato: qualquer membership ativa (todos os papéis);
 *   - jogadores, categorias, configuracoes e membros: apenas presidente;
 *   - lancamentos, cobrancas, aprovacoes, inadimplentes e recorrentes:
 *     presidente + tesoureiro.
 *
 * Observação de segurança: filtrar a navegação por papel é conveniência de UX.
 * A autoridade real continua sendo a RLS no Postgres (Req 1.7/6.2) e o guard do
 * middleware (Req 1.6). Esconder um link não protege a rota — a RLS protege.
 */
export interface NavItem {
  /** Caminho (prefixo) da rota dentro da área autenticada. */
  href: string;
  /** Rótulo exibido na navegação (pt-BR). */
  label: string;
  /** Papéis (no clube ativo) autorizados a ver/acessar o item. */
  roles: readonly ClubRole[];
}

const ALL_ROLES: readonly ClubRole[] = ["presidente", "tesoureiro", "jogador"];
const FINANCE_ROLES: readonly ClubRole[] = ["presidente", "tesoureiro"];
const PRESIDENT_ONLY: readonly ClubRole[] = ["presidente"];

/**
 * Itens de navegação da área autenticada, na ordem de exibição.
 *
 * As rotas e papéis espelham `CLUB_ROUTE_ROLES` do middleware (ver nota acima).
 * `/membros` é a gestão de membros do clube (aprovar/recusar, papéis) e é
 * exclusiva do presidente.
 */
export const APP_NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", roles: ALL_ROLES },
  { href: "/meu-extrato", label: "Meu extrato", roles: ALL_ROLES },
  { href: "/lancamentos", label: "Lançamentos", roles: FINANCE_ROLES },
  { href: "/cobrancas", label: "Cobranças", roles: FINANCE_ROLES },
  { href: "/aprovacoes", label: "Aprovações", roles: FINANCE_ROLES },
  { href: "/inadimplentes", label: "Inadimplentes", roles: FINANCE_ROLES },
  { href: "/recorrentes", label: "Recorrentes", roles: FINANCE_ROLES },
  { href: "/jogadores", label: "Jogadores", roles: PRESIDENT_ONLY },
  { href: "/membros", label: "Membros", roles: PRESIDENT_ONLY },
  { href: "/membros/papeis", label: "Papéis", roles: PRESIDENT_ONLY },
  { href: "/categorias", label: "Categorias", roles: PRESIDENT_ONLY },
  { href: "/configuracoes", label: "Configurações", roles: PRESIDENT_ONLY },
  { href: "/sobre", label: "Sobre e Ajuda", roles: ALL_ROLES },
];

/** Retorna apenas os itens de navegação visíveis para o papel informado. */
export function navItemsForRole(role: ClubRole): NavItem[] {
  return APP_NAV_ITEMS.filter((item) => item.roles.includes(role));
}

/** Rótulo amigável (pt-BR) para exibir o papel do usuário na interface. */
export const ROLE_LABELS: Readonly<Record<ClubRole, string>> = {
  presidente: "Presidente",
  tesoureiro: "Tesoureiro",
  jogador: "Jogador",
};
