-- Migration: clubs — tenant de topo (tarefa 16.1)
-- Tabela: clubs (o "futebol")
-- Requisitos: 3.1, 3.5, 6.1
--
-- Contexto (evolução multi-tenant): o FutCaixa passa de single-tenant para
-- multi-tenant. Cada "futebol" é um tenant isolado. Esta migration introduz a
-- entidade de topo `clubs`; a coluna de exibição em pt-BR é "futebol".
--
-- Convenções herdadas das migrations anteriores (design.md "Modelo de dados"):
--   - id uuid default gen_random_uuid()
--   - created_at timestamptz default now(); updated_at com trigger set_updated_at()
--   - soft delete via deleted_at timestamptz null
--
-- Esta migration é ADITIVA e PARA FRENTE: cria apenas a tabela `clubs`.
--   - NÃO adiciona club_id às demais tabelas (isso é a tarefa 16.4).
--   - NÃO mexe em RLS (seção 17).
--   - NÃO semeia dados.
--
-- pgcrypto já está habilitado (migration 2.1) e fornece gen_random_uuid() e
-- gen_random_bytes(). O helper public.set_updated_at() também vem da 2.1.
create extension if not exists pgcrypto;

-- =====================================================================
-- clubs  (futebol / tenant de topo)
-- =====================================================================
create table if not exists public.clubs (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  slug        text,
  -- invite_code: token estável que NÃO expira, usado no link /convite/<codigo>
  -- (Req 3.5). O default garante que todo clube nasce com um código. 9 bytes
  -- aleatórios → 18 chars hex, URL-safe. A unicidade é garantida pela
  -- constraint `unique` abaixo (e pelo índice que ela cria).
  invite_code text        not null unique default encode(extensions.gen_random_bytes(9), 'hex'),
  created_by  uuid        references public.profiles (id),
  logo_path   text,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- O `unique` em invite_code já cria um índice único; este garante
-- explicitamente a existência do índice (idempotente) para lookups de convite.
create unique index if not exists clubs_invite_code_unique
  on public.clubs (invite_code);

create trigger clubs_set_updated_at
  before update on public.clubs
  for each row execute function public.set_updated_at();

comment on table public.clubs is 'Futebol/tenant de topo (Req 3). Cada linha é um "futebol" isolado.';
comment on column public.clubs.name is 'Nome do futebol.';
comment on column public.clubs.slug is 'Identificador amigável opcional para rota.';
comment on column public.clubs.invite_code is 'Token de convite estável que NÃO expira; usado no link público /convite/<codigo> (Req 3.5).';
comment on column public.clubs.created_by is 'Presidente que criou o clube (profiles.id).';
