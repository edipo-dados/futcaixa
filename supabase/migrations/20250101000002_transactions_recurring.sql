-- Migration: transações e recorrências (tarefa 2.2)
-- Tabelas: recurring_expenses, transactions
-- Requisitos: 3.1, 3.10, 4.1, 11.5
--
-- Convenções (design.md "Modelo de dados"):
--   - id uuid default gen_random_uuid()
--   - created_at timestamptz default now(); updated_at mantido por set_updated_at()
--   - valores monetários sempre em centavos (integer), CHECK amount_cents > 0 (Req 3.10)
--   - soft delete via deleted_at timestamptz null (Req 3.8/11.5) — nada é removido fisicamente
--
-- recurring_expenses é criada ANTES de transactions para que a FK
-- transactions.recurring_id -> recurring_expenses.id resolva.
--
-- NOTA sobre charge_id: a tabela charges só é criada na migration 2.3.
-- Para não referenciar uma tabela inexistente, charge_id entra aqui como
-- coluna uuid simples; a FK -> charges.id é adicionada na migration 2.3.

-- =====================================================================
-- recurring_expenses (Req 4.1) — despesas que se repetem (ex.: aluguel da quadra)
-- =====================================================================
create table if not exists public.recurring_expenses (
  id                    uuid primary key default gen_random_uuid(),
  amount_cents          integer     not null,
  category_id           uuid        not null references public.categories (id),
  description           text        not null,
  day_of_month          smallint    not null,
  is_active             boolean     not null default true,
  last_generated_period text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Req 3.10/11.4: valores monetários sempre positivos.
  constraint recurring_expenses_amount_cents_check
    check (amount_cents > 0),
  -- day_of_month restrito a 1..28 para evitar meses curtos (design.md).
  constraint recurring_expenses_day_of_month_check
    check (day_of_month between 1 and 28),
  -- last_generated_period, quando presente, segue o formato YYYY-MM (idempotência do cron).
  constraint recurring_expenses_last_generated_period_check
    check (last_generated_period is null or last_generated_period ~ '^\d{4}-\d{2}$')
);

create index if not exists recurring_expenses_category_id_idx
  on public.recurring_expenses (category_id);

create index if not exists recurring_expenses_active_idx
  on public.recurring_expenses (is_active)
  where is_active;

create trigger recurring_expenses_set_updated_at
  before update on public.recurring_expenses
  for each row execute function public.set_updated_at();

comment on table public.recurring_expenses is 'Despesas recorrentes geradas automaticamente via cron (Req 4).';
comment on column public.recurring_expenses.day_of_month is 'Dia do mês (1..28) em que a despesa é gerada.';
comment on column public.recurring_expenses.last_generated_period is 'Último período YYYY-MM já gerado; garante idempotência do cron (Req 4.3).';

-- =====================================================================
-- transactions (lançamentos) — Req 3.1
-- =====================================================================
create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  kind         text        not null,
  amount_cents integer     not null,
  occurred_on  date        not null,
  category_id  uuid        not null references public.categories (id),
  description  text        not null,
  player_id    uuid        references public.players (id),
  -- charge_id: FK -> charges.id adicionada na migration 2.3 (tabela ainda não existe).
  charge_id    uuid,
  proof_path   text,
  recurring_id uuid        references public.recurring_expenses (id),
  created_by   uuid        not null references public.profiles (id),
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint transactions_kind_check
    check (kind in ('receita', 'despesa')),
  -- Req 3.10/11.4: rejeita valores menores ou iguais a zero.
  constraint transactions_amount_cents_check
    check (amount_cents > 0)
);

create index if not exists transactions_category_id_idx
  on public.transactions (category_id);

create index if not exists transactions_player_id_idx
  on public.transactions (player_id);

create index if not exists transactions_charge_id_idx
  on public.transactions (charge_id);

create index if not exists transactions_recurring_id_idx
  on public.transactions (recurring_id);

-- Consultas dos dashboards filtram por data e ignoram excluídos (soft delete).
create index if not exists transactions_occurred_on_idx
  on public.transactions (occurred_on)
  where deleted_at is null;

create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

comment on table public.transactions is 'Lançamentos financeiros de receita/despesa (Req 3).';
comment on column public.transactions.charge_id is 'Origem: cobrança paga. FK -> charges.id adicionada na migration 2.3.';
comment on column public.transactions.recurring_id is 'Origem: despesa recorrente que gerou este lançamento.';
comment on column public.transactions.proof_path is 'Caminho do comprovante no bucket privado (URL assinada).';
comment on column public.transactions.deleted_at is 'Soft delete (Req 3.8/11.5); registros nunca são removidos fisicamente.';
