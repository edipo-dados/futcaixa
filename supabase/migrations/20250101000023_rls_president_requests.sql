-- Migration: RLS de plataforma — solicitações de presidente (tarefa 17.4)
-- Requisitos: 2.5, 2.7
--
-- Contexto (design.md "Admin de plataforma"): president_requests (migration
-- 2.14) é a trilha de solicitações para virar presidente de futebol. É uma
-- tabela de PLATAFORMA (não tem club_id): cada usuário enxerga apenas o PRÓPRIO
-- histórico; a visão de solicitações de TERCEIROS e a revisão (aprovar/recusar)
-- são exclusivas do system_admin (Req 2.5/2.7).
--
-- Regras:
--   SELECT: o dono (user_id = auth.uid()) OU system_admin.
--   INSERT: o próprio usuário abre a sua solicitação (user_id = auth.uid(),
--           status 'pendente'). O system_admin também pode inserir (operação
--           administrativa). A promoção de profiles.president_status e a
--           gravação de reviewed_by/reviewed_at ficam a cargo da aplicação
--           (tarefas 19.1/19.2), que roda server-side.
--   UPDATE: apenas system_admin (revisão: status/reviewed_by/reviewed_at/note).
--   DELETE: ninguém via RLS (trilha de auditoria é imutável para usuários);
--           limpezas administrativas usam a service role, que ignora RLS.
--
-- Idempotência: habilita RLS (idempotente) e DROP ... IF EXISTS antes do CREATE.

alter table public.president_requests enable row level security;

-- SELECT: dono ou system_admin.
drop policy if exists president_requests_select on public.president_requests;
create policy president_requests_select on public.president_requests
  for select to authenticated
  using (user_id = auth.uid() or public.is_system_admin());

-- INSERT: o próprio usuário abrindo o pedido (pendente) ou system_admin.
drop policy if exists president_requests_insert on public.president_requests;
create policy president_requests_insert on public.president_requests
  for insert to authenticated
  with check (
    public.is_system_admin()
    or (user_id = auth.uid() and status = 'pendente')
  );

-- UPDATE: apenas system_admin (revisão da solicitação).
drop policy if exists president_requests_update on public.president_requests;
create policy president_requests_update on public.president_requests
  for update to authenticated
  using (public.is_system_admin())
  with check (public.is_system_admin());
