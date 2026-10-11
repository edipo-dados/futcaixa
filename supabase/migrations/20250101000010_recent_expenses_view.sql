-- Migration: view de transparência das últimas despesas (tarefa 11.5)
-- View: v_recent_expenses
-- Requisitos: 8.7 (lista das últimas despesas com comprovante visível),
--             8.8 (jogador lê agregados/transparência sem tocar tabelas-base),
--             3.7 / 11.2 (comprovante em bucket privado via URL assinada)
--
-- PORQUÊ DESTA VIEW (transparência sem vazamento)
-- ---------------------------------------------------------------------
-- O Req 8.7 pede que o dashboard — visível a qualquer papel autenticado,
-- inclusive `jogador` — exiba a lista das ÚLTIMAS DESPESAS com comprovante
-- visível, para dar transparência à gestão do caixa.
--
-- Porém, a migration 2.6 (RLS) define que o papel `jogador` NÃO tem acesso
-- direto à tabela `transactions` (a policy transactions_manager_all libera
-- apenas admin/tesoureiro). Logo, uma leitura direta por um jogador voltaria
-- vazia. Esta view resolve isso do mesmo modo que as views de dashboard
-- (migration 2.7): roda como DEFINER (`security_invoker = false`), executando
-- com os privilégios do dono da view e ignorando a RLS da tabela-base, de modo
-- que todo usuário autenticado leia a lista — enquanto `transactions` continua
-- RLS-restrita para qualquer acesso DIRETO.
--
-- POR QUE ISSO NÃO VAZA IDENTIDADE FINANCEIRA DE TERCEIROS
-- ---------------------------------------------------------------------
-- O design.md ("Transparência sem vazamento") permite ao jogador ver
-- AGREGADOS do caixa e o PRÓPRIO extrato, mas nunca o detalhe financeiro
-- individual de OUTRO jogador. As despesas aqui expostas são despesas a nível
-- de CAIXA (Quadra, Goleiro, Bolas, Arbitragem, Água/Gelo...), não cobranças
-- por jogador. Por isso esta view:
--   * NÃO expõe `player_id` nem o nome do jogador (coluna deliberadamente
--     omitida), mantendo a lista a nível de caixa;
--   * expõe apenas campos não sensíveis: data, valor, descrição, nome da
--     categoria e o caminho do comprovante (`proof_path`).
--
-- SOBRE proof_path (comprovante)
-- ---------------------------------------------------------------------
-- `proof_path` é apenas o CAMINHO do objeto no bucket privado `proofs`
-- (migration 2.8), NUNCA uma URL pública. A visualização real do arquivo
-- continua exigindo uma URL assinada gerada no SERVIDOR (Req 3.7/11.2). Expor
-- o caminho aqui serve a dois propósitos: (1) indicar que existe comprovante
-- (ícone/botão "Ver comprovante") e (2) permitir que a server action de
-- transparência valide que o caminho pertence de fato a uma despesa desta view
-- antes de assinar — evitando que caminhos arbitrários do bucket sejam
-- assinados.
--
-- ESTILO FORWARD-ONLY: migration aditiva; não edita migrations anteriores.

-- =====================================================================
-- v_recent_expenses — últimas despesas (transparência) — Req 8.7
--
-- Expõe TODAS as despesas não excluídas (ordenadas da mais recente para a mais
-- antiga). O LIMITE de exibição (ex.: 10) é aplicado em tempo de consulta pelo
-- loader do dashboard — a view permanece genérica e reutilizável.
-- =====================================================================
create or replace view public.v_recent_expenses
with (security_invoker = false) as
select
  t.id                 as id,
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
  'Últimas despesas a nível de caixa para transparência no dashboard (Req 8.7). Expõe apenas campos não sensíveis (data, valor, descrição, nome da categoria, caminho do comprovante) — NUNCA player_id ou nome de jogador, pois são despesas de caixa, não cobranças individuais. security_invoker=false (definer) para liberar a lista a todo usuário autenticado (inclusive jogador, que não tem acesso direto a transactions) enquanto transactions permanece RLS-restrita (Req 8.7, 8.8). proof_path é apenas o caminho no bucket privado; a leitura do arquivo exige URL assinada gerada no servidor (Req 3.7/11.2).';

-- =====================================================================
-- SELECT liberado a todo usuário autenticado (dados de transparência a nível
-- de caixa, sem identidade individual de terceiros).
-- =====================================================================
grant select on public.v_recent_expenses to authenticated;
