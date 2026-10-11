-- Migration: tornar transactions.created_by NULLABLE (tarefa 7.2)
-- Requisitos: 4.2, 4.3, 13.4
--
-- Contexto:
--   Os lançamentos (transactions) nascem, em regra, de uma ação humana
--   (admin/tesoureiro), por isso created_by era NOT NULL -> profiles.id.
--
--   A partir das despesas recorrentes (Req 4.2), o cron
--   `/api/cron/gerar-recorrentes` gera lançamentos automaticamente, SEM uma
--   sessão de usuário associada. Esses lançamentos "de sistema" não têm um
--   ator humano para preencher created_by.
--
-- Decisão (design.md "Crons — decisão"):
--   O cron roda com a service role (contorna RLS) e NÃO possui sessão. Em vez
--   de inventar/forçar um perfil-robô artificial, tornamos created_by NULLABLE:
--   created_by = null identifica, de forma honesta, uma linha gerada pelo
--   sistema (origem: recurring_id para recorrentes).
--
--   A FK para profiles(id) é preservada; apenas a obrigatoriedade é removida.
--   Lançamentos criados por humanos continuam preenchendo created_by
--   normalmente.

alter table public.transactions
  alter column created_by drop not null;

comment on column public.transactions.created_by is
  'Autor humano do lançamento (profiles.id). NULL quando gerado pelo sistema (ex.: cron de despesas recorrentes, Req 4.2).';
