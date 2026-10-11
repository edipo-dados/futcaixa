-- Migration: v_balance_history mostra o saldo inicial mesmo SEM transações
-- View: v_balance_history (recriada)
-- Requisitos: 8.1, 14.4
--
-- PROBLEMA CORRIGIDO
-- ------------------------------------------------------------------
-- A versão da migration 2.18 montava o saldo acumulado a partir de
-- `v_monthly_summary` (ms), que só tem LINHAS para meses com transações:
--
--     from v_monthly_summary ms
--     left join settings s on s.club_id = ms.club_id
--
-- Consequência: um futebol recém-criado, cujo presidente informou um saldo
-- inicial (settings.initial_balance_cents) mas ainda NÃO lançou nada, não
-- gerava nenhuma linha em v_monthly_summary e, portanto, nenhuma linha em
-- v_balance_history. O loader `getCurrentBalanceCents` (que pega a linha com
-- maior `month <= período atual`) não encontrava nada e devolvia 0 — o
-- dashboard mostrava R$ 0,00 em vez do saldo trazido. Esse é exatamente o
-- cenário "comecei a usar hoje e trouxe R$ 5.000,00 de saldo".
--
-- CORREÇÃO (âncora no MÊS DE CRIAÇÃO DO CLUBE)
-- ------------------------------------------------------------------
-- Garantimos que todo clube tenha, no mínimo, uma linha-base no mês em que foi
-- criado (`clubs.created_at`), com result_cents = 0. O saldo acumulado desse
-- mês fica igual ao saldo inicial do clube. Assim:
--   - clube novo sem lançamentos → aparece 1 linha no mês de criação com
--     balance_cents = initial_balance_cents (o saldo trazido aparece no
--     dashboard imediatamente);
--   - clube com lançamentos → comportamento inalterado, pois o mês de criação
--     entra na soma corrida com resultado 0 (não altera o acumulado) e os
--     meses com transações seguem somando normalmente.
--
-- A base de meses passa a ser a UNIÃO de:
--   (a) meses com transações, vindos de v_monthly_summary; e
--   (b) o mês de criação de cada clube (âncora), com resultado 0.
-- Para um mês que exista em ambos, somam-se os resultados (o mês de criação
-- contribui com 0, então o valor real do mês prevalece).
--
-- A soma de janela continua PARTICIONADA por club_id e ordenada por month, de
-- modo que o acumulado nunca vaze de um clube para outro. O saldo inicial é
-- somado ao acumulado via join em settings (coalesce 0 protege clube sem
-- settings).
--
-- ESTILO FORWARD-ONLY: migration aditiva; não edita migrations anteriores.
-- `create or replace view` preserva colunas/GRANTs (mesma assinatura de
-- colunas da 2.18: club_id, month, result_cents, balance_cents).

create or replace view public.v_balance_history
with (security_invoker = false) as
with months as (
  -- (a) meses com transações (resultado real por mês)
  select
    ms.club_id     as club_id,
    ms.month       as month,
    ms.result_cents as result_cents
  from public.v_monthly_summary ms

  union all

  -- (b) âncora: mês de criação do clube, com resultado 0. Garante uma
  -- linha-base por clube mesmo sem nenhuma transação.
  select
    c.id                              as club_id,
    to_char(c.created_at, 'YYYY-MM')  as month,
    0::bigint                         as result_cents
  from public.clubs c
  where c.deleted_at is null
),
monthly as (
  -- Consolida (a)+(b) por clube e mês: no mês de criação sem transações o
  -- resultado é 0; quando houver transações nesse mesmo mês, elas prevalecem
  -- (a âncora contribui com 0).
  select
    m.club_id                      as club_id,
    m.month                        as month,
    coalesce(sum(m.result_cents), 0)::bigint as result_cents
  from months m
  group by m.club_id, m.month
)
select
  monthly.club_id                                                              as club_id,
  monthly.month                                                                as month,
  monthly.result_cents                                                         as result_cents,
  (
    coalesce(s.initial_balance_cents, 0)
    + sum(monthly.result_cents) over (
        partition by monthly.club_id
        order by monthly.month
        rows between unbounded preceding and current row
      )
  )::bigint                                                                    as balance_cents
from monthly
left join public.settings s on s.club_id = monthly.club_id;

comment on view public.v_balance_history is
  'Saldo acumulado por clube e mês = saldo inicial do clube (settings) + soma corrida de (receitas - despesas) particionada por club_id. A base de meses é a união dos meses com transações (v_monthly_summary) com o mês de criação do clube (âncora com resultado 0), de modo que um futebol novo com saldo inicial e sem lançamentos ainda exiba o saldo trazido no mês de criação (Req 8.1/14.4). security_invoker=false (definer): libera o agregado a todo usuário autenticado enquanto as tabelas-base permanecem RLS-restritas.';

grant select on public.v_balance_history to authenticated;
