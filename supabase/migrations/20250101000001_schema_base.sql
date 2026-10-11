-- Migration: schema base (tarefa 2.1)
-- Tabelas: profiles, players, categories, settings
-- Requisitos: 2.1, 2.2, 3.2, 10.1, 10.2, 10.3
--
-- Convenções (design.md "Modelo de dados"):
--   - id uuid default gen_random_uuid() (exceto profiles = auth.users.id e settings = singleton smallint)
--   - created_at timestamptz default now(); updated_at onde aplicável
--   - valores monetários sempre em centavos (integer)
--   - soft delete via deleted_at timestamptz null
--
-- RLS, FKs para tabelas ainda inexistentes (players.id referenciado por profiles)
-- e triggers de auditoria são tratados nas migrations seguintes (2.2–2.7).

-- gen_random_uuid() faz parte da extensão pgcrypto (nativa no Supabase).
create extension if not exists pgcrypto;

-- Helper: mantém updated_at em dia a cada UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =====================================================================
-- players
-- =====================================================================
create table if not exists public.players (
  id                   uuid primary key default gen_random_uuid(),
  name                 text        not null,
  nickname             text,
  email                text,
  phone                text,
  type                 text        not null default 'mensalista',
  status               text        not null default 'ativo',
  skill_level          smallint    not null default 1,
  is_exempt            boolean     not null default false,
  exempt_reason        text,
  custom_monthly_cents integer,
  custom_drop_in_cents integer,
  deleted_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint players_type_check
    check (type in ('mensalista', 'avulso', 'convidado')),
  constraint players_status_check
    check (status in ('ativo', 'inativo')),
  constraint players_skill_level_check
    check (skill_level between 1 and 3),
  -- Req 2.2: isento exige motivo.
  constraint players_exempt_reason_check
    check (not is_exempt or (exempt_reason is not null and length(btrim(exempt_reason)) > 0)),
  -- valores personalizados, quando presentes, são positivos.
  constraint players_custom_monthly_cents_check
    check (custom_monthly_cents is null or custom_monthly_cents > 0),
  constraint players_custom_drop_in_cents_check
    check (custom_drop_in_cents is null or custom_drop_in_cents > 0)
);

-- email único quando presente (ignora NULLs); case-insensitive.
create unique index if not exists players_email_unique
  on public.players (lower(email))
  where email is not null;

create trigger players_set_updated_at
  before update on public.players
  for each row execute function public.set_updated_at();

comment on table public.players is 'Jogadores do grupo (Req 2).';
comment on column public.players.skill_level is 'Nível técnico 1..3; peso no sorteio.';
comment on column public.players.custom_monthly_cents is 'Mensalidade personalizada (centavos); sobrescreve o padrão de settings.';
comment on column public.players.custom_drop_in_cents is 'Avulso personalizado (centavos); sobrescreve o padrão de settings.';

-- =====================================================================
-- profiles  (espelha auth.users; define o papel)
-- =====================================================================
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  role       text        not null default 'jogador',
  full_name  text,
  player_id  uuid        references public.players (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_role_check
    check (role in ('admin', 'tesoureiro', 'jogador'))
);

create index if not exists profiles_player_id_idx on public.profiles (player_id);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

comment on table public.profiles is 'Perfil/papel por usuário autenticado (Req 1.3).';
comment on column public.profiles.player_id is 'Vincula o login a um jogador cadastrado.';

-- =====================================================================
-- categories
-- =====================================================================
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  kind       text        not null,
  name       text        not null,
  sort_order integer     not null default 0,
  is_active  boolean     not null default true,
  is_system  boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint categories_kind_check
    check (kind in ('receita', 'despesa'))
);

-- nome único por tipo (evita duplicatas ao criar/renomear).
create unique index if not exists categories_kind_name_unique
  on public.categories (kind, lower(name));

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

comment on table public.categories is 'Categorias de receita/despesa, editáveis e reordenáveis (Req 3.2–3.5).';
comment on column public.categories.is_system is 'Categoria semeada: renomeável/desativável, não excluível se usada.';

-- =====================================================================
-- settings  (linha única / singleton, id = 1)
-- =====================================================================
create table if not exists public.settings (
  id                    smallint primary key default 1,
  club_name             text        not null default '',
  logo_path             text,
  pix_key               text        not null default '',
  pix_receiver_name     text        not null default '',
  pix_city              text        not null default '',
  default_monthly_cents integer     not null default 0,
  default_drop_in_cents integer     not null default 0,
  due_day               smallint    not null default 10,
  generation_day        smallint    not null default 1,
  initial_balance_cents integer     not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- singleton: só pode existir a linha id = 1.
  constraint settings_singleton_check check (id = 1),
  constraint settings_default_monthly_cents_check check (default_monthly_cents >= 0),
  constraint settings_default_drop_in_cents_check check (default_drop_in_cents >= 0),
  constraint settings_initial_balance_cents_check check (initial_balance_cents >= 0),
  constraint settings_due_day_check check (due_day between 1 and 28),
  constraint settings_generation_day_check check (generation_day between 1 and 28)
);

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- Garante a linha singleton de configurações.
insert into public.settings (id)
values (1)
on conflict (id) do nothing;

comment on table public.settings is 'Configurações do clube/caixa — linha única (Req 10).';

-- =====================================================================
-- Seed das categorias de sistema (Req 3.2) — is_system = true
-- Despesa: Quadra, Bolas, Coletes, Arbitragem, Goleiro, Água/Gelo,
--          Confraternização, Outros
-- Receita: Mensalidade, Avulso, Multa, Doação, Vaquinha, Outros
-- =====================================================================
insert into public.categories (kind, name, sort_order, is_system) values
  ('despesa', 'Quadra',           1, true),
  ('despesa', 'Bolas',            2, true),
  ('despesa', 'Coletes',          3, true),
  ('despesa', 'Arbitragem',       4, true),
  ('despesa', 'Goleiro',          5, true),
  ('despesa', 'Água/Gelo',        6, true),
  ('despesa', 'Confraternização', 7, true),
  ('despesa', 'Outros',           8, true),
  ('receita', 'Mensalidade',      1, true),
  ('receita', 'Avulso',           2, true),
  ('receita', 'Multa',            3, true),
  ('receita', 'Doação',           4, true),
  ('receita', 'Vaquinha',         5, true),
  ('receita', 'Outros',           6, true)
on conflict (kind, lower(name)) do nothing;
