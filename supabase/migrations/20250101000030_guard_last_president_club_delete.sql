-- Migration: corrige guard_last_president para não bloquear a exclusão do clube (tarefa 25.x / bug)
-- Requisitos: 5.5 (guarda do último presidente) sem quebrar a exclusão de clube.
--
-- BUG corrigido: a função `guard_last_president` (migration 2.29) dispara em
-- BEFORE DELETE de `memberships` e levanta exceção quando a remoção deixaria o
-- clube sem presidente ativo. Isso é correto para a remoção/rebaixamento
-- AVULSO de um presidente, MAS também disparava durante o `ON DELETE CASCADE`
-- de `clubs` → `memberships`: ao apagar um clube inteiro, suas memberships
-- (incluindo a do presidente) são removidas em cascata, e o guard abortava a
-- operação com "O clube precisa de ao menos um presidente." — tornando QUALQUER
-- clube com presidente IMPOSSÍVEL de excluir (por system_admin ou qualquer via).
--
-- CORREÇÃO: quando o próprio clube está sendo removido, não há presidência a
-- preservar. No ramo DELETE, se o clube de `old.club_id` NÃO existe mais
-- (está sendo apagado em cascata) OU está marcado como arquivado
-- (`deleted_at` não nulo), a guarda é dispensada e o DELETE da membership é
-- permitido. Para a remoção avulsa de um presidente (o clube continua
-- existindo e ativo), a guarda do último presidente permanece em pleno vigor.
--
-- Idempotente: `create or replace function` (o trigger da 2.29 continua
-- apontando para esta função; não precisa recriá-lo).

create or replace function public.guard_last_president()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_active_president boolean;
  v_still_active_president boolean;
  v_other_presidents integer;
  v_club_gone boolean;
begin
  -- A linha afetada era um presidente ativo?
  v_was_active_president := (old.role = 'presidente' and old.status = 'ativo');

  if not v_was_active_president then
    -- Não era presidente ativo: a operação não pode esvaziar a presidência.
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  -- No UPDATE, a linha continua sendo presidente ativo? (ex.: trocaram só o
  -- player_id). Se continuar, não há risco de esvaziar a presidência.
  if tg_op = 'UPDATE' then
    v_still_active_president := (new.role = 'presidente' and new.status = 'ativo');
    if v_still_active_president then
      return new;
    end if;
  end if;

  -- CORREÇÃO (exclusão do clube): num DELETE, se o clube não existe mais (está
  -- sendo removido em cascata) ou foi arquivado (deleted_at), não há presidência
  -- a preservar — libera a remoção da membership.
  if tg_op = 'DELETE' then
    select not exists (
      select 1 from public.clubs c
      where c.id = old.club_id and c.deleted_at is null
    ) into v_club_gone;

    if v_club_gone then
      return old;
    end if;
  end if;

  -- A linha deixaria de ser presidente ativo (rebaixamento, recusa ou DELETE
  -- avulso) e o clube continua existindo/ativo. Quantos OUTROS presidentes
  -- ativos restam no clube?
  select count(*)
    into v_other_presidents
    from public.memberships
   where club_id = old.club_id
     and role = 'presidente'
     and status = 'ativo'
     and id <> old.id;

  if v_other_presidents = 0 then
    raise exception 'O clube precisa de ao menos um presidente.'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.guard_last_president() is
  'Impede rebaixar/recusar/remover o ÚLTIMO presidente ativo de um clube ATIVO (Req 5.5). Dispensada quando o próprio clube está sendo excluído/arquivado (não bloqueia o ON DELETE CASCADE de clubs). BEFORE UPDATE/DELETE em memberships; errcode 23514.';
