-- Migration: guarda do ÚLTIMO presidente + RPC set_member_role (tarefa 20.4)
-- Requisitos: 5.1, 5.5, 5.6
--
-- Contexto (design.md "Papéis por futebol e promoção de membros", Req 5):
-- o presidente promove/rebaixa membros do seu futebol alterando
-- `memberships.role` (`presidente | tesoureiro | jogador`). Há, porém, uma
-- invariante crítica: um futebol SEMPRE precisa de pelo menos UM presidente
-- ATIVO. Não pode ficar "órfão" por rebaixamento, recusa ou remoção do último
-- presidente (Req 5.5 — inferido do papel administrativo do presidente).
--
-- Esta migration entrega duas camadas complementares:
--
--   1) GUARDA NO BANCO (à prova de corrida) — trigger BEFORE UPDATE/DELETE em
--      `memberships`. Antes de efetivar uma mudança que deixaria de haver um
--      presidente ativo (rebaixar, recusar, ou apagar o último presidente), o
--      trigger CONTA quantos presidentes ativos restariam e, se cair a zero,
--      levanta exceção (errcode '23514'). Por ser no banco, vale para QUALQUER
--      caminho de escrita (RPC, SQL direto, app) e não tem janela de corrida:
--      a contagem acontece dentro da mesma transação do UPDATE/DELETE.
--
--   2) RPC `set_member_role(p_membership_id, p_role)` (SECURITY DEFINER) — a
--      porta oficial do app para trocar papel. Valida que o ATOR é presidente
--      ATIVO do MESMO clube da membership-alvo (Req 5.5 — negar a não
--      presidente), aplica a troca (confiando no trigger para a guarda do
--      último presidente) e registra AUDITORIA com `club_id` (Req 5.6).
--
-- Sobre AUDITORIA (Req 5.6): a função genérica `public.audit_trigger()`
-- (migration 2.4) NÃO está anexada a `memberships` e, além disso, não grava
-- `club_id`. Por isso a RPC grava explicitamente a linha de `audit_log` com o
-- `club_id` do clube, a ação `memberships.role_update` e os valores
-- before/after do papel.
--
-- Esta migration é ADITIVA e PARA FRENTE: cria uma função de trigger, um
-- trigger em `memberships` e a RPC. Não altera dados nem colunas. Usa
-- `create or replace` / `drop ... if exists` para ser reaplicável.
--
-- Pré-requisitos (já migrados):
--   - memberships ............ migration 16.2 (20250101000015)
--   - audit_log + club_id .... migrations 2.4 / 16.4
--   - club_role() ............ migration 17.1 (20250101000019)

-- =====================================================================
-- 1) Função + trigger: guarda do último presidente ativo
-- =====================================================================
-- Dispara BEFORE UPDATE OR DELETE em memberships. Só precisa agir quando a
-- linha afetada ERA um presidente ativo e deixaria de sê-lo:
--   - DELETE de um presidente ativo; OU
--   - UPDATE que tire o papel 'presidente' (role != 'presidente') OU
--     tire o status 'ativo' (status != 'ativo').
-- Nesses casos conta os OUTROS presidentes ativos do mesmo clube; se não
-- houver nenhum, bloqueia (o clube ficaria sem presidente).
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

  -- A linha deixaria de ser presidente ativo (rebaixamento, recusa ou DELETE).
  -- Quantos OUTROS presidentes ativos restam no clube?
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
  'Impede rebaixar/recusar/remover o ÚLTIMO presidente ativo de um clube (Req 5.5). BEFORE UPDATE/DELETE em memberships; levanta exceção (23514) se a presidência ficaria vazia.';

drop trigger if exists memberships_guard_last_president on public.memberships;
create trigger memberships_guard_last_president
  before update or delete on public.memberships
  for each row execute function public.guard_last_president();

-- =====================================================================
-- 2) RPC set_member_role — troca de papel pela porta oficial do app
-- =====================================================================
-- Valida que o ator é presidente ATIVO do MESMO clube da membership-alvo
-- (Req 5.5 — negar a quem não é presidente), aplica a troca de papel
-- (confiando no trigger acima para a guarda do último presidente) e audita
-- com club_id (Req 5.6). SECURITY DEFINER para ler/escrever memberships e
-- audit_log de forma consistente; a autorização é explícita no corpo.
create or replace function public.set_member_role(
  p_membership_id uuid,
  p_role          text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_club_id   uuid;
  v_old_role  text;
  v_status    text;
  v_actor_role text;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;

  if p_role not in ('presidente', 'tesoureiro', 'jogador') then
    raise exception 'Papel inválido.' using errcode = '22023';
  end if;

  -- Carrega a membership-alvo.
  select club_id, role, status
    into v_club_id, v_old_role, v_status
    from public.memberships
   where id = p_membership_id;

  if v_club_id is null then
    raise exception 'Membro não encontrado.' using errcode = 'P0002';
  end if;

  -- Autorização: o ator precisa ser presidente ATIVO do MESMO clube (Req 5.5).
  select role
    into v_actor_role
    from public.memberships
   where user_id = v_uid
     and club_id = v_club_id
     and status = 'ativo';

  if v_actor_role is distinct from 'presidente' then
    raise exception 'Apenas o presidente do futebol pode alterar papéis.'
      using errcode = '42501';
  end if;

  -- Só faz sentido alterar papel de membros ATIVOS.
  if v_status <> 'ativo' then
    raise exception 'Só é possível alterar o papel de membros ativos.'
      using errcode = '23514';
  end if;

  -- Nada a fazer se o papel não mudou (evita auditoria/UPDATE desnecessários).
  if v_old_role = p_role then
    return;
  end if;

  -- Aplica a troca. Se rebaixar o último presidente, o trigger
  -- guard_last_president() aborta a transação (errcode 23514).
  update public.memberships
     set role = p_role
   where id = p_membership_id;

  -- Auditoria explícita com club_id (Req 5.6): a função genérica de auditoria
  -- não está anexada a memberships e não grava club_id.
  insert into public.audit_log (club_id, actor_id, action, entity, entity_id, before, after)
  values (
    v_club_id,
    v_uid,
    'memberships.role_update',
    'memberships',
    p_membership_id,
    jsonb_build_object('role', v_old_role),
    jsonb_build_object('role', p_role)
  );
end;
$$;

comment on function public.set_member_role(uuid, text) is
  'Troca memberships.role (jogador|tesoureiro|presidente) validando que o ator é presidente ativo do mesmo clube (Req 5.5). Confia no trigger guard_last_president para a guarda do último presidente. Audita com club_id (Req 5.6). SECURITY DEFINER.';

revoke all on function public.set_member_role(uuid, text) from public;
grant execute on function public.set_member_role(uuid, text) to authenticated;
