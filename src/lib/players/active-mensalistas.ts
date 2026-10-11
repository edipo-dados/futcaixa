/**
 * Filtro compartilhado de "mensalistas ativos" para a geração automática de
 * mensalidades (Requisitos 2.6 e 5.1).
 *
 * A geração mensal via cron (tarefa 8.2) só deve criar cobranças para jogadores
 * que, simultaneamente:
 *   - têm `type = 'mensalista'`;
 *   - estão com `status = 'ativo'` (um jogador inativado por um admin deixa de
 *     entrar na geração — Req 2.6 — sem perder o histórico, pois a inativação
 *     apenas altera o status, nunca apaga o registro);
 *   - não são isentos (`is_exempt = false`, ex.: goleiro — Req 5.1);
 *   - não foram excluídos (soft delete: `deleted_at is null`).
 *
 * Este módulo centraliza esse critério num único lugar para que a inativação
 * (tarefa 5.2) e o cron (tarefa 8.2) compartilhem exatamente a mesma regra,
 * evitando divergências. Mantém-se minimalista: apenas as constantes do
 * critério e um helper que aplica os filtros a um query builder do Supabase.
 */

/** Colunas obrigatórias do critério de elegibilidade. */
export const ACTIVE_MENSALISTA_FILTER = {
  type: "mensalista",
  status: "ativo",
  isExempt: false,
} as const;

/**
 * Interface mínima de um query builder do Supabase/PostgREST que suporta os
 * filtros usados aqui. Permite aplicar o critério sem acoplar a assinatura
 * completa do cliente, facilitando reuso e testes.
 */
interface EligibilityFilterable<T> {
  eq(column: string, value: string | number | boolean): T;
  is(column: string, value: null): T;
}

/**
 * Aplica, de forma encadeável, o filtro de mensalistas ativos não isentos e
 * não excluídos a uma query `select` de `players`.
 *
 * No modelo multi-tenant (um "futebol" = um clube), `players` tem `club_id`
 * NOT NULL e a geração automática é feita POR CLUBE. Passe `clubId` para
 * escopar a query ao clube em processamento (`.eq("club_id", clubId)`),
 * garantindo que o cron nunca cruze dados entre clubes — defesa explícita,
 * mesmo quando o cliente é a service role (que ignora a RLS).
 *
 * Uso previsto no cron de mensalidades (tarefa 21.10):
 *
 * ```ts
 * const query = supabase
 *   .from("players")
 *   .select("id, name, custom_monthly_cents");
 * const { data } = await applyActiveMensalistaFilter(query, clubId);
 * ```
 *
 * `clubId` é opcional para manter compatibilidade com usos single-tenant/testes
 * de unidade; quando omitido, nenhum filtro de clube é aplicado.
 */
export function applyActiveMensalistaFilter<
  T extends EligibilityFilterable<T>,
>(query: T, clubId?: string): T {
  let filtered = query
    .eq("type", ACTIVE_MENSALISTA_FILTER.type)
    .eq("status", ACTIVE_MENSALISTA_FILTER.status)
    .eq("is_exempt", ACTIVE_MENSALISTA_FILTER.isExempt)
    .is("deleted_at", null);

  if (clubId != null) {
    filtered = filtered.eq("club_id", clubId);
  }

  return filtered;
}
