-- Migration: memberships — vínculo usuário↔clube (tarefa 16.2)
-- Tabela: memberships
-- Requisitos: 4.3, 5.1, 5.2, 5.4
--
-- Contexto (design.md "memberships (vínculo usuário↔clube)"): no FutCaixa
-- multi-tenant o PAPEL de uma pessoa deixa de ser global em `profiles` e passa
-- a existir POR CLUBE, aqui em `memberships`. Esta tabela é a FONTE DE VERDADE
-- do papel de um usuário num futebol — nunca mais `profiles` (Req 5.3).
--
-- Uma mesma pessoa pode participar de vários futebóis com papéis diferentes,
-- mas tem NO MÁXIMO UM papel por futebol: garantido por unique (user_id, club_id)
-- (Req 5.2).
--
-- Fluxo de status (ver design.md "Convite / aprovação de membros"):
--   pendente = abriu um convite e aguarda aprovação do presidente (Req 4.3)
--   ativo    = aprovado; passa a enxergar/operar os dados do futebol
--   recusado = pedido negado pelo presidente
-- Ao aprovar, o presidente vincula (ou cria) uma linha `players` daquele clube
-- e preenche `memberships.player_id`, mudando o status para `ativo`.
--
-- Convenções herdadas (design.md "Modelo de dados"):
--   - id uuid default gen_random_uuid()
--   - created_at/updated_at timestamptz default now(); updated_at via trigger
--     public.set_updated_at() (helper da migration 2.1)
--
-- Esta migration é ADITIVA e PARA FRENTE: cria apenas a tabela `memberships`.
--   - NÃO mexe em RLS (seção 17).
--   - NÃO semeia dados.
-- Idempotente: usa IF NOT EXISTS. pgcrypto (gen_random_uuid) vem da 2.1.
--
-- Referências de FK já existentes:
--   - public.profiles(id) ...... migration 2.1 (20250101000001)
--   - public.players(id) ....... migration 2.1 (20250101000001); ganha club_id
--     na tarefa 16.4, o que não afeta esta FK
--   - public.clubs(id) ......... migration 16.1 (20250101000013)
create extension if not exists pgcrypto;

-- =====================================================================
-- memberships  (vínculo usuário↔clube; fonte de verdade do papel por futebol)
-- =====================================================================
create table if not exists public.memberships (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  club_id    uuid        not null references public.clubs (id) on delete cascade,
  role       text        not null,
  status     text        not null default 'pendente',
  -- player_id: preenchido quando o membro é vinculado a um jogador do clube
  -- (na aprovação). Nulo enquanto o membro ainda não representa um jogador.
  player_id  uuid        references public.players (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- No máximo um papel por par (usuário, futebol) — Req 5.2.
  constraint memberships_user_club_unique unique (user_id, club_id),
  constraint memberships_role_check
    check (role in ('presidente', 'tesoureiro', 'jogador')),
  constraint memberships_status_check
    check (status in ('pendente', 'ativo', 'recusado'))
);

-- Índices de apoio às consultas mais comuns:
--   - por clube: listar membros de um futebol.
--   - por usuário: resolver os futebóis/papéis de quem está logado.
--   - (club_id, status): listar membros `pendentes` de um futebol (Req 4.5).
create index if not exists memberships_club_id_idx
  on public.memberships (club_id);

create index if not exists memberships_user_id_idx
  on public.memberships (user_id);

create index if not exists memberships_club_id_status_idx
  on public.memberships (club_id, status);

create trigger memberships_set_updated_at
  before update on public.memberships
  for each row execute function public.set_updated_at();

comment on table public.memberships is
  'Vínculo usuário↔clube e FONTE DE VERDADE do papel por futebol (Req 5.3); não mais em profiles.';
comment on column public.memberships.role is
  'Papel do usuário NESTE futebol: presidente | tesoureiro | jogador.';
comment on column public.memberships.status is
  'Estado do vínculo: pendente (aguarda aprovação) | ativo | recusado.';
comment on column public.memberships.player_id is
  'Jogador (players.id) deste clube que o usuário representa; preenchido na aprovação.';
