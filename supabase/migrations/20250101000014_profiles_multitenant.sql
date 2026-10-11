-- Migration: evolução de `profiles` para multi-tenant + `president_requests` (tarefa 16.3)
-- Requisitos: 1.2, 2.1, 2.4, 5.3
--
-- Contexto (design.md "Modelo de dados"): o FutCaixa deixa de ser single-tenant.
-- O PAPEL e o VÍNCULO com jogador agora são POR CLUBE, via `memberships`
-- (tarefa 16.2) — não mais globais em `profiles`. Logo:
--   - `profiles.role`      é removido (papel agora vem de `memberships.role`).
--   - `profiles.player_id` é removido (vínculo agora vem de `memberships.player_id`).
--
-- O que `profiles` passa a guardar além do perfil básico:
--   - `is_system_admin`  : flag de administrador da PLATAFORMA (não é papel de
--                          clube). Concedido via SQL/seed; não há tela de
--                          autopromoção.
--   - `president_status` : ESTADO ATUAL da solicitação do usuário para virar
--                          presidente de futebol ('none' | 'pendente' | 'aprovado').
--
-- `president_requests` é a TRILHA/HISTÓRICO de solicitações de presidente
-- (uma linha por pedido, com revisão), complementar a `profiles.president_status`
-- que guarda apenas o estado corrente.
--
-- Esta migration é para frente (reset de dados, sem backfill) e idempotente:
-- usa IF EXISTS/IF NOT EXISTS e `create or replace`, podendo rodar novamente.

-- =====================================================================
-- 1) Evolução de `profiles`
-- =====================================================================

-- Admin de plataforma (bypass de tenant na RLS). Default false; definido via
-- SQL/seed para o(s) usuário(s) de administração.
alter table public.profiles
  add column if not exists is_system_admin boolean not null default false;

-- Estado atual da solicitação para virar presidente de futebol.
--   none     = nunca solicitou (ou não aplicável)
--   pendente = solicitou e aguarda aprovação do system_admin
--   aprovado = aprovado; pode criar futebol
alter table public.profiles
  add column if not exists president_status text not null default 'none';

-- CHECK de domínio para president_status (idempotente: só cria se não existir).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_president_status_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_president_status_check
      check (president_status in ('none', 'pendente', 'aprovado'));
  end if;
end;
$$;

comment on column public.profiles.is_system_admin is
  'Administrador da plataforma (bypass de tenant na RLS). Concedido via SQL/seed.';
comment on column public.profiles.president_status is
  'Estado atual da solicitação de presidente: none | pendente | aprovado.';

-- Antes de remover as colunas role/player_id, derruba as policies legadas
-- (migrations 2.6 e 2.8) que as referenciam — senão o DROP COLUMN falha com
-- "cannot drop column ... because other objects depend on it". Essas policies
-- são oficialmente substituídas nas migrations 2.20+ (RLS multi-tenant); aqui
-- apenas as removemos cedo. IF EXISTS mantém a operação idempotente e não
-- conflita com os DROPs repetidos da 2.20.
drop policy if exists charges_player_select          on public.charges;
drop policy if exists payment_proofs_player_select   on public.payment_proofs;
drop policy if exists payment_proofs_player_insert    on public.payment_proofs;
drop policy if exists proofs_insert_owner_or_manager on storage.objects;
drop policy if exists proofs_select_owner_or_manager on storage.objects;

-- Remove o papel global: agora é por clube via memberships.role.
-- DROP COLUMN remove junto o CHECK `profiles_role_check` definido na 2.1.
alter table public.profiles
  drop column if exists role;

-- Remove o vínculo global com jogador: agora é por clube via memberships.player_id.
-- DROP COLUMN remove junto a FK para players(id) e o índice profiles_player_id_idx.
alter table public.profiles
  drop column if exists player_id;

-- =====================================================================
-- 2) Atualiza o trigger de criação de perfil no cadastro
-- =====================================================================
-- A função original (migration 20250101000012) inseria (id, role, full_name).
-- Como `role` foi removido de `profiles`, o perfil nasce apenas com (id, full_name).
-- O papel passa a existir somente quando o usuário entra num clube (memberships).
-- Mantém security definer e search_path = public.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Cria automaticamente o perfil (apenas id + full_name) para cada novo usuário de auth. Papel e vínculo com jogador passam a ser por clube (memberships).';

-- O trigger on_auth_user_created (20250101000012) continua válido e aponta
-- para esta função; não é necessário recriá-lo.

-- =====================================================================
-- 3) president_requests  (histórico de solicitações de presidente)
-- =====================================================================
-- Uma linha por solicitação. `profiles.president_status` guarda o estado atual;
-- esta tabela guarda a trilha completa (quem revisou, quando e observações).
create table if not exists public.president_requests (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references public.profiles (id) on delete cascade,
  status       text        not null default 'pendente',
  requested_at timestamptz not null default now(),
  reviewed_by  uuid        references public.profiles (id) on delete set null,
  reviewed_at  timestamptz,
  note         text,

  constraint president_requests_status_check
    check (status in ('pendente', 'aprovado', 'recusado'))
);

create index if not exists president_requests_user_id_idx
  on public.president_requests (user_id);

create index if not exists president_requests_status_idx
  on public.president_requests (status);

comment on table public.president_requests is
  'Histórico/trilha de solicitações para virar presidente de futebol; complementa profiles.president_status (estado atual).';
comment on column public.president_requests.status is
  'Status desta solicitação: pendente | aprovado | recusado.';
comment on column public.president_requests.reviewed_by is
  'system_admin que revisou a solicitação (nulo enquanto pendente).';
