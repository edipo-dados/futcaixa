-- Migration: cobranças e comprovantes (tarefa 2.3)
-- Tabelas: charges, payment_proofs
-- Requisitos: 5.1, 5.2, 5.4, 6.5
--
-- Convenções (design.md "Modelo de dados"):
--   - id uuid default gen_random_uuid()
--   - created_at timestamptz default now(); updated_at mantido por set_updated_at()
--   - valores monetários sempre em centavos (integer), CHECK amount_cents > 0
--   - soft delete via deleted_at timestamptz null (charges) — nada é removido fisicamente
--
-- charges é criada ANTES de payment_proofs (FK payment_proofs.charge_id -> charges.id).
-- Ao final, adiciona-se a FK diferida transactions.charge_id -> charges.id
-- (a coluna foi criada na migration 2.2, quando charges ainda não existia).

-- =====================================================================
-- charges (cobranças) — Req 5
-- =====================================================================
create table if not exists public.charges (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid        not null references public.players (id),
  amount_cents integer     not null,
  description  text        not null,
  kind         text        not null,
  period       text,
  due_date     date        not null,
  status       text        not null default 'pendente',
  paid_at      timestamptz,
  txid         text        not null,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- valores monetários sempre positivos (Req 11.4).
  constraint charges_amount_cents_check
    check (amount_cents > 0),
  -- tipo de cobrança (Req 5.3).
  constraint charges_kind_check
    check (kind in ('mensalidade', 'avulso', 'multa', 'vaquinha')),
  -- status da cobrança (Req 5.4); "atrasada" NÃO é status: é derivado.
  constraint charges_status_check
    check (status in ('pendente', 'em_analise', 'paga', 'cancelada')),
  -- period, quando presente, segue o formato YYYY-MM (mensalidades).
  constraint charges_period_check
    check (period is null or period ~ '^\d{4}-\d{2}$')
);

-- txid único — usado como identificador no payload Pix (Req 6.2).
create unique index if not exists charges_txid_unique
  on public.charges (txid);

-- Idempotência da geração mensal (Req 5.2): no máximo uma mensalidade
-- ativa por jogador e período. Índice único PARCIAL — só vale para
-- kind='mensalidade' e cobranças não excluídas, deixando avulsos/multas livres.
create unique index if not exists charges_monthly_player_period_unique
  on public.charges (player_id, period)
  where kind = 'mensalidade' and deleted_at is null;

create index if not exists charges_player_id_idx
  on public.charges (player_id);

-- Listagens de inadimplentes/cobranças filtram por status e vencimento,
-- ignorando as excluídas (soft delete).
create index if not exists charges_status_due_date_idx
  on public.charges (status, due_date)
  where deleted_at is null;

create trigger charges_set_updated_at
  before update on public.charges
  for each row execute function public.set_updated_at();

comment on table public.charges is 'Cobranças dos jogadores: mensalidade, avulso, multa, vaquinha (Req 5).';
comment on column public.charges.period is 'Período YYYY-MM da mensalidade; base do índice único parcial de idempotência.';
comment on column public.charges.txid is 'Identificador único por cobrança, usado no payload Pix (Req 6.2).';
comment on column public.charges.status is 'pendente | em_analise | paga | cancelada. "Atrasada" é derivado (due_date < hoje AND status = pendente).';
comment on column public.charges.deleted_at is 'Soft delete (Req 11.5); registros nunca são removidos fisicamente.';

-- =====================================================================
-- payment_proofs (comprovantes de pagamento) — Req 6.5
-- =====================================================================
create table if not exists public.payment_proofs (
  id          uuid primary key default gen_random_uuid(),
  charge_id   uuid        not null references public.charges (id),
  file_path   text        not null,
  uploaded_by uuid        not null references public.profiles (id),
  status      text        not null default 'em_analise',
  reviewed_by uuid        references public.profiles (id),
  review_note text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- status de análise do comprovante (Req 6.5/6.6/6.7).
  constraint payment_proofs_status_check
    check (status in ('em_analise', 'aprovado', 'rejeitado'))
);

create index if not exists payment_proofs_charge_id_idx
  on public.payment_proofs (charge_id);

create index if not exists payment_proofs_uploaded_by_idx
  on public.payment_proofs (uploaded_by);

create trigger payment_proofs_set_updated_at
  before update on public.payment_proofs
  for each row execute function public.set_updated_at();

comment on table public.payment_proofs is 'Comprovantes de pagamento anexados pelo jogador, revisados por admin/tesoureiro (Req 6.5–6.7).';
comment on column public.payment_proofs.file_path is 'Caminho do arquivo no bucket privado "proofs" (acesso por URL assinada).';
comment on column public.payment_proofs.status is 'em_analise | aprovado | rejeitado.';
comment on column public.payment_proofs.review_note is 'Motivo da rejeição, quando aplicável (Req 6.7).';

-- =====================================================================
-- FK diferida: transactions.charge_id -> charges.id
-- A coluna charge_id foi criada na migration 2.2 (charges ainda não existia).
-- Agora que charges existe, adiciona-se a restrição de integridade referencial.
-- =====================================================================
alter table public.transactions
  add constraint transactions_charge_id_fkey
  foreign key (charge_id) references public.charges (id);
