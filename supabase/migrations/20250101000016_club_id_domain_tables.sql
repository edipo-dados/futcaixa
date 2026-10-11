-- Migration: club_id nas tabelas de domínio + settings por clube (tarefa 16.4)
-- Tabelas afetadas: players, categories, transactions, recurring_expenses,
--                   charges, payment_proofs, goals, audit_log, settings
-- Requisitos: 6.1, 16.4, 17.3
--
-- Contexto (evolução multi-tenant): o FutCaixa passou de single-tenant para
-- multi-tenant (migrations 2.13 clubs e 2.14 profiles). Cada "futebol" é um
-- tenant isolado. Esta migration carrega `club_id` em TODAS as tabelas de
-- domínio (Req 6.1), de modo que cada linha pertença a exatamente um futebol,
-- e converte `settings` de singleton (uma linha global id=1) para "uma linha
-- por clube".
--
-- RESET DE DADOS: a evolução multi-tenant parte de reset limpo (os dados
-- existentes são descartados). Por isso é seguro adicionar `club_id NOT NULL`
-- sem backfill — não há linhas a preencher. A regra geral multi-tenant é:
-- toda tabela de domínio referencia `clubs(id)` com ON DELETE CASCADE, de modo
-- que apagar um futebol remove em cascata todos os seus dados.
--
-- Esta migration é PARA FRENTE e ADITIVA, com uma única exceção intencional:
-- a conversão do singleton de `settings` (DELETE da linha global + remoção da
-- CHECK de singleton), descrita na seção settings abaixo.
--
-- NÃO faz parte desta tarefa (ficam para 16.6 e seção 17):
--   - alterar o índice único parcial de mensalidade de charges (tarefa 16.6);
--   - reescrever as views agregadas (tarefa 16.6);
--   - mexer em RLS / políticas (seção 17).
--
-- clubs(id) vem da migration 2.13 (20250101000013_clubs.sql).

-- =====================================================================
-- Tabelas de domínio escopadas ao clube — club_id NOT NULL
-- Cada uma recebe club_id (FK -> clubs.id, ON DELETE CASCADE) e um índice
-- em club_id (os filtros por tenant são onipresentes nas consultas/RLS).
-- =====================================================================

-- players ----------------------------------------------------------------
alter table public.players
  add column club_id uuid not null references public.clubs (id) on delete cascade;

create index if not exists players_club_id_idx
  on public.players (club_id);

comment on column public.players.club_id is 'Futebol dono deste jogador (Req 6.1). Escopo multi-tenant.';

-- categories -------------------------------------------------------------
-- A migration 2.1 semeia categorias de sistema SEM club_id (seed global).
-- Como aqui adicionamos `club_id NOT NULL` (sem default), a tabela precisa
-- estar vazia antes do ALTER — caso contrário as linhas semeadas quebrariam
-- a restrição NOT NULL. Aproveitando o reset de dados multi-tenant, limpamos
-- as categorias globais aqui (mesmo padrão do DELETE de settings abaixo). As
-- categorias padrão passam a ser semeadas POR CLUBE (tarefa 16.5/20.1).
delete from public.categories;

alter table public.categories
  add column club_id uuid not null references public.clubs (id) on delete cascade;

create index if not exists categories_club_id_idx
  on public.categories (club_id);

comment on column public.categories.club_id is 'Futebol dono desta categoria (Req 6.1). Semeadas por clube na criação (tarefa 16.5/20.1).';

-- transactions -----------------------------------------------------------
alter table public.transactions
  add column club_id uuid not null references public.clubs (id) on delete cascade;

create index if not exists transactions_club_id_idx
  on public.transactions (club_id);

comment on column public.transactions.club_id is 'Futebol dono deste lançamento (Req 6.1). Escopo multi-tenant.';

-- recurring_expenses -----------------------------------------------------
alter table public.recurring_expenses
  add column club_id uuid not null references public.clubs (id) on delete cascade;

create index if not exists recurring_expenses_club_id_idx
  on public.recurring_expenses (club_id);

comment on column public.recurring_expenses.club_id is 'Futebol dono desta despesa recorrente (Req 6.1). O cron itera por clube.';

-- charges ----------------------------------------------------------------
alter table public.charges
  add column club_id uuid not null references public.clubs (id) on delete cascade;

create index if not exists charges_club_id_idx
  on public.charges (club_id);

comment on column public.charges.club_id is 'Futebol dono desta cobrança (Req 6.1). Escopo multi-tenant.';

-- payment_proofs ---------------------------------------------------------
alter table public.payment_proofs
  add column club_id uuid not null references public.clubs (id) on delete cascade;

create index if not exists payment_proofs_club_id_idx
  on public.payment_proofs (club_id);

comment on column public.payment_proofs.club_id is 'Futebol dono deste comprovante (Req 6.1). O caminho em Storage também inclui o club_id.';

-- goals ------------------------------------------------------------------
alter table public.goals
  add column club_id uuid not null references public.clubs (id) on delete cascade;

create index if not exists goals_club_id_idx
  on public.goals (club_id);

comment on column public.goals.club_id is 'Futebol dono desta meta/vaquinha (Req 6.1). Escopo multi-tenant.';

-- =====================================================================
-- audit_log — club_id NULL-able (ações de plataforma não têm clube)
-- Diferente das tabelas de domínio: ações no nível da plataforma (ex.:
-- aprovar um presidente, administrar futebóis pelo system_admin) NÃO
-- pertencem a nenhum futebol. Por isso club_id é NULL-able e usa
-- ON DELETE SET NULL — apagar um clube não deve apagar sua trilha de
-- auditoria histórica, apenas desvinculá-la.
-- =====================================================================
alter table public.audit_log
  add column club_id uuid references public.clubs (id) on delete set null;

create index if not exists audit_log_club_id_idx
  on public.audit_log (club_id);

comment on column public.audit_log.club_id is 'Futebol da ação auditada; NULL para ações de plataforma (ex.: aprovação de presidente). ON DELETE SET NULL preserva o histórico.';

-- =====================================================================
-- settings — de singleton (id=1 global) para "uma linha por clube"
-- =====================================================================
-- A `settings` nasceu como singleton na migration 2.1:
--   id smallint primary key default 1, constraint settings_singleton_check
--   check (id = 1), e uma linha seed (id=1) inserida.
-- No modelo multi-tenant cada futebol tem a SUA linha de settings
-- (club_name, pix_*, valores padrão, due_day, generation_day,
-- initial_balance_cents). Convertemos a tabela com segurança aproveitando
-- o reset de dados:
--
--   1) DELETE da linha singleton (id=1): o reset descarta os dados, então
--      limpamos a tabela antes de afrouxar a restrição de singleton. Sem
--      linhas, adicionar club_id NOT NULL é seguro (nada a backfillar).
--   2) DROP da CHECK de singleton (settings_singleton_check): o id deixa de
--      ser forçado a 1. Mantemos a coluna `id` como está (smallint PK) para
--      não quebrar nada; ela simplesmente deixa de ser fixada em 1. O que
--      passa a identificar a linha de cada futebol é `club_id` (UNIQUE + FK).
--      Obs.: `id smallint default 1` ainda existe, então inserções devem
--      informar `id` explicitamente para evitar colisão de PK — o fluxo de
--      criação de clube (tarefa 20.1) e o seed (24.1) cuidam disso ao gravar
--      settings por club_id. A forma exata do PK é secundária aqui: o que
--      importa (e o que o app passa a usar na tarefa 21.1) é ler settings
--      pelo club_id, garantido por UNIQUE.
--   3) ADD club_id (NOT NULL, FK -> clubs.id, ON DELETE CASCADE) + UNIQUE:
--      uma única linha de settings por futebol; apagar o clube remove a sua
--      configuração em cascata.
--
-- NÃO mexemos nas demais CHECKs de settings (valores >= 0, due_day/
-- generation_day entre 1..28) nem no trigger de updated_at/auditoria.

-- 1) Limpa a linha singleton (reset de dados).
delete from public.settings;

-- 2) Remove a restrição de singleton (id não é mais forçado a 1).
alter table public.settings
  drop constraint if exists settings_singleton_check;

-- 3) Adiciona club_id (NOT NULL — tabela sem linhas após o DELETE) e a
--    unicidade por clube (uma linha de settings por futebol).
alter table public.settings
  add column club_id uuid not null references public.clubs (id) on delete cascade;

alter table public.settings
  add constraint settings_club_id_unique unique (club_id);

comment on column public.settings.club_id is 'Futebol dono desta configuração (Req 16.4): uma linha de settings por futebol (UNIQUE). Substitui o antigo singleton id=1.';
comment on table public.settings is 'Configurações por futebol — uma linha por clube via club_id UNIQUE (Req 10, 16.4). Antes singleton global (id=1).';
