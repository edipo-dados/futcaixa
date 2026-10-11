import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Lógica de geração de lançamentos a partir de despesas recorrentes (Req 4.2),
 * multi-tenant.
 *
 * Mantida separada do Route Handler para ficar testável e próxima das regras
 * de negócio (design.md "Crons — decisão"). O handler apenas valida o
 * `CRON_SECRET`, cria o cliente service-role e delega para cá.
 *
 * Multi-tenant (tarefa 21.10 — Req 10.2, 11.1, 17.6): a geração percorre TODOS
 * os clubes ATIVOS (`clubs.deleted_at IS NULL`). Para cada clube, carrega as
 * `recurring_expenses` ativas DAQUELE clube (`.eq("club_id", clubId)`) e insere
 * `transactions` com o `club_id` do clube; atualiza `last_generated_period`
 * por linha. A service role (que ignora a RLS) filtra EXPLICITAMENTE por
 * `club_id`, como defesa para nunca cruzar dados entre clubes.
 *
 * Isolamento de falha (Req 17.6/19.4): o processamento de cada clube é isolado
 * num try/catch. Um erro em um clube é registrado no resumo (lista
 * `clubErrors`) mas NÃO aborta os demais.
 *
 * Idempotência (Req 4.3): só processamos recorrências cujo
 * `last_generated_period` seja diferente do período atual; ao gerar o
 * lançamento, gravamos o período. Assim, reexecutar o cron no mesmo mês não
 * duplica nada.
 */

/** Subconjunto de `recurring_expenses` necessário para gerar o lançamento. */
interface RecurringToGenerate {
  id: string;
  amount_cents: number;
  category_id: string;
  description: string;
  day_of_month: number;
}

/** Subconjunto de `clubs` carregado para iterar os clubes ativos. */
interface ClubRow {
  id: string;
}

/** Contagens de uma geração de recorrentes (por clube ou agregada). */
export interface RecurringCounts {
  /** Quantidade de lançamentos efetivamente gerados nesta execução. */
  generated: number;
  /**
   * Quantidade de recorrências que já estavam geradas no período (ignoradas
   * pela idempotência). Em uma reexecução no mesmo mês, todas caem aqui.
   */
  skipped: number;
}

/** Erro isolado de um clube — não aborta os demais (Req 17.6). */
export interface ClubError {
  /** Clube cujo processamento falhou. */
  clubId: string;
  /** Mensagem legível da falha. */
  message: string;
}

/** Resumo da execução, retornado ao handler e logado na resposta. */
export interface GenerateRecurringSummary extends RecurringCounts {
  /** Período processado (`YYYY-MM`). */
  period: string;
  /** Quantidade de clubes ativos processados (independe de sucesso). */
  clubsProcessed: number;
  /**
   * Clubes cujo processamento falhou. A falha de um clube é isolada e NÃO
   * impede a geração dos demais (Req 17.6).
   */
  clubErrors: ClubError[];
}

/**
 * Deriva a data do lançamento (`occurred_on`, `YYYY-MM-DD`) a partir do período
 * e do dia do mês da recorrência.
 *
 * `day_of_month` é restrito a 1..28 no schema, então o dia sempre existe em
 * qualquer mês — não há risco de "31 de fevereiro".
 */
export function occurredOnFor(period: string, dayOfMonth: number): string {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new Error(`Período inválido: "${period}" (esperado YYYY-MM).`);
  }
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28) {
    throw new Error(
      `Dia do mês inválido: "${dayOfMonth}" (esperado inteiro entre 1 e 28).`,
    );
  }
  const dd = String(dayOfMonth).padStart(2, "0");
  return `${period}-${dd}`;
}

/**
 * Gera os lançamentos de despesa das recorrências ativas de UM clube para o
 * `period`.
 *
 * Passos por recorrência pendente:
 *  1. Insere um `transactions` (kind `despesa`, com `club_id`), com
 *     `recurring_id` apontando para a origem e `created_by = null` (lançamento
 *     de sistema, sem ator).
 *  2. Atualiza `last_generated_period = period` naquela recorrência.
 *
 * Todas as queries filtram explicitamente por `club_id` (defesa anti-cruzamento,
 * mesmo com a service role que ignora a RLS).
 *
 * Lança em caso de falha de banco; o chamador (`generateRecurringForPeriod`)
 * isola a falha por clube.
 */
export async function generateRecurringForClub(
  supabase: SupabaseClient,
  clubId: string,
  period: string,
): Promise<RecurringCounts> {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new Error(`Período inválido: "${period}" (esperado YYYY-MM).`);
  }

  // Carrega apenas recorrências ativas DO CLUBE ainda não geradas neste período.
  // `is distinct from` cobre o caso de last_generated_period nulo.
  const { data: pending, error: loadError } = await supabase
    .from("recurring_expenses")
    .select("id, amount_cents, category_id, description, day_of_month")
    .eq("club_id", clubId)
    .eq("is_active", true)
    .or(`last_generated_period.is.null,last_generated_period.neq.${period}`);

  if (loadError) {
    throw new Error(
      `Falha ao carregar despesas recorrentes: ${loadError.message}`,
    );
  }

  const rows = (pending ?? []) as RecurringToGenerate[];

  let generated = 0;
  for (const recurring of rows) {
    const occurredOn = occurredOnFor(period, recurring.day_of_month);

    // 1) Lança a despesa correspondente (escopada ao clube), vinculada à
    //    recorrência de origem.
    const { error: insertError } = await supabase.from("transactions").insert({
      club_id: clubId,
      kind: "despesa",
      amount_cents: recurring.amount_cents,
      occurred_on: occurredOn,
      category_id: recurring.category_id,
      description: recurring.description,
      recurring_id: recurring.id,
      created_by: null,
    });

    if (insertError) {
      throw new Error(
        `Falha ao gerar lançamento da recorrência ${recurring.id}: ${insertError.message}`,
      );
    }

    // 2) Marca o período como gerado (idempotência, Req 4.3). Filtra por
    //    `club_id` também aqui, por defesa.
    const { error: updateError } = await supabase
      .from("recurring_expenses")
      .update({ last_generated_period: period })
      .eq("id", recurring.id)
      .eq("club_id", clubId);

    if (updateError) {
      throw new Error(
        `Falha ao atualizar last_generated_period da recorrência ${recurring.id}: ${updateError.message}`,
      );
    }

    generated += 1;
  }

  // "skipped" nesta execução = recorrências ativas DO CLUBE que já tinham o
  // período gerado. Contamos as ativas com last_generated_period = period.
  const { count: alreadyCount, error: countError } = await supabase
    .from("recurring_expenses")
    .select("id", { count: "exact", head: true })
    .eq("club_id", clubId)
    .eq("is_active", true)
    .eq("last_generated_period", period);

  if (countError) {
    throw new Error(
      `Falha ao contabilizar recorrências já geradas: ${countError.message}`,
    );
  }

  // Total já marcado no período inclui as que acabamos de gerar; o restante
  // são as puladas por idempotência.
  const skipped = Math.max((alreadyCount ?? 0) - generated, 0);

  return { generated, skipped };
}

/**
 * Gera os lançamentos de despesa das recorrências ativas de TODOS os clubes
 * ativos (multi-tenant, Req 10.2/11.1/17.6) para o `period`.
 *
 * Fluxo:
 *  1. Lista os clubes ativos (`clubs.deleted_at IS NULL`) — arquivados pulados.
 *  2. Para cada clube, chama `generateRecurringForClub` dentro de um try/catch:
 *     a falha de um clube é registrada em `clubErrors` e NÃO aborta os demais
 *     (isolamento de falha, Req 17.6/19.4).
 *  3. Agrega as contagens de todos os clubes no resumo retornado.
 *
 * O cliente deve ser o service-role (contorna RLS), já que o cron não tem
 * sessão de usuário.
 */
export async function generateRecurringForPeriod(
  supabase: SupabaseClient,
  period: string,
): Promise<GenerateRecurringSummary> {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new Error(`Período inválido: "${period}" (esperado YYYY-MM).`);
  }

  // 1) Clubes ativos (não arquivados). Falha ao listá-los é fatal.
  const { data: clubs, error: clubsError } = await supabase
    .from("clubs")
    .select("id")
    .is("deleted_at", null);

  if (clubsError) {
    throw new Error(`Falha ao carregar clubes ativos: ${clubsError.message}`);
  }

  const clubRows = (clubs ?? []) as ClubRow[];

  let generated = 0;
  let skipped = 0;
  const clubErrors: ClubError[] = [];

  // 2) Processa cada clube de forma isolada: um erro não derruba os demais.
  for (const club of clubRows) {
    try {
      const counts = await generateRecurringForClub(supabase, club.id, period);
      generated += counts.generated;
      skipped += counts.skipped;
    } catch (error) {
      clubErrors.push({
        clubId: club.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 3) Resumo agregado por clube.
  return {
    period,
    clubsProcessed: clubRows.length,
    generated,
    skipped,
    clubErrors,
  };
}
