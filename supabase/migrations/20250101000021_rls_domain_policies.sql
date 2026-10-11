-- Migration: RLS multi-tenant — políticas das tabelas de domínio (tarefa 17.2, parte 2/2)
-- Requisitos: 6.2, 6.3, 6.5, 6.7, 17.1
--
-- Contexto (design.md "RLS — políticas por papel E por tenant"): a parte 1
-- (migration 2.20) removeu as policies legadas single-tenant e criou as de
-- PLATAFORMA (clubs, memberships, profiles). As tabelas de DOMÍNIO ficaram com
-- RLS habilitada e SEM nenhuma policy — ou seja, inacessíveis. Esta migration
-- cria as policies tenant-aware delas, usando os helpers da migration 2.19:
--   - is_system_admin()        -> bypass de tenant (administrador da plataforma)
--   - club_role(p_club_id)     -> papel do usuário NAQUELE clube (ou null)
--   - is_member_of(p_club_id)  -> é membro ativo (ou system_admin)
--   - my_player_id(p_club_id)  -> players.id que o usuário representa no clube
--
-- Matriz de papéis por clube (fonte: memberships.role; Req 5.3):
--   | Tabela             | presidente | tesoureiro | jogador                         |
--   |--------------------|------------|------------|---------------------------------|
--   | players            | CRUD       | SELECT     | SELECT                          |
--   | categories         | CRUD       | SELECT     | SELECT                          |
--   | transactions       | CRUD       | CRUD       | SEM acesso direto (usa views)   |
--   | recurring_expenses | CRUD       | CRUD       | —                               |
--   | charges            | CRUD       | CRUD       | só as próprias (tarefa 17.3)    |
--   | payment_proofs     | CRUD       | CRUD       | só as próprias (tarefa 17.3)    |
--   | goals              | CRUD       | SELECT     | SELECT                          |
--   | settings           | CRUD       | SELECT     | SELECT (dados Pix p/ cobrança)  |
--   | audit_log          | SELECT     | SELECT     | —                               |
--   system_admin: bypass de tenant em todas (via is_system_admin()).
--
-- IMPORTANTE sobre charges/payment_proofs: AQUI criamos apenas as policies de
-- GESTOR (presidente/tesoureiro) para CRUD, e NENHUMA policy de jogador. As
-- policies do jogador (SELECT das próprias cobranças/comprovantes e INSERT do
-- próprio comprovante) ficam na migration 2.22 (tarefa 17.3). Policies são
-- aditivas (OR lógico), então as duas migrations compõem o acesso final.
--
-- Convenções:
--   - Toda policy usa `to authenticated` (todo acesso a dados exige login).
--   - "gestor do clube" = club_role(club_id) in ('presidente','tesoureiro').
--   - Escopo de tenant: is_member_of(club_id) na leitura; papel suficiente E
--     mesmo club_id na escrita (o with check amarra a linha ao clube do papel).
--   - audit_log nunca recebe INSERT/UPDATE/DELETE de usuário: é preenchido por
--     triggers SECURITY DEFINER, que não passam por RLS.
--
-- Idempotência: DROP POLICY IF EXISTS antes de cada CREATE, para a migration
-- poder ser reaplicada com segurança.

-- =====================================================================
-- players — presidente CRUD; tesoureiro/jogador SELECT.
-- =====================================================================
drop policy if exists players_select on public.players;
create policy players_select on public.players
  for select to authenticated
  using (public.is_member_of(club_id));

drop policy if exists players_insert on public.players;
create policy players_insert on public.players
  for insert to authenticated
  with check (public.is_system_admin() or public.club_role(club_id) = 'presidente');

drop policy if exists players_update on public.players;
create policy players_update on public.players
  for update to authenticated
  using (public.is_system_admin() or public.club_role(club_id) = 'presidente')
  with check (public.is_system_admin() or public.club_role(club_id) = 'presidente');

drop policy if exists players_delete on public.players;
create policy players_delete on public.players
  for delete to authenticated
  using (public.is_system_admin() or public.club_role(club_id) = 'presidente');

-- =====================================================================
-- categories — presidente CRUD; tesoureiro/jogador SELECT.
-- =====================================================================
drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories
  for select to authenticated
  using (public.is_member_of(club_id));

drop policy if exists categories_insert on public.categories;
create policy categories_insert on public.categories
  for insert to authenticated
  with check (public.is_system_admin() or public.club_role(club_id) = 'presidente');

drop policy if exists categories_update on public.categories;
create policy categories_update on public.categories
  for update to authenticated
  using (public.is_system_admin() or public.club_role(club_id) = 'presidente')
  with check (public.is_system_admin() or public.club_role(club_id) = 'presidente');

drop policy if exists categories_delete on public.categories;
create policy categories_delete on public.categories
  for delete to authenticated
  using (public.is_system_admin() or public.club_role(club_id) = 'presidente');

-- =====================================================================
-- transactions — presidente/tesoureiro CRUD; jogador SEM acesso direto (Req 6.3/8.8).
-- O jogador consome dados apenas via views agregadas (grant na migration 2.6/2.18).
-- =====================================================================
drop policy if exists transactions_manager_all on public.transactions;
create policy transactions_manager_all on public.transactions
  for all to authenticated
  using (
    public.is_system_admin()
    or public.club_role(club_id) in ('presidente', 'tesoureiro')
  )
  with check (
    public.is_system_admin()
    or public.club_role(club_id) in ('presidente', 'tesoureiro')
  );

-- =====================================================================
-- recurring_expenses — presidente/tesoureiro CRUD; jogador nenhum acesso.
-- =====================================================================
drop policy if exists recurring_expenses_manager_all on public.recurring_expenses;
create policy recurring_expenses_manager_all on public.recurring_expenses
  for all to authenticated
  using (
    public.is_system_admin()
    or public.club_role(club_id) in ('presidente', 'tesoureiro')
  )
  with check (
    public.is_system_admin()
    or public.club_role(club_id) in ('presidente', 'tesoureiro')
  );

-- =====================================================================
-- charges — GESTOR: presidente/tesoureiro CRUD.
-- (Policies do jogador para as próprias cobranças: migration 2.22 / tarefa 17.3.)
-- =====================================================================
drop policy if exists charges_manager_select on public.charges;
create policy charges_manager_select on public.charges
  for select to authenticated
  using (
    public.is_system_admin()
    or public.club_role(club_id) in ('presidente', 'tesoureiro')
  );

drop policy if exists charges_manager_insert on public.charges;
create policy charges_manager_insert on public.charges
  for insert to authenticated
  with check (
    public.is_system_admin()
    or public.club_role(club_id) in ('presidente', 'tesoureiro')
  );

drop policy if exists charges_manager_update on public.charges;
create policy charges_manager_update on public.charges
  for update to authenticated
  using (
    public.is_system_admin()
    or public.club_role(club_id) in ('presidente', 'tesoureiro')
  )
  with check (
    public.is_system_admin()
    or public.club_role(club_id) in ('presidente', 'tesoureiro')
  );

drop policy if exists charges_manager_delete on public.charges;
create policy charges_manager_delete on public.charges
  for delete to authenticated
  using (
    public.is_system_admin()
    or public.club_role(club_id) in ('presidente', 'tesoureiro')
  );

-- =====================================================================
-- payment_proofs — GESTOR: presidente/tesoureiro CRUD/aprovar.
-- (Policies do jogador — SELECT/INSERT dos próprios: migration 2.22 / tarefa 17.3.)
-- =====================================================================
drop policy if exists payment_proofs_manager_select on public.payment_proofs;
create policy payment_proofs_manager_select on public.payment_proofs
  for select to authenticated
  using (
    public.is_system_admin()
    or public.club_role(club_id) in ('presidente', 'tesoureiro')
  );

drop policy if exists payment_proofs_manager_insert on public.payment_proofs;
create policy payment_proofs_manager_insert on public.payment_proofs
  for insert to authenticated
  with check (
    public.is_system_admin()
    or public.club_role(club_id) in ('presidente', 'tesoureiro')
  );

drop policy if exists payment_proofs_manager_update on public.payment_proofs;
create policy payment_proofs_manager_update on public.payment_proofs
  for update to authenticated
  using (
    public.is_system_admin()
    or public.club_role(club_id) in ('presidente', 'tesoureiro')
  )
  with check (
    public.is_system_admin()
    or public.club_role(club_id) in ('presidente', 'tesoureiro')
  );

drop policy if exists payment_proofs_manager_delete on public.payment_proofs;
create policy payment_proofs_manager_delete on public.payment_proofs
  for delete to authenticated
  using (
    public.is_system_admin()
    or public.club_role(club_id) in ('presidente', 'tesoureiro')
  );

-- =====================================================================
-- goals — presidente CRUD; tesoureiro/jogador SELECT.
-- =====================================================================
drop policy if exists goals_select on public.goals;
create policy goals_select on public.goals
  for select to authenticated
  using (public.is_member_of(club_id));

drop policy if exists goals_insert on public.goals;
create policy goals_insert on public.goals
  for insert to authenticated
  with check (public.is_system_admin() or public.club_role(club_id) = 'presidente');

drop policy if exists goals_update on public.goals;
create policy goals_update on public.goals
  for update to authenticated
  using (public.is_system_admin() or public.club_role(club_id) = 'presidente')
  with check (public.is_system_admin() or public.club_role(club_id) = 'presidente');

drop policy if exists goals_delete on public.goals;
create policy goals_delete on public.goals
  for delete to authenticated
  using (public.is_system_admin() or public.club_role(club_id) = 'presidente');

-- =====================================================================
-- settings — presidente CRUD; tesoureiro/jogador SELECT (dados Pix p/ cobrança).
-- Uma linha por clube (migration 2.16): club_id UNIQUE.
-- =====================================================================
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings
  for select to authenticated
  using (public.is_member_of(club_id));

drop policy if exists settings_insert on public.settings;
create policy settings_insert on public.settings
  for insert to authenticated
  with check (public.is_system_admin() or public.club_role(club_id) = 'presidente');

drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings
  for update to authenticated
  using (public.is_system_admin() or public.club_role(club_id) = 'presidente')
  with check (public.is_system_admin() or public.club_role(club_id) = 'presidente');

drop policy if exists settings_delete on public.settings;
create policy settings_delete on public.settings
  for delete to authenticated
  using (public.is_system_admin() or public.club_role(club_id) = 'presidente');

-- =====================================================================
-- audit_log — presidente/tesoureiro SELECT do próprio clube; system_admin tudo.
-- club_id é NULL-able (ações de plataforma): essas linhas só são visíveis ao
-- system_admin. Sem INSERT/UPDATE/DELETE de usuário (preenchido por triggers).
-- =====================================================================
drop policy if exists audit_log_manager_select on public.audit_log;
create policy audit_log_manager_select on public.audit_log
  for select to authenticated
  using (
    public.is_system_admin()
    or (club_id is not null and public.club_role(club_id) in ('presidente', 'tesoureiro'))
  );
