-- Migration: RLS e políticas por papel (tarefa 2.6)
-- Habilita Row Level Security em TODAS as tabelas-base e define as políticas
-- por papel (admin, tesoureiro, jogador), além da função auxiliar de papel.
-- Requisitos: 1.5, 1.6, 1.7, 8.8, 8.9, 11.1
--
-- Matriz de papéis (design.md "RLS — políticas por papel"):
--   | Tabela             | admin        | tesoureiro   | jogador                                   |
--   |--------------------|--------------|--------------|-------------------------------------------|
--   | players            | CRUD         | SELECT       | SELECT                                    |
--   | categories         | CRUD         | SELECT       | SELECT                                    |
--   | transactions       | CRUD         | CRUD         | sem acesso direto (usa views)             |
--   | recurring_expenses | CRUD         | CRUD         | —                                         |
--   | charges            | CRUD         | CRUD         | SELECT apenas as próprias                  |
--   | payment_proofs     | CRUD/aprovar | CRUD/aprovar | INSERT/SELECT apenas as próprias           |
--   | goals              | CRUD         | SELECT       | SELECT                                    |
--   | settings           | CRUD         | SELECT       | SELECT                                    |
--   | audit_log          | SELECT       | SELECT       | —                                         |
--   | profiles           | CRUD         | —            | SELECT o próprio                           |
--   | views agregadas    | SELECT       | SELECT       | SELECT                                    |
--
-- Decisões de projeto:
--   - A fonte da verdade de autorização é a RLS no Postgres (Req 1.7); a UI é
--     apenas conveniência.
--   - Jogador NUNCA acessa transactions diretamente (Req 8.8): os dashboards
--     leem das views agregadas, cujo SELECT é liberado a todo usuário
--     autenticado no fim desta migration.
--   - Jogador só enxerga as próprias cobranças/comprovantes (Req 8.9), amarrado
--     via profiles.player_id.
--   - "current_role" colide com palavra reservada do SQL/Postgres; por isso a
--     função é SEMPRE referenciada com o schema: public.current_role().
--   - A função é SECURITY DEFINER para ler public.profiles independentemente da
--     RLS da própria profiles — isso evita recursão infinita (uma policy de
--     profiles que chamasse current_role() reconsultaria profiles sob RLS) e
--     permite que as demais tabelas resolvam o papel do usuário.
--   - As policies usam `authenticated` (TO authenticated) porque todo acesso a
--     dados exige login; o papel público só acessa o Sorteio, que roda no
--     cliente e não toca estas tabelas.

-- =====================================================================
-- Função auxiliar: papel do usuário atual (design.md)
-- SECURITY DEFINER + search_path fixo para ler profiles sem passar pela RLS.
-- STABLE: resultado constante dentro da mesma transação/statement.
-- =====================================================================
create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

comment on function public.current_role() is
  'Papel (admin|tesoureiro|jogador) do usuário autenticado, lido de profiles. SECURITY DEFINER evita recursão de RLS; referenciar sempre como public.current_role() (nome colide com palavra reservada).';

-- =====================================================================
-- Habilitar RLS em TODAS as tabelas-base (Req 11.1)
-- =====================================================================
alter table public.profiles           enable row level security;
alter table public.players            enable row level security;
alter table public.categories         enable row level security;
alter table public.transactions       enable row level security;
alter table public.recurring_expenses enable row level security;
alter table public.charges            enable row level security;
alter table public.payment_proofs     enable row level security;
alter table public.goals              enable row level security;
alter table public.settings           enable row level security;
alter table public.audit_log          enable row level security;

-- =====================================================================
-- profiles
--   admin: CRUD; demais papéis: SELECT apenas o próprio perfil.
--   (current_role() lê profiles com SECURITY DEFINER, logo não há recursão.)
-- =====================================================================
create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.current_role() = 'admin'
  );

create policy profiles_admin_insert on public.profiles
  for insert to authenticated
  with check (public.current_role() = 'admin');

create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

create policy profiles_admin_delete on public.profiles
  for delete to authenticated
  using (public.current_role() = 'admin');

-- =====================================================================
-- players
--   admin: CRUD; tesoureiro/jogador: SELECT.
-- =====================================================================
create policy players_select_authenticated on public.players
  for select to authenticated
  using (public.current_role() in ('admin', 'tesoureiro', 'jogador'));

create policy players_admin_insert on public.players
  for insert to authenticated
  with check (public.current_role() = 'admin');

create policy players_admin_update on public.players
  for update to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

create policy players_admin_delete on public.players
  for delete to authenticated
  using (public.current_role() = 'admin');

-- =====================================================================
-- categories
--   admin: CRUD; tesoureiro/jogador: SELECT.
-- =====================================================================
create policy categories_select_authenticated on public.categories
  for select to authenticated
  using (public.current_role() in ('admin', 'tesoureiro', 'jogador'));

create policy categories_admin_insert on public.categories
  for insert to authenticated
  with check (public.current_role() = 'admin');

create policy categories_admin_update on public.categories
  for update to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

create policy categories_admin_delete on public.categories
  for delete to authenticated
  using (public.current_role() = 'admin');

-- =====================================================================
-- transactions
--   admin/tesoureiro: CRUD; jogador: SEM acesso direto (Req 8.8).
--   O jogador consome os dados somente via views agregadas.
-- =====================================================================
create policy transactions_manager_all on public.transactions
  for all to authenticated
  using (public.current_role() in ('admin', 'tesoureiro'))
  with check (public.current_role() in ('admin', 'tesoureiro'));

-- =====================================================================
-- recurring_expenses
--   admin/tesoureiro: CRUD; jogador: nenhum acesso.
-- =====================================================================
create policy recurring_expenses_manager_all on public.recurring_expenses
  for all to authenticated
  using (public.current_role() in ('admin', 'tesoureiro'))
  with check (public.current_role() in ('admin', 'tesoureiro'));

-- =====================================================================
-- charges
--   admin/tesoureiro: CRUD; jogador: SELECT apenas as próprias
--   (player_id = profiles.player_id). Exemplo de policy do design.md.
-- =====================================================================
create policy charges_player_select on public.charges
  for select to authenticated
  using (
    public.current_role() in ('admin', 'tesoureiro')
    or player_id = (select player_id from public.profiles where id = auth.uid())
  );

create policy charges_manager_insert on public.charges
  for insert to authenticated
  with check (public.current_role() in ('admin', 'tesoureiro'));

create policy charges_manager_update on public.charges
  for update to authenticated
  using (public.current_role() in ('admin', 'tesoureiro'))
  with check (public.current_role() in ('admin', 'tesoureiro'));

create policy charges_manager_delete on public.charges
  for delete to authenticated
  using (public.current_role() in ('admin', 'tesoureiro'));

-- =====================================================================
-- payment_proofs
--   admin/tesoureiro: CRUD/aprovar; jogador: INSERT/SELECT apenas os próprios.
--   payment_proofs não tem player_id: a posse é derivada da cobrança
--   (charge_id -> charges.player_id) pertencer ao jogador logado. No INSERT
--   também exigimos uploaded_by = auth.uid() para o jogador não anexar em nome
--   de terceiros.
-- =====================================================================
create policy payment_proofs_player_select on public.payment_proofs
  for select to authenticated
  using (
    public.current_role() in ('admin', 'tesoureiro')
    or charge_id in (
      select c.id
      from public.charges c
      where c.player_id = (select player_id from public.profiles where id = auth.uid())
    )
  );

create policy payment_proofs_player_insert on public.payment_proofs
  for insert to authenticated
  with check (
    public.current_role() in ('admin', 'tesoureiro')
    or (
      public.current_role() = 'jogador'
      and uploaded_by = auth.uid()
      and charge_id in (
        select c.id
        from public.charges c
        where c.player_id = (select player_id from public.profiles where id = auth.uid())
      )
    )
  );

-- Revisão/aprovação (UPDATE) e remoção: apenas gestores.
create policy payment_proofs_manager_update on public.payment_proofs
  for update to authenticated
  using (public.current_role() in ('admin', 'tesoureiro'))
  with check (public.current_role() in ('admin', 'tesoureiro'));

create policy payment_proofs_manager_delete on public.payment_proofs
  for delete to authenticated
  using (public.current_role() in ('admin', 'tesoureiro'));

-- =====================================================================
-- goals
--   admin: CRUD; tesoureiro/jogador: SELECT.
-- =====================================================================
create policy goals_select_authenticated on public.goals
  for select to authenticated
  using (public.current_role() in ('admin', 'tesoureiro', 'jogador'));

create policy goals_admin_insert on public.goals
  for insert to authenticated
  with check (public.current_role() = 'admin');

create policy goals_admin_update on public.goals
  for update to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

create policy goals_admin_delete on public.goals
  for delete to authenticated
  using (public.current_role() = 'admin');

-- =====================================================================
-- settings
--   admin: CRUD; tesoureiro/jogador: SELECT (dados Pix p/ cobrança).
-- =====================================================================
create policy settings_select_authenticated on public.settings
  for select to authenticated
  using (public.current_role() in ('admin', 'tesoureiro', 'jogador'));

create policy settings_admin_insert on public.settings
  for insert to authenticated
  with check (public.current_role() = 'admin');

create policy settings_admin_update on public.settings
  for update to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

create policy settings_admin_delete on public.settings
  for delete to authenticated
  using (public.current_role() = 'admin');

-- =====================================================================
-- audit_log
--   admin/tesoureiro: SELECT; jogador: nenhum acesso.
--   Nunca há INSERT/UPDATE/DELETE por usuário: o preenchimento é feito pelos
--   triggers de auditoria (SECURITY DEFINER), que não passam por RLS.
-- =====================================================================
create policy audit_log_manager_select on public.audit_log
  for select to authenticated
  using (public.current_role() in ('admin', 'tesoureiro'));

-- =====================================================================
-- Views agregadas (dashboards) — Req 8.8
-- SELECT liberado a todo usuário autenticado: são dados agregados do caixa,
-- sem identidade financeira individual. As views usam security_invoker
-- (migration 2.5), então as policies das tabelas-base continuam valendo para
-- consultas que não passem pelas agregações — mas o SELECT na própria view é
-- concedido aqui ao papel `authenticated`.
-- =====================================================================
grant select on public.v_monthly_summary   to authenticated;
grant select on public.v_category_breakdown to authenticated;
grant select on public.v_balance_history    to authenticated;
grant select on public.v_delinquency_rate   to authenticated;
