-- Migration: views agregadas dos dashboards (tarefa 2.5)
-- Views: v_monthly_summary, v_category_breakdown, v_balance_history, v_delinquency_rate
-- Requisitos: 8.1, 8.2, 8.3, 8.4, 8.8
--
-- Visão geral (design.md "Views agregadas (dashboards)"):
--   Os dashboards consultam SOMENTE estas views. Elas devolvem números
--   agregados do caixa e NÃO expõem a identidade financeira individual de
--   terceiros (nada de player_id, nome ou valor por jogador aqui).
--
-- Convenções herdadas do modelo de dados:
--   - dinheiro sempre em centavos (integer); somas em bigint para evitar overflow.
--   - mês no formato 'YYYY-MM' via to_char(data, 'YYYY-MM').
--   - apenas registros não excluídos (soft delete): deleted_at is null.
--
-- security_invoker (design.md): as views são criadas com
-- security_invoker = true para que as policies RLS das tabelas-base sejam
-- avaliadas sob o papel do usuário que consulta a view, e não do dono (owner)
-- da view. Como a tarefa 2.6 concede SELECT nas views a qualquer usuário
-- autenticado (dados agregados), o acesso agregado é liberado enquanto as
-- tabelas-base permanecem restritas. security_invoker exige Postgres 15+
-- (padrão no Supabase).
--
-- GRANTs: o SELECT para o papel `authenticated` é concedido na migration 2.6,
-- junto com as policies de RLS. Aqui apenas definimos as views.

-- =====================================================================
-- v_monthly_summary — por mês (Req 8.1, 8.2)
-- Soma de receitas, soma de despesas e resultado (receitas - despesas)
-- por período YYYY-MM. Base dos cards "receitas/despesas do mês" e do
-- gráfico receitas vs despesas (12 meses).
-- =====================================================================
create or replace view public.v_monthly_summary
with (security_invoker = true) as
select
  to_char(t.occurred_on, 'YYYY-MM')                                       as month,
  coalesce(sum(t.amount_cents) filter (where t.kind = 'receita'), 0)::bigint as income_cents,
  coalesce(sum(t.amount_cents) filter (where t.kind = 'despesa'), 0)::bigint as expense_cents,
  (
    coalesce(sum(t.amount_cents) filter (where t.kind = 'receita'), 0)
    - coalesce(sum(t.amount_cents) filter (where t.kind = 'despesa'), 0)
  )::bigint                                                               as result_cents
from public.transactions t
where t.deleted_at is null
group by to_char(t.occurred_on, 'YYYY-MM');

comment on view public.v_monthly_summary is
  'Agregado por mês (YYYY-MM): receitas, despesas e resultado em centavos. Apenas transações não excluídas. SELECT liberado a usuários autenticados via policy na tarefa 2.6 (Req 8.1, 8.2).';

-- =====================================================================
-- v_category_breakdown — por mês e categoria (Req 8.3)
-- Soma de despesas (kind = 'despesa') agrupada por mês e categoria.
-- Base do gráfico de despesas por categoria (mês e acumulado no ano).
-- Junta a categories apenas para o nome/tipo da categoria — nunca jogador.
-- =====================================================================
create or replace view public.v_category_breakdown
with (security_invoker = true) as
select
  to_char(t.occurred_on, 'YYYY-MM')      as month,
  t.category_id                          as category_id,
  c.name                                 as category_name,
  c.kind                                 as category_kind,
  coalesce(sum(t.amount_cents), 0)::bigint as expense_cents
from public.transactions t
join public.categories c on c.id = t.category_id
where t.deleted_at is null
  and t.kind = 'despesa'
group by to_char(t.occurred_on, 'YYYY-MM'), t.category_id, c.name, c.kind;

comment on view public.v_category_breakdown is
  'Despesas somadas por mês (YYYY-MM) e categoria. Apenas transações não excluídas do tipo despesa. SELECT liberado a usuários autenticados via policy na tarefa 2.6 (Req 8.3).';

-- =====================================================================
-- v_balance_history — saldo acumulado ao longo do tempo (Req 8.4)
-- saldo = settings.initial_balance_cents + soma corrida de
-- (receitas - despesas) por mês, ordenada por mês (window function).
-- Base do gráfico de evolução do saldo e do card de saldo atual.
--
-- Partimos do v_monthly_summary (resultado por mês) e aplicamos uma soma
-- de janela (sum over order by month) para obter o saldo acumulado. O
-- saldo inicial do caixa é lido como subconsulta escalar sobre o singleton
-- settings (id=1); coalesce(..., 0) protege o caso de settings ainda sem
-- linha, sem jamais descartar meses (uma subconsulta escalar nula vira 0).
-- =====================================================================
create or replace view public.v_balance_history
with (security_invoker = true) as
select
  ms.month                                                                     as month,
  ms.result_cents                                                              as result_cents,
  (
    coalesce((select s.initial_balance_cents from public.settings s where s.id = 1), 0)
    + sum(ms.result_cents) over (order by ms.month rows between unbounded preceding and current row)
  )::bigint                                                                    as balance_cents
from public.v_monthly_summary ms;

comment on view public.v_balance_history is
  'Saldo acumulado por mês = saldo inicial (settings) + soma corrida de (receitas - despesas). Base da evolução do saldo e do saldo atual (Req 8.4). SELECT liberado a usuários autenticados via policy na tarefa 2.6.';

-- =====================================================================
-- v_delinquency_rate — % de adimplência por mês (Req 8.1 card de adimplência, 8.8)
-- Agrupa cobranças pelo período da mensalidade quando houver, senão pelo
-- mês do vencimento (to_char(due_date, 'YYYY-MM')).
--   due  = cobranças "devidas" = não excluídas e não canceladas.
--   paid = subconjunto com status = 'paga'.
--   rate = paid / due * 100, com guarda contra divisão por zero (NULLIF).
-- Devolve apenas contagens e o percentual — nenhum dado individual de jogador.
-- =====================================================================
create or replace view public.v_delinquency_rate
with (security_invoker = true) as
select
  coalesce(ch.period, to_char(ch.due_date, 'YYYY-MM'))                 as month,
  count(*) filter (where ch.status = 'paga')::bigint                   as paid_count,
  count(*)::bigint                                                     as due_count,
  round(
    100.0 * count(*) filter (where ch.status = 'paga')
    / nullif(count(*), 0)
  , 2)                                                                 as rate_percent
from public.charges ch
where ch.deleted_at is null
  and ch.status <> 'cancelada'
group by coalesce(ch.period, to_char(ch.due_date, 'YYYY-MM'));

comment on view public.v_delinquency_rate is
  'Adimplência por mês (YYYY-MM): pagas / devidas * 100, com guarda de divisão por zero. Devidas = cobranças não excluídas e não canceladas. Apenas agregados, sem dados individuais (Req 8.1 adimplência, 8.8). SELECT liberado a usuários autenticados via policy na tarefa 2.6.';
