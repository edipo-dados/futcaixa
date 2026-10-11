-- Migration: system_admin pode atualizar qualquer profiles (revisão de presidente)
-- Requisitos: 2.4, 2.5, 2.6, 17.3
--
-- PROBLEMA CORRIGIDO
-- ------------------------------------------------------------------
-- A única policy de UPDATE em `profiles` era `profiles_update_self`
-- (migration 20250101000020), que permite ao usuário atualizar apenas o PRÓPRIO
-- perfil (`id = auth.uid()`). A tela do system_admin "Solicitações de presidente"
-- (app/(admin)/admin/solicitacoes) aprova um pedido fazendo:
--
--     update profiles set president_status = 'aprovado' where id = <alvo>
--
-- Como o alvo NÃO é o próprio admin, a RLS filtra a linha e o UPDATE afeta ZERO
-- linhas — SEM erro. Resultado: clicar "Aprovar" não promovia o usuário a
-- presidente (president_status continuava 'pendente'). O mesmo valia para
-- "Recusar" (voltar para 'none').
--
-- CORREÇÃO
-- ------------------------------------------------------------------
-- Adiciona uma policy de UPDATE que autoriza o system_admin a atualizar
-- QUALQUER perfil. A policy `profiles_update_self` continua existindo para o
-- usuário comum; no Postgres, múltiplas policies PERMISSIVE para o mesmo comando
-- são combinadas por OR, então:
--   - usuário comum  → só o próprio perfil (profiles_update_self);
--   - system_admin   → qualquer perfil (profiles_update_admin).
--
-- A revisão de president_requests (reviewed_by/reviewed_at/status) já era
-- permitida ao system_admin (migration 20250101000023); esta migration fecha a
-- lacuna no `profiles`.
--
-- Forward-only e idempotente (DROP POLICY IF EXISTS antes do CREATE).

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_system_admin())
  with check (public.is_system_admin());
