-- Migration: metas e auditoria (tarefa 2.4)
-- Tabelas: goals, audit_log  + função genérica de auditoria e triggers
-- Requisitos: 3.9, 5.7, 6.6, 6.7, 8.6, 11.3
--
-- Convenções (design.md "Modelo de dados"):
--   - id uuid default gen_random_uuid()
--   - created_at timestamptz default now(); updated_at mantido por set_updated_at()
--   - valores monetários sempre em centavos (integer)
--
-- audit_log é preenchido por triggers AFTER em transactions, charges,
-- payment_proofs e settings, capturando before/after (jsonb) e o actor
-- via auth.uid() (pode ser null em ações de cron/service-role).

-- =====================================================================
-- goals (metas / vaquinhas) — Req 8.6
-- =====================================================================
create table if not exists public.goals (
  id            uuid primary key default gen_random_uuid(),
  title         text        not null,
  target_cents  integer     not null,
  current_cents integer     not null default 0,
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- valores monetários sempre em centavos e não-negativos (Req 11.4).
  constraint goals_target_cents_check  check (target_cents > 0),
  constraint goals_current_cents_check check (current_cents >= 0)
);

create index if not exists goals_active_idx
  on public.goals (is_active)
  where is_active;

-- Reaproveita o helper set_updated_at() definido na migration 2.1.
create trigger goals_set_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

comment on table public.goals is 'Metas/vaquinhas com barra de progresso nos dashboards (Req 8.6).';
comment on column public.goals.target_cents is 'Valor-alvo da meta (centavos).';
comment on column public.goals.current_cents is 'Valor acumulado (centavos); pode ser derivado de transações vinculadas.';

-- =====================================================================
-- audit_log — Req 11.3 (rastreabilidade: nada se apaga)
-- =====================================================================
create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  -- actor_id é NULL-able: ações de cron / service-role não têm auth.uid().
  actor_id   uuid        references public.profiles (id),
  action     text        not null,
  entity     text        not null,
  entity_id  uuid,
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_entity_idx
  on public.audit_log (entity, entity_id);

create index if not exists audit_log_actor_id_idx
  on public.audit_log (actor_id);

create index if not exists audit_log_created_at_idx
  on public.audit_log (created_at);

comment on table public.audit_log is 'Trilha de auditoria preenchida por triggers nas tabelas sensíveis (Req 11.3).';
comment on column public.audit_log.actor_id is 'auth.uid() no momento da ação; NULL para cron/service-role.';
comment on column public.audit_log.action is 'Ex.: transactions.update, charges.delete, payment_proofs.insert.';
comment on column public.audit_log.entity is 'Nome da tabela afetada (TG_TABLE_NAME).';
comment on column public.audit_log.entity_id is 'id da linha afetada quando uuid (NULL p/ singletons como settings).';

-- =====================================================================
-- Função genérica de auditoria
-- Captura TG_OP (INSERT/UPDATE/DELETE), monta a action como
-- entity + '.' + lower(op), grava before (OLD) / after (NEW) como jsonb
-- e o actor via auth.uid(). entity_id = id da linha quando for um uuid
-- válido (settings é singleton smallint → entity_id fica NULL).
-- =====================================================================
create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before    jsonb;
  v_after     jsonb;
  v_id_text   text;
  v_entity_id uuid;
begin
  -- Snapshots before/after conforme a operação.
  if (tg_op = 'INSERT') then
    v_before := null;
    v_after  := to_jsonb(new);
  elsif (tg_op = 'UPDATE') then
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
  else -- DELETE
    v_before := to_jsonb(old);
    v_after  := null;
  end if;

  -- id da linha afetada (coalesce NEW/OLD). settings usa id smallint:
  -- só convertemos quando for um uuid válido, senão entity_id = NULL.
  v_id_text := coalesce(v_after ->> 'id', v_before ->> 'id');
  if v_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_entity_id := v_id_text::uuid;
  else
    v_entity_id := null;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (
    auth.uid(),                            -- pode ser NULL (cron/service-role)
    tg_table_name || '.' || lower(tg_op),  -- ex.: transactions.update
    tg_table_name,
    v_entity_id,
    v_before,
    v_after
  );

  -- AFTER trigger: valor de retorno é ignorado, mas devolvemos a linha correta.
  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.audit_trigger() is 'Trigger genérico de auditoria: grava before/after e actor em audit_log (Req 3.9, 5.7, 6.6, 6.7, 11.3).';

-- =====================================================================
-- Triggers AFTER nas tabelas sensíveis
-- transactions (Req 3.9), charges (Req 5.7), payment_proofs (Req 6.6/6.7),
-- settings (configurações do caixa).
-- =====================================================================
create trigger transactions_audit
  after insert or update or delete on public.transactions
  for each row execute function public.audit_trigger();

create trigger charges_audit
  after insert or update or delete on public.charges
  for each row execute function public.audit_trigger();

create trigger payment_proofs_audit
  after insert or update or delete on public.payment_proofs
  for each row execute function public.audit_trigger();

create trigger settings_audit
  after insert or update or delete on public.settings
  for each row execute function public.audit_trigger();
