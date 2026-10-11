-- Migration: RLS multi-tenant — remoção do legado + políticas de plataforma (tarefa 17.2, parte 1/2)
-- Requisitos: 6.2, 6.7, 17.1
--
-- Contexto (design.md "RLS — políticas por papel E por tenant"): a RLS antiga
-- (migration 2.6, 20250101000006) foi desenhada para um FutCaixa SINGLE-TENANT,
-- resolvendo o papel do usuário via `public.current_role()`, que lia a coluna
-- `profiles.role`. Essa coluna NÃO EXISTE MAIS (removida na migration 2.14,
-- 20250101000014): o papel agora é POR CLUBE, em `memberships` (fonte de verdade,
-- Req 5.3). Logo, todas as policies da 2.6 e a função `current_role()` estão
-- QUEBRADAS e precisam ser removidas.
--
-- Esta migration (PARTE 1 de 2) faz apenas:
--   1) DROP de todas as policies criadas na 2.6.
--   2) DROP da função legada public.current_role().
--   3) Habilita RLS nas novas tabelas de tenant (clubs, memberships).
--   4) CRIA as policies TENANT-AWARE de PLATAFORMA: clubs, memberships e o
--      mínimo de profiles (self/admin). Todas usam os helpers da migration 2.19
--      (is_system_admin, club_role, is_member_of) e `to authenticated`.
--
-- O QUE NÃO ENTRA AQUI (fica para as próximas tarefas):
--   - As demais tabelas de domínio (players, categories, transactions,
--     recurring_expenses, charges, payment_proofs, goals, settings, audit_log)
--     recebem suas policies tenant-aware na PARTE 2 (próxima migration).
--   - As policies de `president_requests` e as de Storage (buckets) vêm depois.
--   - NÃO há policy de INSERT em `profiles`: o perfil é criado pelo trigger
--     handle_new_user() (SECURITY DEFINER, migration 2.14), que não passa por RLS.
--
-- Idempotência: os DROPs usam IF EXISTS; os ENABLE RLS são idempotentes. As
-- policies novas usam CREATE POLICY (falham se já existirem) — como esta é a
-- primeira criação delas, está correto.

-- =====================================================================
-- 1) Remover as policies do legado single-tenant (migration 2.6)
--    Todas liam public.current_role() -> profiles.role (coluna extinta).
-- =====================================================================

-- profiles
drop policy if exists profiles_select_own_or_admin on public.profiles;
drop policy if exists profiles_admin_insert         on public.profiles;
drop policy if exists profiles_admin_update         on public.profiles;
drop policy if exists profiles_admin_delete         on public.profiles;

-- players
drop policy if exists players_select_authenticated on public.players;
drop policy if exists players_admin_insert          on public.players;
drop policy if exists players_admin_update          on public.players;
drop policy if exists players_admin_delete          on public.players;

-- categories
drop policy if exists categories_select_authenticated on public.categories;
drop policy if exists categories_admin_insert          on public.categories;
drop policy if exists categories_admin_update          on public.categories;
drop policy if exists categories_admin_delete          on public.categories;

-- transactions
drop policy if exists transactions_manager_all on public.transactions;

-- recurring_expenses
drop policy if exists recurring_expenses_manager_all on public.recurring_expenses;

-- charges
drop policy if exists charges_player_select   on public.charges;
drop policy if exists charges_manager_insert  on public.charges;
drop policy if exists charges_manager_update  on public.charges;
drop policy if exists charges_manager_delete  on public.charges;

-- payment_proofs
drop policy if exists payment_proofs_player_select   on public.payment_proofs;
drop policy if exists payment_proofs_player_insert    on public.payment_proofs;
drop policy if exists payment_proofs_manager_update   on public.payment_proofs;
drop policy if exists payment_proofs_manager_delete   on public.payment_proofs;

-- goals
drop policy if exists goals_select_authenticated on public.goals;
drop policy if exists goals_admin_insert          on public.goals;
drop policy if exists goals_admin_update          on public.goals;
drop policy if exists goals_admin_delete          on public.goals;

-- settings
drop policy if exists settings_select_authenticated on public.settings;
drop policy if exists settings_admin_insert          on public.settings;
drop policy if exists settings_admin_update          on public.settings;
drop policy if exists settings_admin_delete          on public.settings;

-- audit_log
drop policy if exists audit_log_manager_select on public.audit_log;

-- =====================================================================
-- 1b) Remover policies de Storage que ainda dependem de current_role()
--     (migrations 2.8 proofs_* e 2.11 logos_*). Sem isso, o DROP da função
--     abaixo falha (dependências). As de `proofs` são recriadas tenant-aware
--     na 2.24; as de `logos` na 2.25. IF EXISTS mantém idempotência.
-- =====================================================================
drop policy if exists proofs_update_manager on storage.objects;
drop policy if exists proofs_delete_manager on storage.objects;
drop policy if exists logos_insert_admin    on storage.objects;
drop policy if exists logos_update_admin    on storage.objects;
drop policy if exists logos_delete_admin    on storage.objects;

-- =====================================================================
-- 2) Remover a função legada public.current_role()
--    Ela lia profiles.role (coluna extinta na 2.14); substituída pelos helpers
--    da migration 2.19 (is_system_admin / club_role / is_member_of / my_player_id).
-- =====================================================================
drop function if exists public.current_role();

-- =====================================================================
-- 3) Habilitar RLS nas tabelas de tenant (clubs 2.13 / memberships 2.15)
--    As demais tabelas-base já tiveram RLS habilitada na 2.6.
-- =====================================================================
alter table public.clubs       enable row level security;
alter table public.memberships enable row level security;

-- =====================================================================
-- 4) Policies tenant-aware de PLATAFORMA
-- =====================================================================

-- ---------------------------------------------------------------------
-- clubs (futebol / tenant de topo)
--   SELECT: system_admin (bypass) ou membro ativo do próprio clube.
--   INSERT: system_admin, ou o criador (created_by = eu) cujo perfil tem
--           president_status = 'aprovado' (só presidente aprovado abre futebol).
--   UPDATE/DELETE: system_admin ou presidente DAQUELE clube.
-- ---------------------------------------------------------------------
create policy clubs_select on public.clubs
  for select to authenticated
  using (public.is_system_admin() or public.is_member_of(id));

create policy clubs_insert on public.clubs
  for insert to authenticated
  with check (
    public.is_system_admin()
    or (
      created_by = auth.uid()
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.president_status = 'aprovado'
      )
    )
  );

create policy clubs_update on public.clubs
  for update to authenticated
  using (public.is_system_admin() or public.club_role(id) = 'presidente')
  with check (public.is_system_admin() or public.club_role(id) = 'presidente');

create policy clubs_delete on public.clubs
  for delete to authenticated
  using (public.is_system_admin() or public.club_role(id) = 'presidente');

-- ---------------------------------------------------------------------
-- memberships (vínculo usuário↔clube; fonte de verdade do papel)
--   SELECT: system_admin, o próprio vínculo (user_id = eu) ou o presidente do
--           clube (precisa enxergar/gerir os membros).
--   INSERT: system_admin, presidente do clube (adiciona/convida membros) ou o
--           próprio usuário abrindo um pedido de entrada como jogador
--           (user_id = eu, status 'pendente', role 'jogador') — Req 4.3.
--   UPDATE/DELETE: system_admin ou presidente do clube (aprovar/recusar/remover).
-- ---------------------------------------------------------------------
create policy memberships_select on public.memberships
  for select to authenticated
  using (
    public.is_system_admin()
    or user_id = auth.uid()
    or public.club_role(club_id) = 'presidente'
  );

create policy memberships_insert on public.memberships
  for insert to authenticated
  with check (
    public.is_system_admin()
    or public.club_role(club_id) = 'presidente'
    or (
      user_id = auth.uid()
      and status = 'pendente'
      and role = 'jogador'
    )
  );

create policy memberships_update on public.memberships
  for update to authenticated
  using (public.is_system_admin() or public.club_role(club_id) = 'presidente')
  with check (public.is_system_admin() or public.club_role(club_id) = 'presidente');

create policy memberships_delete on public.memberships
  for delete to authenticated
  using (public.is_system_admin() or public.club_role(club_id) = 'presidente');

-- ---------------------------------------------------------------------
-- profiles (mínimo de plataforma)
--   SELECT: o próprio perfil ou system_admin.
--   UPDATE: apenas o próprio perfil (dados básicos do usuário).
--   Sem INSERT: o perfil nasce pelo trigger handle_new_user() (SECURITY DEFINER,
--   2.14), que não passa por RLS. As policies específicas de president_requests
--   (incl. revisão por system_admin) vêm em tarefa posterior.
--   RLS de profiles já foi habilitada na 2.6.
-- ---------------------------------------------------------------------
create policy profiles_select_self_or_admin on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_system_admin());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
