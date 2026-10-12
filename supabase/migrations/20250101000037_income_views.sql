-- Migration: views de RECEITA para o dashboard (detalhamento de entradas)
-- Views: v_income_breakdown (receita por categoria), v_recent_incomes (últimas receitas)
-- Requisitos: 8.1/8.3/8.7 (transparência das entradas)
--
-- CONTEXTO: o dashboard já detalha DESPESAS por categoria (v_category_breakdown)
-- e lista as últimas despesas (v_recent_expenses), mas as RECEITAS só apareciam
-- como total do mês (v_monthly_summary.income_cents). Estas duas views espelham
-- as de despesa para o lado da receita, permitindo quebrar entradas por
-- categoria (mensalidade, avulso, doação, vaquinha...) e listar as últimas
-- entradas para transparência.
--
-- Mesmo padrão de segurança das demais views do dashboard: security_invoker =
-- false (DEFINER) + grant select a authenticated. Projetam club_id para o
-- loader filtrar pelo futebol ativo (o isolamento entre clubes vem do
-- `where club_id = <ativo>` aplicado em cada loader).
--
-- Forward-only. `create or replace view` recria sem perder GRANTs; reconcedemos
-- ao final por idempotência.

-- =====================================================================
-- v_income_breakdown — RECEITA por clube, mês e categoria (espelho de
-- v_category_breakdown, trocando despesa por receita).
-- =====================================================================
create or replace view public.v_income_breakdown
with (security_invoker = false) as
select
  t.club_id                                as club_id,
  to_char(t.occurred_on, 'YYYY-MM')        as month,
  t.category_id                            as category_id,
  c.name                                   as category_name,
  c.kind                                   as category_kind,
  coalesce(sum(t.amount_cents), 0)::bigint as income_cents
from public.transactions t
join public.categories c on c.id = t.category_id
where t.deleted_at is null
  and t.kind = 'receita'
group by t.club_id, to_char(t.occurred_on, 'YYYY-MM'), t.category_id, c.name, c.kind;

comment on view public.v_income_breakdown is
  'Receitas somadas por clube, mês (YYYY-MM) e categoria. Apenas transações não excluídas do tipo receita. Carrega club_id para o loader filtrar pelo futebol ativo. security_invoker=false (definer): libera o agregado a todo usuário autenticado enquanto transactions permanece RLS-restrita.';

-- =====================================================================
-- v_recent_incomes — últimas receitas (transparência), por clube.
-- Espelha v_recent_expenses. Expõe apenas campos não sensíveis (data, valor,
-- descrição, nome da categoria) — NUNCA player_id ou nome de jogador. O
-- comprovante (proof_path) não se aplica a receitas aqui.
-- =====================================================================
create or replace view public.v_recent_incomes
with (security_invoker = false) as
select
  t.id           as id,
  t.club_id      as club_id,
  t.occurred_on  as occurred_on,
  t.amount_cents as amount_cents,
  t.description  as description,
  c.name         as category_name
from public.transactions t
join public.categories c on c.id = t.category_id
where t.deleted_at is null
  and t.kind = 'receita'
order by t.occurred_on desc, t.created_at desc;

comment on view public.v_recent_incomes is
  'Últimas receitas a nível de caixa para transparência no dashboard, por clube. Carrega club_id para o loader filtrar pelo futebol ativo. Expõe apenas campos não sensíveis (data, valor, descrição, nome da categoria) — NUNCA player_id ou nome de jogador. security_invoker=false (definer).';

grant select on public.v_income_breakdown to authenticated;
grant select on public.v_recent_incomes  to authenticated;
