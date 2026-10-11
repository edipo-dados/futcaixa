-- Migration: semeadura de categorias por clube (tarefa 16.5)
-- Requisitos: 3.3, 9.2
-- design.md: "Categorias são semeadas por clube" — o seed de categorias de
-- sistema deixa de ser uma migração global e passa a ser lógica de criação de
-- clube (fluxo `createClub`, tarefa 20.1, e o seed de desenvolvimento, 24.1).
--
-- Contexto (evolução multi-tenant):
--   - A migration 2.1 semeava categorias de sistema SEM club_id (seed global)
--     e criava o índice único GLOBAL `categories_kind_name_unique` sobre
--     (kind, lower(name)).
--   - A migration 2.16 adicionou `club_id NOT NULL` em `categories` (e já
--     remove o seed global com `delete from public.categories;` antes do ALTER,
--     para o ALTER rodar numa base limpa).
--
-- Esta migration faz duas coisas:
--   1) Corrige a UNICIDADE para ser POR CLUBE: o índice global (kind, lower(name))
--      impediria dois futebóis de terem, por exemplo, a categoria "Outros".
--      Trocamos por (club_id, kind, lower(name)) — nome único por tipo DENTRO
--      de cada clube.
--   2) Define a função reutilizável `public.seed_club_categories(uuid)` que
--      insere as categorias de sistema padrão para um clube. É chamada na
--      criação do clube (tarefa 20.1) e no seed (24.1), substituindo o antigo
--      seed global da migration 2.1.

-- =====================================================================
-- 1) Unicidade por clube
-- =====================================================================
-- Remove o índice único global herdado da migration 2.1 (inadequado em
-- multi-tenant: forçava nome único entre TODOS os clubes).
drop index if exists public.categories_kind_name_unique;

-- Nome único por tipo DENTRO de cada clube (case-insensitive).
create unique index if not exists categories_club_kind_name_unique
  on public.categories (club_id, kind, lower(name));

comment on index public.categories_club_kind_name_unique is
  'Nome de categoria único por tipo dentro de cada futebol (Req 3.3). Substitui o índice global categories_kind_name_unique da migration 2.1.';

-- =====================================================================
-- 2) Semeadura das categorias de sistema por clube
-- =====================================================================
-- Insere as categorias padrão (is_system = true) para o clube informado.
-- Idempotente via `on conflict (club_id, kind, lower(name)) do nothing`,
-- apoiada no índice criado acima — chamar duas vezes para o mesmo clube não
-- duplica categorias.
--
-- Despesa: Quadra, Bolas, Coletes, Arbitragem, Goleiro, Água/Gelo,
--          Confraternização, Outros
-- Receita: Mensalidade, Avulso, Multa, Doação, Vaquinha, Outros
-- (mesmos nomes/ordem do antigo seed global da migration 2.1.)
create or replace function public.seed_club_categories(p_club_id uuid)
returns void
language sql
as $$
  insert into public.categories (club_id, kind, name, sort_order, is_system) values
    (p_club_id, 'despesa', 'Quadra',           1, true),
    (p_club_id, 'despesa', 'Bolas',            2, true),
    (p_club_id, 'despesa', 'Coletes',          3, true),
    (p_club_id, 'despesa', 'Arbitragem',       4, true),
    (p_club_id, 'despesa', 'Goleiro',          5, true),
    (p_club_id, 'despesa', 'Água/Gelo',        6, true),
    (p_club_id, 'despesa', 'Confraternização', 7, true),
    (p_club_id, 'despesa', 'Outros',           8, true),
    (p_club_id, 'receita', 'Mensalidade',      1, true),
    (p_club_id, 'receita', 'Avulso',           2, true),
    (p_club_id, 'receita', 'Multa',            3, true),
    (p_club_id, 'receita', 'Doação',           4, true),
    (p_club_id, 'receita', 'Vaquinha',         5, true),
    (p_club_id, 'receita', 'Outros',           6, true)
  on conflict (club_id, kind, lower(name)) do nothing;
$$;

comment on function public.seed_club_categories(uuid) is
  'Semeia as categorias de sistema padrão (is_system=true) para o futebol informado (Req 3.3, 9.2). Idempotente. Chamada em createClub (tarefa 20.1) e no seed (24.1); substitui o seed global da migration 2.1.';
