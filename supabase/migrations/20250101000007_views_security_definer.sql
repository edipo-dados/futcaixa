-- Migration: views agregadas rodando como DEFINER (correção da tarefa 2.6)
-- Views: v_monthly_summary, v_category_breakdown, v_balance_history, v_delinquency_rate
-- Requisitos: 8.1, 8.8
--
-- PORQUÊ DESTA MIGRATION (defeito de correção identificado na tarefa 2.6)
-- ---------------------------------------------------------------------
-- A migration 2.5 criou estas quatro views agregadas com
-- `security_invoker = true`. A migration 2.6 habilitou RLS nas tabelas-base,
-- onde o papel `jogador` NÃO tem acesso a `transactions` e só enxerga as
-- próprias `charges`. Com security_invoker = true, quando um jogador consulta
-- estas views a RLS das tabelas-base é avaliada SOB O PAPEL DO JOGADOR —
-- resultado: as views voltam vazias/parciais para ele.
--
-- Isso contradiz os requisitos 8.1 e 8.8 e o design.md ("Views agregadas"):
-- o jogador DEVE enxergar os cards/gráficos AGREGADOS do caixa (números a
-- nível de caixa), ao mesmo tempo em que NUNCA vê linhas financeiras
-- individuais de terceiros. O design.md diz explicitamente que as views
-- liberam SELECT a qualquer usuário autenticado (dados agregados) enquanto as
-- tabelas-base permanecem restritas.
--
-- CORREÇÃO: recriar as quatro views com `security_invoker = false` (modo
-- DEFINER). Assim elas executam com os privilégios do dono da view, ignorando
-- a RLS das tabelas-base, e devolvem os números agregados para todo usuário
-- autenticado (incluindo jogador) — enquanto as tabelas-base continuam
-- protegidas por RLS para qualquer acesso direto.
--
-- AUDITORIA DE VAZAMENTO DE IDENTIDADE (pré-requisito para rodar como definer)
-- ---------------------------------------------------------------------
-- Executar uma view como definer só é seguro se ela NÃO expuser identidade
-- financeira individual de terceiros (player_id, nome do jogador, ou valor por
-- jogador). As colunas de saída de cada view foram auditadas contra a
-- definição da migration 2.5:
--   * v_monthly_summary   -> month, income_cents, expense_cents, result_cents
--                            (agregado por mês; sem jogador)                [OK]
--   * v_category_breakdown-> month, category_id, category_name, category_kind,
--                            expense_cents (agregado por mês+categoria;
--                            identidade de CATEGORIA, não de jogador)       [OK]
--   * v_balance_history   -> month, result_cents, balance_cents
--                            (saldo acumulado por mês; sem jogador)         [OK]
--   * v_delinquency_rate  -> month, paid_count, due_count, rate_percent
--                            (contagens e percentual por mês; sem jogador)  [OK]
-- Nenhuma das quatro expõe player_id, nome ou valor por jogador — todas são
-- agregados puros a nível de caixa. Por isso todas podem rodar como definer.
--
-- ESTILO FORWARD-ONLY: as migrations 2.5 e 2.6 já aplicadas NÃO são editadas.
-- As definições abaixo são idênticas às da 2.5, mudando apenas o
-- security_invoker de true para false. `create or replace view` preserva os
-- GRANTs existentes; ainda assim o SELECT a `authenticated` é reconcedido ao
-- final por idempotência.

-- =====================================================================
-- v_monthly_summary — por mês (Req 8.1, 8.2)
-- =====================================================================
create or replace view public.v_monthly_summary
with (security_invoker = false) as
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
  'Agregado por mês (YYYY-MM): receitas, despesas e resultado em centavos. Apenas transações não excluídas. security_invoker=false (definer) para liberar o agregado a todo usuário autenticado enquanto transactions permanece RLS-restrita (Req 8.1, 8.8).';

-- =====================================================================
-- v_category_breakdown — por mês e categoria (Req 8.3)
-- =====================================================================
create or replace view public.v_category_breakdown
with (security_invoker = false) as
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
  'Despesas somadas por mês (YYYY-MM) e categoria. Apenas transações não excluídas do tipo despesa. security_invoker=false (definer) para liberar o agregado a todo usuário autenticado enquanto transactions permanece RLS-restrita (Req 8.3, 8.8).';

-- =====================================================================
-- v_balance_history — saldo acumulado ao longo do tempo (Req 8.4)
-- =====================================================================
create or replace view public.v_balance_history
with (security_invoker = false) as
select
  ms.month                                                                     as month,
  ms.result_cents                                                              as result_cents,
  (
    coalesce((select s.initial_balance_cents from public.settings s where s.id = 1), 0)
    + sum(ms.result_cents) over (order by ms.month rows between unbounded preceding and current row)
  )::bigint                                                                    as balance_cents
from public.v_monthly_summary ms;

comment on view public.v_balance_history is
  'Saldo acumulado por mês = saldo inicial (settings) + soma corrida de (receitas - despesas). security_invoker=false (definer) para liberar o agregado a todo usuário autenticado enquanto as tabelas-base permanecem RLS-restritas (Req 8.4, 8.8).';

-- =====================================================================
-- v_delinquency_rate — % de adimplência por mês (Req 8.1 adimplência, 8.8)
-- =====================================================================
create or replace view public.v_delinquency_rate
with (security_invoker = false) as
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
  'Adimplência por mês (YYYY-MM): pagas / devidas * 100, com guarda de divisão por zero. Devidas = cobranças não excluídas e não canceladas. Apenas agregados, sem dados individuais. security_invoker=false (definer) para liberar o agregado a todo usuário autenticado enquanto charges permanece RLS-restrita (Req 8.1 adimplência, 8.8).';

-- =====================================================================
-- Reconceder SELECT a `authenticated` (idempotente).
-- GRANTs persistem através de `create or replace view`, mas reconceder aqui é
-- seguro e deixa a migration autossuficiente.
-- =====================================================================
grant select on public.v_monthly_summary    to authenticated;
grant select on public.v_category_breakdown  to authenticated;
grant select on public.v_balance_history     to authenticated;
grant select on public.v_delinquency_rate    to authenticated;
