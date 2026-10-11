import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { applyActiveMensalistaFilter } from "@/lib/players/active-mensalistas";
import { generateTxid, isValidPeriod } from "@/lib/validation/charge";

/**
 * Interface mínima do query builder que `applyActiveMensalistaFilter`
 * consome (encadeável `eq`/`is`), estendida com o `then` do PostgREST para
 * poder ser aguardada. Tipar o builder por aqui evita que o TypeScript tente
 * inferir o tipo genérico recursivo e profundo do cliente Supabase (TS2589).
 */
interface MensalistaQuery {
  eq(column: string, value: string | number | boolean): MensalistaQuery;
  is(column: string, value: null): MensalistaQuery;
  then<R>(
    onfulfilled: (result: {
      data: MensalistaRow[] | null;
      error: { message: string } | null;
    }) => R,
  ): Promise<R>;
}

/**
 * Lógica de geração automática de mensalidades (Req 5.1, 5.2), multi-tenant.
 *
 * Mantida separada do Route Handler para ficar testável e próxima das regras
 * de negócio (design.md "Crons — decisão"). O handler apenas valida o
 * `CRON_SECRET`, cria o cliente service-role e delega para cá.
 *
 * Multi-tenant (tarefa 21.10 — Req 10.2, 11.1, 17.6): a geração percorre TODOS
 * os clubes ATIVOS (`clubs.deleted_at IS NULL`). Para cada clube, lê a sua
 * própria `settings` (`.eq("club_id", clubId)`), carrega os mensalistas
 * elegíveis DAQUELE clube e insere as cobranças com o `club_id` do clube. A
 * service role (que ignora a RLS) filtra EXPLICITAMENTE por `club_id` em cada
 * iteração, como defesa para nunca cruzar dados entre clubes.
 *
 * Isolamento de falha (Req 17.6/19.4): o processamento de cada clube é
 * isolado num try/catch. Um erro em um clube é registrado no resumo (lista
 * `clubErrors`) mas NÃO aborta os demais — os outros clubes continuam sendo
 * processados.
 *
 * Idempotência (Req 5.2): a unicidade é garantida pelo índice único PARCIAL
 * do banco em `charges(club_id, player_id, period) WHERE kind='mensalidade'
 * AND deleted_at IS NULL`. Inserimos cada cobrança individualmente e, ao
 * receber uma violação de unicidade (código `23505`), tratamos como "já
 * gerada" → ignoramos e seguimos. Assim, reexecutar o cron no mesmo mês não
 * duplica nada.
 */

/** Código de erro do Postgres para violação de restrição única. */
const UNIQUE_VIOLATION = "23505";

/** Dia de vencimento padrão quando as Configurações trouxerem um valor fora de 1..28. */
const DEFAULT_DUE_DAY = 10;

/** Subconjunto de `settings` necessário para montar as cobranças. */
interface MensalidadeSettings {
  default_monthly_cents: number;
  due_day: number;
}

/** Subconjunto de `players` carregado para a geração. */
interface MensalistaRow {
  id: string;
  custom_monthly_cents: number | null;
}

/** Subconjunto de `clubs` carregado para iterar os clubes ativos. */
interface ClubRow {
  id: string;
}

/** Contagens de uma geração de mensalidades (por clube ou agregada). */
export interface MensalidadesCounts {
  /** Cobranças efetivamente geradas nesta execução. */
  generated: number;
  /**
   * Cobranças ignoradas por já existirem no período (idempotência, Req 5.2).
   * Em uma reexecução no mesmo mês, todos os mensalistas caem aqui.
   */
  skipped: number;
  /**
   * Jogadores pulados por não terem valor cobrável (sem personalizado e com
   * padrão <= 0): não é possível cobrar R$ 0,00. Contabilizados à parte para
   * dar visibilidade no log do cron.
   */
  skippedNoAmount: number;
}

/** Erro isolado de um clube — não aborta os demais (Req 17.6). */
export interface ClubError {
  /** Clube cujo processamento falhou. */
  clubId: string;
  /** Mensagem legível da falha. */
  message: string;
}

/** Resumo da execução, retornado ao handler e logado na resposta. */
export interface GenerateMensalidadesSummary extends MensalidadesCounts {
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
 * Resolve o valor (em centavos) da mensalidade de um jogador: usa o valor
 * personalizado quando houver (Req 2.3); caso contrário, o padrão das
 * Configurações (Req 2.4).
 *
 * Retorna `null` quando o valor resolvido não é cobrável (<= 0 ou inválido) —
 * ex.: jogador sem personalizado e padrão zerado. O chamador deve pular esses
 * jogadores (não faz sentido gerar cobrança de R$ 0,00).
 *
 * Helper puro, exportado para testes sem banco.
 */
export function resolveMonthlyAmount(
  customMonthlyCents: number | null | undefined,
  defaultMonthlyCents: number,
): number | null {
  const amount =
    customMonthlyCents != null ? customMonthlyCents : defaultMonthlyCents;

  if (!Number.isInteger(amount) || amount <= 0) {
    return null;
  }
  return amount;
}

/**
 * Deriva a data de vencimento (`due_date`, `YYYY-MM-DD`) DENTRO do período da
 * mensalidade, a partir do dia de vencimento configurado (`settings.due_day`).
 *
 * Diferente de `defaultDueDate` (que avança para o mês seguinte quando o dia
 * já passou), aqui ancoramos no próprio mês do período gerado — a mensalidade
 * de `2024-03` vence em março. O `dueDay` é restrito a 1..28 nas Configurações,
 * então o dia sempre existe em qualquer mês (sem risco de "31 de fevereiro").
 *
 * Helper puro, exportado para testes.
 */
export function dueDateForPeriod(period: string, dueDay: number): string {
  if (!isValidPeriod(period)) {
    throw new Error(`Período inválido: "${period}" (esperado YYYY-MM).`);
  }
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) {
    throw new Error(
      `Dia de vencimento inválido: "${dueDay}" (esperado inteiro entre 1 e 28).`,
    );
  }
  const dd = String(dueDay).padStart(2, "0");
  return `${period}-${dd}`;
}

/**
 * Gera as cobranças de mensalidade do `period` para os mensalistas ativos não
 * isentos de UM clube (Req 5.1), de forma idempotente (Req 5.2).
 *
 * Passos:
 *  1. Carrega a `settings` DAQUELE clube (`.eq("club_id", clubId)`).
 *  2. Carrega os mensalistas elegíveis DAQUELE clube (reuso de
 *     `applyActiveMensalistaFilter`, escopado por `club_id`).
 *  3. Para cada um, resolve o valor (personalizado ?? padrão); pula quem não
 *     tiver valor cobrável.
 *  4. Insere a cobrança (com `club_id`); na violação de unicidade (23505),
 *     conta como pulada por idempotência e segue.
 *
 * O cliente deve ser o service-role (contorna RLS); por isso filtramos
 * explicitamente por `club_id` em cada query, como defesa anti-cruzamento.
 *
 * Lança em caso de falha de banco; o chamador (`generateMensalidadesForPeriod`)
 * isola a falha por clube.
 */
export async function generateMensalidadesForClub(
  supabase: SupabaseClient,
  clubId: string,
  period: string,
): Promise<MensalidadesCounts> {
  if (!isValidPeriod(period)) {
    throw new Error(`Período inválido: "${period}" (esperado YYYY-MM).`);
  }

  // 1) Configurações DO CLUBE: valor padrão e dia de vencimento.
  const { data: settings, error: settingsError } = await supabase
    .from("settings")
    .select("default_monthly_cents, due_day")
    .eq("club_id", clubId)
    .single<MensalidadeSettings>();

  if (settingsError) {
    throw new Error(`Falha ao carregar Configurações: ${settingsError.message}`);
  }
  if (!settings) {
    throw new Error(`Configurações não encontradas para o clube ${clubId}.`);
  }

  const defaultMonthlyCents = settings.default_monthly_cents ?? 0;
  const dueDay =
    Number.isInteger(settings.due_day) &&
    settings.due_day >= 1 &&
    settings.due_day <= 28
      ? settings.due_day
      : DEFAULT_DUE_DAY;
  const dueDate = dueDateForPeriod(period, dueDay);

  // 2) Mensalistas ativos, não isentos e não excluídos DO CLUBE (filtro
  //    compartilhado + escopo explícito por `club_id`). A asserção para
  //    `MensalistaQuery` evita a inferência recursiva profunda do PostgREST
  //    (TS2589) sem perder a tipagem do resultado.
  const playersQuery = supabase
    .from("players")
    .select("id, custom_monthly_cents") as unknown as MensalistaQuery;
  const { data: players, error: playersError } =
    await applyActiveMensalistaFilter(playersQuery, clubId);

  if (playersError) {
    throw new Error(`Falha ao carregar mensalistas: ${playersError.message}`);
  }

  const rows = players ?? [];

  let generated = 0;
  let skipped = 0;
  let skippedNoAmount = 0;

  for (const player of rows) {
    const amountCents = resolveMonthlyAmount(
      player.custom_monthly_cents,
      defaultMonthlyCents,
    );

    // 3) Sem valor cobrável (padrão 0 e sem personalizado): não gera R$ 0,00.
    if (amountCents == null) {
      skippedNoAmount += 1;
      continue;
    }

    // 4) Insere a cobrança (escopada ao clube); a idempotência fica a cargo do
    //    índice único parcial `(club_id, player_id, period)`.
    const { error: insertError } = await supabase.from("charges").insert({
      club_id: clubId,
      player_id: player.id,
      amount_cents: amountCents,
      description: `Mensalidade ${period}`,
      kind: "mensalidade",
      period,
      due_date: dueDate,
      status: "pendente",
      txid: generateTxid(),
    });

    if (insertError) {
      // Violação de unicidade = cobrança já existe no período → idempotência.
      if (insertError.code === UNIQUE_VIOLATION) {
        skipped += 1;
        continue;
      }
      throw new Error(
        `Falha ao gerar mensalidade do jogador ${player.id}: ${insertError.message}`,
      );
    }

    generated += 1;
  }

  return { generated, skipped, skippedNoAmount };
}

/**
 * Gera as cobranças de mensalidade do `period` para TODOS os clubes ativos
 * (multi-tenant, Req 10.2/11.1/17.6), de forma idempotente (Req 5.2).
 *
 * Fluxo:
 *  1. Lista os clubes ativos (`clubs.deleted_at IS NULL`) — clubes arquivados
 *     são pulados.
 *  2. Para cada clube, chama `generateMensalidadesForClub` dentro de um
 *     try/catch: a falha de um clube é registrada em `clubErrors` e NÃO aborta
 *     os demais (isolamento de falha, Req 17.6/19.4).
 *  3. Agrega as contagens de todos os clubes no resumo retornado.
 *
 * O cliente deve ser o service-role (contorna RLS), já que o cron não tem
 * sessão de usuário.
 */
export async function generateMensalidadesForPeriod(
  supabase: SupabaseClient,
  period: string,
): Promise<GenerateMensalidadesSummary> {
  if (!isValidPeriod(period)) {
    throw new Error(`Período inválido: "${period}" (esperado YYYY-MM).`);
  }

  // 1) Clubes ativos (não arquivados). A falha ao listá-los é fatal: sem a
  //    lista não há o que iterar.
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
  let skippedNoAmount = 0;
  const clubErrors: ClubError[] = [];

  // 2) Processa cada clube de forma isolada: um erro não derruba os demais.
  for (const club of clubRows) {
    try {
      const counts = await generateMensalidadesForClub(
        supabase,
        club.id,
        period,
      );
      generated += counts.generated;
      skipped += counts.skipped;
      skippedNoAmount += counts.skippedNoAmount;
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
    skippedNoAmount,
    clubErrors,
  };
}
