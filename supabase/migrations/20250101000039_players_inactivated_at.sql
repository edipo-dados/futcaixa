-- Migration: data de inativação de jogadores (entradas/saídas no dashboard)
-- Contexto: o dashboard passa a exibir ENTRADAS (players.created_at) e SAÍDAS
-- (inativação ou exclusão) de jogadores por mês. Até aqui não havia registro
-- de QUANDO um jogador foi inativado. Esta migration:
--
--   1) adiciona players.inactivated_at (timestamptz, null) — instante em que o
--      jogador passou para 'inativo'; null quando ativo;
--   2) adiciona players.inactivated_at_approx (boolean, default false) — true
--      quando a data foi estimada no backfill (a partir de updated_at);
--   3) cria o trigger players_set_inactivated_at (BEFORE INSERT OR UPDATE OF
--      status) que mantém as duas colunas:
--        - INSERT já 'inativo'          -> inactivated_at = now(), approx = false
--        - UPDATE ativo -> inativo      -> inactivated_at = now(), approx = false
--        - UPDATE inativo -> ativo      -> inactivated_at = null,  approx = false
--      (reativação deixa de contar como saída; não há histórico de idas e vindas);
--   4) backfill: jogadores já 'inativo' sem data recebem updated_at como data
--      APROXIMADA (approx = true). O trigger players_set_updated_at é
--      desabilitado apenas durante o backfill para não sobrescrever updated_at.
--
-- A RLS existente de players cobre as novas colunas. Nenhuma action muda.
-- Forward-only e idempotente (add column if not exists, create or replace,
-- drop trigger if exists, backfill só onde inactivated_at is null).

alter table public.players
  add column if not exists inactivated_at timestamptz;

alter table public.players
  add column if not exists inactivated_at_approx boolean not null default false;

comment on column public.players.inactivated_at is
  'Instante em que o jogador passou para status inativo (null quando ativo). Mantido pelo trigger players_set_inactivated_at.';
comment on column public.players.inactivated_at_approx is
  'true quando inactivated_at foi estimado no backfill (a partir de updated_at); false para inativações registradas pelo trigger.';

create or replace function public.players_track_inactivation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'inativo' then
      new.inactivated_at := coalesce(new.inactivated_at, now());
      new.inactivated_at_approx := false;
    else
      new.inactivated_at := null;
      new.inactivated_at_approx := false;
    end if;
    return new;
  end if;

  -- UPDATE: só reage a mudança efetiva de status.
  if new.status is distinct from old.status then
    if new.status = 'inativo' then
      new.inactivated_at := now();
      new.inactivated_at_approx := false;
    elsif new.status = 'ativo' then
      new.inactivated_at := null;
      new.inactivated_at_approx := false;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists players_set_inactivated_at on public.players;
create trigger players_set_inactivated_at
  before insert or update of status on public.players
  for each row execute function public.players_track_inactivation();

-- Backfill: inativações antigas recebem updated_at como data APROXIMADA.
-- Desabilita players_set_updated_at só durante o UPDATE para preservar updated_at.
alter table public.players disable trigger players_set_updated_at;

update public.players
   set inactivated_at = updated_at,
       inactivated_at_approx = true
 where status = 'inativo'
   and inactivated_at is null;

alter table public.players enable trigger players_set_updated_at;
