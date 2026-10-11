/**
 * Helpers para os testes de INTEGRAÇÃO multi-tenant contra um Supabase/Postgres
 * de teste.
 *
 * ── Modelo multi-tenant ────────────────────────────────────────────────────
 * O FutCaixa evoluiu de single-tenant para multi-tenant: um "futebol" (clube) é
 * um tenant isolado. O papel de uma pessoa é POR CLUBE, via `memberships`
 * (nunca mais em `profiles`), e todas as tabelas de domínio carregam
 * `club_id NOT NULL`. Estes helpers refletem esse modelo:
 *   - `createTestClub`                    → cria um clube + settings + categorias
 *   - `createTestAuthUserWithProfile`     → cria um usuário de auth confirmado
 *   - `createTestMembership`              → vincula usuário ↔ clube com papel
 *   - `createTestPlayer` / `createTestCharge` / `createTestRecurringExpense`
 *                                           → entidades de domínio com `club_id`
 *   - `signInAsUser`                      → cliente anon autenticado (exercita RLS)
 *   - `resolveClubCategoryId`             → categoria de um clube por tipo
 *   - `teardown`                          → remove tudo que o teste criou
 *
 * ── Quando os testes rodam ──────────────────────────────────────────────────
 * Os testes só rodam quando um banco de teste está configurado via variáveis de
 * ambiente. Em dev, o `tests/integration/setup-env.ts` carrega essas variáveis
 * do `.env.local` automaticamente (ver aquele arquivo). As variáveis esperadas:
 *   - SUPABASE_TEST_URL                → URL do projeto de teste
 *   - SUPABASE_TEST_SERVICE_ROLE_KEY   → service role key (monta/limpa cenário)
 *   - SUPABASE_TEST_ANON_KEY           → anon key (cliente autenticado p/ RLS)
 *
 * O cliente de service role CONTORNA a RLS — próprio para montar/limpar o
 * cenário. Para EXERCITAR a RLS é preciso um cliente autenticado como usuário
 * real (anon key + signInWithPassword), feito por `signInAsUser`.
 *
 * ── Isolamento no banco de dev ──────────────────────────────────────────────
 * Como os testes podem rodar contra o MESMO projeto de desenvolvimento, TUDO é
 * isolado por um `runId` único (prefixo em nomes, e-mails, invite_code e txid) e
 * o teardown remove explicitamente, na ordem das FKs, tudo o que foi criado —
 * inclusive clubs, memberships e usuários de auth. NUNCA apagamos dados que o
 * teste não criou.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const TEST_URL = process.env.SUPABASE_TEST_URL;
const TEST_SERVICE_ROLE_KEY = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const TEST_ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY;

/**
 * Indica se o banco de teste está configurado. Quando `false`, as suítes de
 * integração são ignoradas (skip) em vez de falharem.
 */
export const hasTestDb: boolean = Boolean(TEST_URL && TEST_SERVICE_ROLE_KEY);

/**
 * Indica se o ambiente para os testes de RLS está completo. Além do banco de
 * teste (`hasTestDb`), os testes de RLS exigem a ANON KEY para construir
 * clientes autenticados por usuário (a service role contorna a RLS e não serve
 * para exercê-la). Quando `false`, a suíte de RLS é ignorada (skip).
 */
export const hasRlsTestEnv: boolean = hasTestDb && Boolean(TEST_ANON_KEY);

/**
 * Cria um cliente Supabase com a service role para os testes. Lança um erro
 * explícito se chamado sem o banco configurado — o chamador deve guardar a
 * execução com `hasTestDb`/`skipIf`.
 */
export function createTestClient(): SupabaseClient {
  if (!hasTestDb) {
    throw new Error(
      "Banco de teste não configurado. Defina SUPABASE_TEST_URL e " +
        "SUPABASE_TEST_SERVICE_ROLE_KEY (ou configure o .env.local) para rodar " +
        "os testes de integração.",
    );
  }

  return createClient(TEST_URL as string, TEST_SERVICE_ROLE_KEY as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Gera um identificador único por execução, usado como prefixo para isolar os
 * dados criados por um teste (facilita a limpeza e evita colisões de `txid`,
 * e-mail, nome e invite_code entre execuções concorrentes).
 */
export function uniqueRunId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `itest-${Date.now().toString(36)}-${rand}`;
}

/** Normaliza uma semente em um `txid` válido (apenas [0-9a-z], máx. 25 chars). */
export function txidFrom(seed: string): string {
  return seed
    .toLowerCase()
    .replace(/[^0-9a-z]/g, "")
    .slice(0, 25);
}

/** Data de hoje em `YYYY-MM-DD`. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Rastreia os ids criados por um teste para teardown na ordem correta das FKs.
 *
 * Ordem de remoção (do mais dependente para o menos dependente):
 *   transactions → payment_proofs → charges → recurring_expenses → goals →
 *   players → memberships → settings → categories → clubs → profiles →
 *   auth users.
 *
 * Nota: as tabelas de domínio têm `club_id ... on delete cascade`, então apagar
 * o clube por si só já removeria players/charges/etc. Ainda assim rastreamos e
 * apagamos explicitamente na ordem das FKs (defesa e previsibilidade), e o
 * clube é removido por ÚLTIMO entre as entidades de domínio.
 */
export interface CreatedRows {
  transactionIds: string[];
  proofIds: string[];
  chargeIds: string[];
  recurringIds: string[];
  goalIds: string[];
  playerIds: string[];
  membershipIds: string[];
  /** Linhas de `settings` criadas (uma por clube). */
  settingsIds: number[];
  /** Ids de clubes criados pelo teste; removidos por último entre o domínio. */
  clubIds: string[];
  /**
   * Ids de usuários de `auth.users` criados pelo teste (via Admin API). São
   * apagados por ÚLTIMO; apagar o usuário de auth remove em cascata o
   * `profiles` (FK ON DELETE CASCADE), mas apagamos de forma ordenada.
   */
  authUserIds: string[];
}

/** Cria o rastreador vazio de linhas criadas. */
export function newCreatedRows(): CreatedRows {
  return {
    transactionIds: [],
    proofIds: [],
    chargeIds: [],
    recurringIds: [],
    goalIds: [],
    playerIds: [],
    membershipIds: [],
    settingsIds: [],
    clubIds: [],
    authUserIds: [],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// CLUBES (tenants)
// ────────────────────────────────────────────────────────────────────────────

/** Opções para criar um clube de teste. */
export interface CreateTestClubOptions {
  /** Sufixo para diferenciar o nome quando o teste cria vários clubes. */
  suffix?: string;
  /** `created_by` (profiles.id). Opcional — a coluna é nullable. */
  createdBy?: string | null;
  /** Semear as categorias padrão do clube (default: true). */
  seedCategories?: boolean;
  /**
   * Criar a linha de `settings` do clube (default: true). Necessária para o
   * cron de mensalidades e para as views de saldo.
   */
  withSettings?: boolean;
  /** Valor padrão de mensalidade (centavos) na `settings` do clube. */
  defaultMonthlyCents?: number;
}

/** Linha de clube retornada pelo helper. */
export interface ClubRow {
  id: string;
  name: string;
  invite_code: string;
}

/**
 * Cria um clube de teste (service role) com nome e `invite_code` únicos (via
 * `runId`), rastreando o id para teardown. Por padrão:
 *   - cria a linha de `settings` do clube (uma por clube; `id` smallint
 *     explícito para não colidir com o default herdado do antigo singleton);
 *   - semeia as categorias padrão via a RPC `seed_club_categories(clubId)`.
 *
 * `created_by` referencia `profiles.id` e é NULLABLE (migration 16.1), então é
 * opcional — o teste pode passar o id de um usuário de teste já criado ou
 * deixar nulo.
 */
export async function createTestClub(
  service: SupabaseClient,
  tracked: CreatedRows,
  runId: string,
  options: CreateTestClubOptions = {},
): Promise<ClubRow> {
  const suffix = options.suffix ? `-${options.suffix}` : "";
  const inviteCode = txidFrom(`${runId}${suffix}invite`) || `${runId}${suffix}`;

  const { data: club, error: clubErr } = await service
    .from("clubs")
    .insert({
      name: `${runId}${suffix} Futebol`,
      invite_code: `${runId}${suffix}-${inviteCode}`.slice(0, 48),
      created_by: options.createdBy ?? null,
    })
    .select("id, name, invite_code")
    .single<ClubRow>();

  if (clubErr || !club) {
    throw new Error(`Falha ao criar clube de teste: ${clubErr?.message}`);
  }
  tracked.clubIds.push(club.id);

  // settings do clube (uma linha por clube). `settings.id` é smallint com
  // default 1 (herança do antigo singleton), então informamos um id explícito
  // único para não colidir a PK quando houver vários clubes. Como as suítes
  // rodam em PARALELO (arquivos de teste concorrentes), um simples max(id)+1
  // colidiria; usamos um id ALEATÓRIO em faixa alta de smallint e repetimos em
  // caso de violação de PK (23505).
  if (options.withSettings ?? true) {
    const settingsId = await insertClubSettings(service, club, {
      defaultMonthlyCents: options.defaultMonthlyCents ?? 0,
    });
    tracked.settingsIds.push(settingsId);
  }

  // Categorias padrão do clube via RPC (mesma usada por create_club).
  if (options.seedCategories ?? true) {
    const { error: seedErr } = await service.rpc("seed_club_categories", {
      p_club_id: club.id,
    });
    if (seedErr) {
      throw new Error(
        `Falha ao semear categorias do clube de teste: ${seedErr.message}`,
      );
    }
  }

  return club;
}

/** Código de erro do Postgres para violação de restrição única. */
const UNIQUE_VIOLATION = "23505";

/**
 * Insere a linha de `settings` do clube com um `id` smallint ALEATÓRIO em faixa
 * alta, repetindo em caso de colisão de PK (23505) — robusto a suítes
 * concorrentes. Retorna o `id` efetivamente usado (para teardown).
 *
 * smallint vai até 32767; sorteamos em [10000, 32767]. O seed/dados reais usam
 * ids pequenos (a partir de 1), então o espaço alto raramente colide.
 */
async function insertClubSettings(
  service: SupabaseClient,
  club: ClubRow,
  opts: { defaultMonthlyCents: number },
): Promise<number> {
  const base = {
    club_id: club.id,
    club_name: club.name,
    pix_key: "chave-pix-teste@futcaixa.test",
    pix_receiver_name: "FUTCAIXA TESTE",
    pix_city: "SAO PAULO",
    default_monthly_cents: opts.defaultMonthlyCents,
    default_drop_in_cents: 0,
    due_day: 10,
    generation_day: 1,
    initial_balance_cents: 0,
  };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = 10000 + Math.floor(Math.random() * 22000);
    const { error } = await service.from("settings").insert({ id, ...base });
    if (!error) return id;
    if (error.code !== UNIQUE_VIOLATION) {
      throw new Error(
        `Falha ao criar settings do clube de teste: ${error.message}`,
      );
    }
    // colisão de PK → tenta outro id
  }
  throw new Error(
    "Falha ao criar settings do clube de teste: não foi possível alocar um id único após várias tentativas.",
  );
}

// ────────────────────────────────────────────────────────────────────────────
// USUÁRIOS DE AUTH + PERFIL
// ────────────────────────────────────────────────────────────────────────────

/** Opções para criar um usuário de auth + profile de teste. */
export interface CreateAuthUserOptions {
  /** Sufixo para diferenciar e-mail/nome quando o teste cria vários usuários. */
  suffix?: string;
  /** Marca `profiles.is_system_admin = true` (admin de plataforma). */
  isSystemAdmin?: boolean;
}

/** Credenciais do usuário de auth criado para o teste. */
export interface CreatedAuthUser {
  userId: string;
  email: string;
  password: string;
}

/**
 * Cria um usuário de auth CONFIRMADO (Admin API, exige service role). O trigger
 * `on_auth_user_created` cria automaticamente a linha `profiles` (apenas id +
 * full_name no modelo multi-tenant). Quando `isSystemAdmin` é pedido, atualiza
 * `profiles.is_system_admin = true` após a criação.
 *
 * O profile é removido em cascata ao apagar o usuário de auth no teardown; por
 * isso rastreamos apenas o id do usuário de auth.
 */
export async function createTestAuthUserWithProfile(
  service: SupabaseClient,
  tracked: CreatedRows,
  options: CreateAuthUserOptions = {},
): Promise<CreatedAuthUser> {
  const rand = Math.random().toString(36).slice(2, 10);
  const sfx = options.suffix ? `${options.suffix}-` : "";
  const email = `itest-${sfx}${Date.now().toString(36)}-${rand}@example.test`;
  const password = `Pw-${rand}-${Math.random().toString(36).slice(2, 10)}`;

  const { data: created, error: createErr } = await service.auth.admin.createUser(
    {
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `${sfx}Usuário de teste` },
    },
  );

  if (createErr || !created?.user) {
    throw new Error(
      `Falha ao criar usuário de auth de teste: ${createErr?.message}`,
    );
  }

  const userId = created.user.id;
  tracked.authUserIds.push(userId);

  // O trigger cria o profile; garantimos que ele exista e ajustamos o flag de
  // system_admin se pedido. Usamos upsert para cobrir uma eventual corrida com
  // o trigger (o profile pode ainda não ter sido inserido).
  if (options.isSystemAdmin) {
    const { error: updErr } = await service
      .from("profiles")
      .upsert(
        { id: userId, is_system_admin: true },
        { onConflict: "id" },
      );
    if (updErr) {
      throw new Error(
        `Falha ao marcar is_system_admin no profile de teste: ${updErr.message}`,
      );
    }
  }

  return { userId, email, password };
}

// ────────────────────────────────────────────────────────────────────────────
// MEMBERSHIPS
// ────────────────────────────────────────────────────────────────────────────

/** Opções para criar uma membership de teste. */
export interface CreateMembershipOptions {
  userId: string;
  clubId: string;
  role: "presidente" | "tesoureiro" | "jogador";
  status?: "pendente" | "ativo" | "recusado";
  playerId?: string | null;
}

/**
 * Cria (service role) a membership que vincula um usuário a um clube com papel e
 * status. Por padrão `status = 'ativo'`. Rastreia o id para teardown.
 */
export async function createTestMembership(
  service: SupabaseClient,
  tracked: CreatedRows,
  options: CreateMembershipOptions,
): Promise<string> {
  const { data, error } = await service
    .from("memberships")
    .insert({
      user_id: options.userId,
      club_id: options.clubId,
      role: options.role,
      status: options.status ?? "ativo",
      player_id: options.playerId ?? null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    throw new Error(`Falha ao criar membership de teste: ${error?.message}`);
  }
  tracked.membershipIds.push(data.id);
  return data.id;
}

// ────────────────────────────────────────────────────────────────────────────
// JOGADORES
// ────────────────────────────────────────────────────────────────────────────

/** Overrides opcionais para `createTestPlayer`. */
export interface CreateTestPlayerOptions {
  /** Clube dono do jogador (club_id, NOT NULL). Obrigatório. */
  clubId: string;
  /** Sufixo para diferenciar nome/e-mail quando o teste cria vários jogadores. */
  suffix?: string;
  /** Tipo do jogador (default: `mensalista`). */
  type?: "mensalista" | "avulso" | "convidado";
  /** Status (default: `ativo`). */
  status?: "ativo" | "inativo";
  /** Mensalidade personalizada em centavos (> 0); sobrescreve o padrão. */
  customMonthlyCents?: number;
}

/**
 * Cria um jogador de teste (service role) escopado a um clube e registra o id
 * para teardown. O nome/e-mail recebem o `runId` (e o `suffix` opcional) como
 * prefixo para isolamento. Mantém os defaults mensalista/ativo/não isento.
 */
export async function createTestPlayer(
  service: SupabaseClient,
  tracked: CreatedRows,
  runId: string,
  options: CreateTestPlayerOptions,
): Promise<string> {
  const suffix = options.suffix ? `-${options.suffix}` : "";
  const rand = Math.random().toString(36).slice(2, 6);
  const { data, error } = await service
    .from("players")
    .insert({
      club_id: options.clubId,
      name: `${runId}${suffix} Jogador`,
      email: `${runId}${suffix}-${rand}@example.test`,
      type: options.type ?? "mensalista",
      status: options.status ?? "ativo",
      skill_level: 1,
      ...(options.customMonthlyCents != null
        ? { custom_monthly_cents: options.customMonthlyCents }
        : {}),
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    throw new Error(`Falha ao criar jogador de teste: ${error?.message}`);
  }
  tracked.playerIds.push(data.id);
  return data.id;
}

// ────────────────────────────────────────────────────────────────────────────
// CATEGORIAS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve o id de uma categoria (semeada por clube) do `clubId` para o `kind`
 * informado. As categorias são semeadas na criação do clube
 * (`seed_club_categories`), então ao menos uma de cada tipo existe.
 */
export async function resolveClubCategoryId(
  service: SupabaseClient,
  clubId: string,
  kind: "receita" | "despesa",
): Promise<string> {
  const { data, error } = await service
    .from("categories")
    .select("id")
    .eq("club_id", clubId)
    .eq("kind", kind)
    .order("sort_order", { ascending: true })
    .limit(1)
    .single<{ id: string }>();

  if (error || !data) {
    throw new Error(
      `Nenhuma categoria '${kind}' encontrada para o clube ${clubId}: ${error?.message}`,
    );
  }
  return data.id;
}

/**
 * Resolve o id de uma categoria de RECEITA do clube pelo NOME (ex.: "Avulso"),
 * com fallback para "Outros". Reproduz a estratégia de mapeamento tipo-de-
 * cobrança → categoria usada no fluxo de aprovação de pagamento.
 */
export async function resolveClubReceitaCategoryIdByName(
  service: SupabaseClient,
  clubId: string,
  name: string,
): Promise<string | null> {
  const findByName = async (n: string): Promise<string | null> => {
    const { data } = await service
      .from("categories")
      .select("id, is_active")
      .eq("club_id", clubId)
      .eq("kind", "receita")
      .ilike("name", n)
      .order("is_active", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; is_active: boolean }>();
    return data?.id ?? null;
  };

  const mapped = await findByName(name);
  if (mapped) return mapped;
  return findByName("Outros");
}

// ────────────────────────────────────────────────────────────────────────────
// DESPESAS RECORRENTES
// ────────────────────────────────────────────────────────────────────────────

/** Parâmetros para criar uma despesa recorrente de teste. */
export interface CreateRecurringInput {
  clubId: string;
  amountCents: number;
  categoryId: string;
  description: string;
  dayOfMonth: number; // 1..28
  isActive?: boolean;
  lastGeneratedPeriod?: string | null; // YYYY-MM
}

/**
 * Cria uma despesa recorrente de teste (service role) escopada a um clube e
 * registra o id para teardown. Por padrão vem ativa e sem período gerado.
 */
export async function createTestRecurringExpense(
  service: SupabaseClient,
  tracked: CreatedRows,
  input: CreateRecurringInput,
): Promise<string> {
  const { data, error } = await service
    .from("recurring_expenses")
    .insert({
      club_id: input.clubId,
      amount_cents: input.amountCents,
      category_id: input.categoryId,
      description: input.description,
      day_of_month: input.dayOfMonth,
      is_active: input.isActive ?? true,
      last_generated_period: input.lastGeneratedPeriod ?? null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    throw new Error(
      `Falha ao criar despesa recorrente de teste: ${error?.message}`,
    );
  }
  tracked.recurringIds.push(data.id);
  return data.id;
}

// ────────────────────────────────────────────────────────────────────────────
// COBRANÇAS
// ────────────────────────────────────────────────────────────────────────────

/** Parâmetros para criar uma cobrança de teste. */
export interface CreateChargeInput {
  clubId: string;
  playerId: string;
  amountCents: number;
  kind: "mensalidade" | "avulso" | "multa" | "vaquinha";
  description: string;
  dueDate: string; // YYYY-MM-DD
  status?: "pendente" | "em_analise" | "paga" | "cancelada";
  period?: string | null; // YYYY-MM (obrigatório na prática p/ mensalidade)
  txid: string;
}

/** Linha de cobrança retornada pelos helpers. */
export interface ChargeRow {
  id: string;
  club_id: string;
  player_id: string;
  amount_cents: number;
  description: string;
  kind: CreateChargeInput["kind"];
  period: string | null;
  status: string;
  paid_at: string | null;
}

/** Cria uma cobrança de teste (service role) escopada a um clube. */
export async function createTestCharge(
  service: SupabaseClient,
  tracked: CreatedRows,
  input: CreateChargeInput,
): Promise<ChargeRow> {
  const { data, error } = await service
    .from("charges")
    .insert({
      club_id: input.clubId,
      player_id: input.playerId,
      amount_cents: input.amountCents,
      description: input.description,
      kind: input.kind,
      period: input.period ?? null,
      due_date: input.dueDate,
      status: input.status ?? "pendente",
      txid: input.txid,
    })
    .select(
      "id, club_id, player_id, amount_cents, description, kind, period, status, paid_at",
    )
    .single<ChargeRow>();

  if (error || !data) {
    throw new Error(`Falha ao criar cobrança de teste: ${error?.message}`);
  }
  tracked.chargeIds.push(data.id);
  return data;
}

// ────────────────────────────────────────────────────────────────────────────
// TRANSAÇÕES / METAS (helpers diretos)
// ────────────────────────────────────────────────────────────────────────────

/** Parâmetros para criar um lançamento de teste. */
export interface CreateTransactionInput {
  clubId: string;
  kind: "receita" | "despesa";
  amountCents: number;
  categoryId: string;
  description: string;
  occurredOn?: string; // YYYY-MM-DD (default: hoje)
  playerId?: string | null;
  chargeId?: string | null;
}

/** Cria um lançamento de teste (service role) escopado a um clube. */
export async function createTestTransaction(
  service: SupabaseClient,
  tracked: CreatedRows,
  input: CreateTransactionInput,
): Promise<string> {
  const { data, error } = await service
    .from("transactions")
    .insert({
      club_id: input.clubId,
      kind: input.kind,
      amount_cents: input.amountCents,
      occurred_on: input.occurredOn ?? todayISO(),
      category_id: input.categoryId,
      description: input.description,
      player_id: input.playerId ?? null,
      charge_id: input.chargeId ?? null,
      created_by: null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    throw new Error(`Falha ao criar lançamento de teste: ${error?.message}`);
  }
  tracked.transactionIds.push(data.id);
  return data.id;
}

/** Parâmetros para criar uma meta de teste. */
export interface CreateGoalInput {
  clubId: string;
  title: string;
  targetCents: number;
  currentCents?: number;
  isActive?: boolean;
}

/** Cria uma meta/vaquinha de teste (service role) escopada a um clube. */
export async function createTestGoal(
  service: SupabaseClient,
  tracked: CreatedRows,
  input: CreateGoalInput,
): Promise<string> {
  const { data, error } = await service
    .from("goals")
    .insert({
      club_id: input.clubId,
      title: input.title,
      target_cents: input.targetCents,
      current_cents: input.currentCents ?? 0,
      is_active: input.isActive ?? true,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    throw new Error(`Falha ao criar meta de teste: ${error?.message}`);
  }
  tracked.goalIds.push(data.id);
  return data.id;
}

// ────────────────────────────────────────────────────────────────────────────
// AUTENTICAÇÃO (clientes anon por usuário, para exercitar a RLS)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Cria um cliente Supabase com a ANON KEY e autentica com e-mail/senha,
 * retornando um cliente já com a sessão do usuário — é com ele que exercemos a
 * RLS (as policies passam a enxergar `auth.uid()` e os helpers tenant-aware do
 * usuário). Lança um erro explícito se o ambiente de RLS não estiver
 * configurado.
 */
export async function signInAsUser(
  email: string,
  password: string,
): Promise<SupabaseClient> {
  if (!hasRlsTestEnv) {
    throw new Error(
      "Ambiente de RLS não configurado. Defina SUPABASE_TEST_URL, " +
        "SUPABASE_TEST_SERVICE_ROLE_KEY e SUPABASE_TEST_ANON_KEY (ou configure " +
        "o .env.local) para rodar os testes de RLS.",
    );
  }

  const client = createClient(TEST_URL as string, TEST_ANON_KEY as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Falha ao autenticar usuário de teste: ${error.message}`);
  }
  return client;
}

// ────────────────────────────────────────────────────────────────────────────
// TEARDOWN
// ────────────────────────────────────────────────────────────────────────────

/**
 * Remove TODAS as linhas criadas por um teste, na ordem que respeita as FKs:
 *   transactions (por id, por charge_id e por recurring_id) → payment_proofs →
 *   charges → recurring_expenses → goals → players → memberships → settings →
 *   categories (do clube) → clubs → auth users.
 *
 * As tabelas de domínio têm `club_id ON DELETE CASCADE`, então apagar o clube
 * já removeria em cascata; ainda assim removemos explicitamente e em ordem para
 * previsibilidade e para cobrir linhas geradas indiretamente (ex.: a receita
 * criada ao aprovar uma cobrança, cujo id não foi rastreado, mas que pertence
 * ao clube do teste).
 *
 * A exclusão é física (hard delete) por ser um ambiente de teste. Erros de
 * limpeza são ignorados para não mascarar a asserção que de fato falhou — mas
 * SEMPRE escopados aos ids/clubes criados pelo teste (NUNCA tocamos dados que o
 * teste não criou).
 */
export async function teardown(
  service: SupabaseClient,
  tracked: CreatedRows,
): Promise<void> {
  // transactions rastreadas explicitamente.
  if (tracked.transactionIds.length) {
    await service.from("transactions").delete().in("id", tracked.transactionIds);
  }
  // Transações vinculadas às cobranças do teste (ex.: receita gerada no fluxo).
  if (tracked.chargeIds.length) {
    await service.from("transactions").delete().in("charge_id", tracked.chargeIds);
  }
  // Lançamentos gerados pelas recorrências do teste (cron).
  if (tracked.recurringIds.length) {
    await service
      .from("transactions")
      .delete()
      .in("recurring_id", tracked.recurringIds);
  }
  // Qualquer transação remanescente escopada aos clubes do teste.
  if (tracked.clubIds.length) {
    await service.from("transactions").delete().in("club_id", tracked.clubIds);
  }

  if (tracked.proofIds.length) {
    await service.from("payment_proofs").delete().in("id", tracked.proofIds);
  }
  if (tracked.clubIds.length) {
    await service.from("payment_proofs").delete().in("club_id", tracked.clubIds);
  }

  if (tracked.chargeIds.length) {
    await service.from("charges").delete().in("id", tracked.chargeIds);
  }
  if (tracked.clubIds.length) {
    await service.from("charges").delete().in("club_id", tracked.clubIds);
  }

  if (tracked.recurringIds.length) {
    await service
      .from("recurring_expenses")
      .delete()
      .in("id", tracked.recurringIds);
  }

  if (tracked.goalIds.length) {
    await service.from("goals").delete().in("id", tracked.goalIds);
  }

  // memberships referenciam players (player_id); remove antes dos players.
  if (tracked.membershipIds.length) {
    await service.from("memberships").delete().in("id", tracked.membershipIds);
  }
  if (tracked.clubIds.length) {
    await service.from("memberships").delete().in("club_id", tracked.clubIds);
  }

  if (tracked.playerIds.length) {
    await service.from("players").delete().in("id", tracked.playerIds);
  }
  if (tracked.clubIds.length) {
    await service.from("players").delete().in("club_id", tracked.clubIds);
  }

  if (tracked.settingsIds.length) {
    await service.from("settings").delete().in("id", tracked.settingsIds);
  }
  if (tracked.clubIds.length) {
    await service.from("settings").delete().in("club_id", tracked.clubIds);
    await service.from("categories").delete().in("club_id", tracked.clubIds);
  }

  // clubs por último entre o domínio (as FKs de domínio já foram limpas).
  if (tracked.clubIds.length) {
    await service.from("clubs").delete().in("id", tracked.clubIds);
  }

  // Usuários de auth: Admin API, um a um (não há delete em lote). Apagar o
  // usuário remove o profile em cascata caso ainda exista.
  if (tracked.authUserIds.length) {
    for (const userId of tracked.authUserIds) {
      await service.auth.admin.deleteUser(userId).catch(() => undefined);
    }
  }
}
