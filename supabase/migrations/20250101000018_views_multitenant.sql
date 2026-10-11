-- Migration: índice único de mensalidade por clube + views agregadas por clube (tarefa 16.6)
-- Índice: charges_monthly_club_player_period_unique (substitui charges_monthly_player_period_unique)
-- Views:  v_monthly_summary, v_category_breakdown, v_balance_history, v_delinquency_rate, v_recent_expenses
-- Requisitos: 11.2, 14.2, 14.3, 14.4, 14.8
--
-- CONTEXTO (evolução multi-tenant): a migration 2.16 carregou `club_id` em
-- TODAS as tabelas de domínio (players, categories, transactions, charges,
-- payment_proofs, settings, ...) e converteu `settings` de singleton (id=1
-- global) para "uma linha por clube" (club_id UNIQUE). Esta migration ajusta
-- os dois artefatos que ainda assumiam o mundo single-tenant:
--   1) o índice único parcial de idempotência das mensalidades em `charges`,
--      que precisa passar a valer POR CLUBE; e
--   2) as views agregadas dos dashboards, que precisam PROJETAR `club_id`
--      para que os loaders filtrem pelo futebol ativo (`where club_id = <ativo>`).
--
-- VIEWS AGORA ESCOPADAS AO CLUBE (design.md "Views agregadas (dashboards)")
-- ---------------------------------------------------------------------
-- Cada view passa a carregar `club_id` na projeção e a agregar POR `club_id`.
-- Os dashboards consultam SOMENTE estas views e SEMPRE filtram pelo `club_id`
-- do futebol ativo — nunca misturando dados de clubes diferentes nem expondo
-- identidade financeira individual de terceiros (nada de player_id/nome/valor
-- por jogador aqui).
--
-- Elas permanecem `security_invoker = false` (DEFINER), exatamente como nas
-- migrations 2.7 e 2.10: executam com os privilégios do dono da view e
-- ignoram a RLS das tabelas-base, de modo que todo usuário autenticado leia os
-- AGREGADOS do seu clube enquanto as tabelas-base continuam RLS-restritas para
-- acesso direto. A RLS por tenant/papel das tabelas-base é tratada na seção 17;
-- estas views definer seguem sendo o caminho de leitura dos agregados, e o
-- isolamento entre clubes no dashboard é garantido pelo `where club_id = <ativo>`
-- que o loader sempre aplica.
--
-- ESTILO FORWARD-ONLY: migration aditiva; não edita migrations anteriores.
-- `create or replace view` preserva os GRANTs existentes; ainda assim o SELECT
-- a `authenticated` é reconcedido ao final por idempotência.

-- =====================================================================
-- 1) Idempotência da mensalidade AGORA por clube (Req 14.8)
-- O índice da migration 2.3 garantia "no máximo uma mensalidade ativa por
-- jogador e período" em (player_id, period). No modelo multi-tenant a
-- unicidade deve ser POR CLUBE: (club_id, player_id, period). Trocamos o
-- índice parcial antigo pelo novo (ambos só valem para kind='mensalidade' e
-- cobranças não excluídas, deixando avulsos/multas/vaquinhas livres).
-- =====================================================================
drop index if exists public.charges_monthly_player_period_unique;

create unique index if not exists charges_monthly_club_player_period_unique
  on public.charges (club_id, player_id, period)
  where kind = 'mensalidade' and deleted_at is null;

-- =====================================================================
-- =====================================================================
-- As views abaixo MUDAM a estrutura de colunas (passam a projetar club_id como
-- primeira coluna). `create or replace view` NÃO permite renomear/reordenar
-- colunas de uma view existente (ERRO 42P16). Por isso derrubamos as versões
-- single-tenant (migrations 2.5 e 2.10) antes de recriá-las. CASCADE remove
-- dependências; os GRANTs a `authenticated` são reconcedidos ao final.
-- =====================================================================
drop view if exists public.v_monthly_summary    cascade;
drop view if exists public.v_category_breakdown  cascade;
drop view if exists public.v_balance_history     cascade;
drop view if exists public.v_delinquency_rate    cascade;
drop view if exists public.v_recent_expenses     cascade;

-- v_monthly_summary — por clube e mês (Req 14.2)
-- Projeta club_id e agrupa por (club_id, mês). O loader filtra pelo clube
-- ativo. Base dos cards "receitas/despesas do mês" e do gráfico receitas vs
-- despesas (12 meses) do futebol ativo.
-- =====================================================================
create or replace view public.v_monthly_summary
with (security_invoker = false) as
select
  t.club_id                                                               as club_id,
  to_char(t.occurred_on, 'YYYY-MM')                                       as month,
  coalesce(sum(t.amount_cents) filter (where t.kind = 'receita'), 0)::bigint as income_cents,
  coalesce(sum(t.amount_cents) filter (where t.kind = 'despesa'), 0)::bigint as expense_cents,
  (
    coalesce(sum(t.amount_cents) filter (where t.kind = 'receita'), 0)
    - coalesce(sum(t.amount_cents) filter (where t.kind = 'despesa'), 0)
  )::bigint                                                               as result_cents
from public.transactions t
where t.deleted_at is null
group by t.club_id, to_char(t.occurred_on, 'YYYY-MM');

comment on view public.v_monthly_summary is
  'Agregado por clube e mês (YYYY-MM): receitas, despesas e resultado em centavos. Apenas transações não excluídas. Carrega club_id para o loader filtrar pelo futebol ativo. security_invoker=false (definer): libera o agregado a todo usuário autenticado enquanto transactions permanece RLS-restrita (Req 14.2).';

-- =====================================================================
-- v_category_breakdown — por clube, mês e categoria (Req 14.3)
-- Projeta club_id e agrupa por (club_id, mês, categoria). Junta a categories
-- apenas para o nome/tipo da categoria — nunca jogador.
-- =====================================================================
create or replace view public.v_category_breakdown
with (security_invoker = false) as
select
  t.club_id                              as club_id,
  to_char(t.occurred_on, 'YYYY-MM')      as month,
  t.category_id                          as category_id,
  c.name                                 as category_name,
  c.kind                                 as category_kind,
  coalesce(sum(t.amount_cents), 0)::bigint as expense_cents
from public.transactions t
join public.categories c on c.id = t.category_id
where t.deleted_at is null
  and t.kind = 'despesa'
group by t.club_id, to_char(t.occurred_on, 'YYYY-MM'), t.category_id, c.name, c.kind;

comment on view public.v_category_breakdown is
  'Despesas somadas por clube, mês (YYYY-MM) e categoria. Apenas transações não excluídas do tipo despesa. Carrega club_id para o loader filtrar pelo futebol ativo. security_invoker=false (definer): libera o agregado a todo usuário autenticado enquanto transactions permanece RLS-restrita (Req 14.3).';

-- =====================================================================
-- v_balance_history — saldo acumulado por clube (Req 14.4)
-- AGORA É POR CLUBE. Para cada futebol:
--   saldo = settings.initial_balance_cents DAQUELE clube
--           + soma corrida de (receitas - despesas) do clube, por mês.
--
-- Com a conversão do singleton de settings (migration 2.16), não existe mais
-- a linha global id=1: cada clube tem a SUA linha de settings (club_id UNIQUE).
-- Por isso o saldo inicial deixa de ser subconsulta escalar sobre id=1 e passa
-- a ser um JOIN de v_monthly_summary (ms) com settings (s) em
-- s.club_id = ms.club_id. A soma de janela é PARTICIONADA por ms.club_id e
-- ordenada por ms.month, de modo que o acumulado NÃO vaze de um clube para
-- outro. coalesce(..., 0) protege clube sem linha de settings (saldo inicial 0).
-- =====================================================================
create or replace view public.v_balance_history
with (security_invoker = false) as
select
  ms.club_id                                                                   as club_id,
  ms.month                                                                     as month,
  ms.result_cents                                                              as result_cents,
  (
    coalesce(s.initial_balance_cents, 0)
    + sum(ms.result_cents) over (
        partition by ms.club_id
        order by ms.month
        rows between unbounded preceding and current row
      )
  )::bigint                                                                    as balance_cents
from public.v_monthly_summary ms
left join public.settings s on s.club_id = ms.club_id;

comment on view public.v_balance_history is
  'Saldo acumulado por clube e mês = saldo inicial do clube (settings) + soma corrida de (receitas - despesas) particionada por club_id. Carrega club_id para o loader filtrar pelo futebol ativo. security_invoker=false (definer): libera o agregado a todo usuário autenticado enquanto as tabelas-base permanecem RLS-restritas (Req 14.4).';

-- =====================================================================
-- v_delinquency_rate — % de adimplência por clube e mês (Req 14.8)
-- Projeta club_id e agrupa por (club_id, mês), usando o período da
-- mensalidade quando houver, senão o mês do vencimento. Devolve apenas
-- contagens e percentual — nenhum dado individual de jogador.
-- =====================================================================
create or replace view public.v_delinquency_rate
with (security_invoker = false) as
select
  ch.club_id                                                          as club_id,
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
group by ch.club_id, coalesce(ch.period, to_char(ch.due_date, 'YYYY-MM'));

comment on view public.v_delinquency_rate is
  'Adimplência por clube e mês (YYYY-MM): pagas / devidas * 100, com guarda de divisão por zero. Devidas = cobranças não excluídas e não canceladas. Carrega club_id para o loader filtrar pelo futebol ativo. Apenas agregados, sem dados individuais. security_invoker=false (definer): libera o agregado a todo usuário autenticado enquanto charges permanece RLS-restrita (Req 14.8).';

-- =====================================================================
-- v_recent_expenses — últimas despesas (transparência) por clube (Req 14.2)
-- Projeta club_id para que o loader filtre pelo futebol ativo. Mantém a
-- ordenação da mais recente para a mais antiga e expõe apenas campos não
-- sensíveis (data, valor, descrição, nome da categoria, caminho do
-- comprovante) — NUNCA player_id ou nome de jogador. O LIMITE de exibição
-- continua aplicado em tempo de consulta pelo loader do dashboard.
-- =====================================================================
create or replace view public.v_recent_expenses
with (security_invoker = false) as
select
  t.id                 as id,
  t.club_id            as club_id,
  t.occurred_on        as occurred_on,
  t.amount_cents       as amount_cents,
  t.description        as description,
  c.name               as category_name,
  t.proof_path         as proof_path
from public.transactions t
join public.categories c on c.id = t.category_id
where t.deleted_at is null
  and t.kind = 'despesa'
order by t.occurred_on desc, t.created_at desc;

comment on view public.v_recent_expenses is
  'Últimas despesas a nível de caixa para transparência no dashboard, por clube (Req 14.2). Carrega club_id para o loader filtrar pelo futebol ativo. Expõe apenas campos não sensíveis (data, valor, descrição, nome da categoria, caminho do comprovante) — NUNCA player_id ou nome de jogador. security_invoker=false (definer): libera a lista a todo usuário autenticado enquanto transactions permanece RLS-restrita. proof_path é apenas o caminho no bucket privado; a leitura do arquivo exige URL assinada gerada no servidor (Req 3.7/11.2).';

-- =====================================================================
-- Reconceder SELECT a `authenticated` (idempotente), igual às migrations
-- 2.7 e 2.10. GRANTs persistem através de `create or replace view`, mas
-- reconceder aqui deixa a migration autossuficiente.
-- =====================================================================
grant select on public.v_monthly_summary     to authenticated;
grant select on public.v_category_breakdown   to authenticated;
grant select on public.v_balance_history      to authenticated;
grant select on public.v_delinquency_rate     to authenticated;
grant select on public.v_recent_expenses      to authenticated;
