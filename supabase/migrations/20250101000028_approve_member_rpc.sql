-- Migration: RPC `approve_member` — aprovar membro pendente (tarefa 20.3)
-- Requisitos: 4.5, 4.6, 4.7, 4.8, 4.9
--
-- Contexto (design.md, fluxo 5 "Aprovar membro → vincula a um jogador"): ao
-- aprovar um membro `pendente`, o presidente escolhe o TIPO de jogador
-- (`mensalista` | `avulso`) e o sistema, numa única transação:
--   1) valida que `auth.uid()` é presidente ATIVO do clube da membership
--      (Req 4.8 — negar a quem não é presidente);
--   2) cria uma linha em `players` daquele clube (nome a partir do profile do
--      usuário, tipo escolhido, demais campos com defaults válidos) — Req 4.6;
--   3) preenche `memberships.player_id` com o novo jogador e muda o
--      `status` para `ativo` — Req 4.6;
--   4) registra a ação no `audit_log` com o `club_id` do clube — Req 4.9.
--
-- Membros `avulso` NÃO entram na geração automática de mensalidades (Req 4.7):
-- o cron de mensalidades (lib/players/active-mensalistas.ts +
-- lib/cron/gerar-mensalidades.ts) filtra `players.type = 'mensalista'`. Gravar
-- o jogador com `type = 'avulso'` é, portanto, suficiente para que ele seja
-- IGNORADO pela geração de mensalidades — a receita de avulso entra por
-- cobrança avulsa, não por mensalidade.
--
-- ATOMICIDADE (two writes → uma transação): criar o `players` e atualizar a
-- `memberships` são duas escritas. Fazê-las no cliente deixaria uma janela em
-- que o player existe mas a membership não foi vinculada (ou vice-versa) se a
-- segunda falhar. Como todo o corpo PL/pgSQL roda numa única transação,
-- qualquer exceção aborta tudo: ou player + vínculo existem juntos, ou nada.
--
-- IDEMPOTÊNCIA: se a membership já estiver `ativo` com um `player_id`, a função
-- é no-op e devolve o `player_id` existente (reaplicar a aprovação não cria um
-- segundo jogador nem revê o estado).
--
-- SECURITY DEFINER + `set search_path = public`: a função roda com os
-- privilégios do dono (contorna RLS para inserir em `players` e atualizar
-- `memberships`/`audit_log` numa só transação), MAS a AUTORIZAÇÃO é feita
-- explicitamente no início via `public.club_role(...)` sobre o clube da
-- membership — somente o presidente ativo do clube passa. `auth.uid()` reflete
-- o usuário autenticado que chamou a RPC.
--
-- Esta migration é ADITIVA e PARA FRENTE: cria apenas a função `approve_member`.
-- Não altera schema de tabelas, dados nem a RLS existente. Pré-requisitos já
-- migrados: memberships (16.2), players + club_id (16.4), helpers de RLS como
-- `club_role` (17.1), audit_log + club_id (2.4 / 16.4).

create or replace function public.approve_member(
  p_membership_id uuid,
  p_tipo          text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_club_id     uuid;
  v_status      text;
  v_player_id   uuid;
  v_user_id     uuid;
  v_player_name text;
begin
  -- ── Autenticação ────────────────────────────────────────────────────────
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;

  -- ── Validação do tipo escolhido (Req 4.6) ────────────────────────────────
  -- Apenas 'mensalista' | 'avulso' são aprováveis aqui (design.md fluxo 5);
  -- 'convidado' existe no CHECK de players, mas não é opção de aprovação.
  if p_tipo is null or p_tipo not in ('mensalista', 'avulso') then
    raise exception
      'Tipo de jogador inválido: % (esperado mensalista ou avulso).', coalesce(p_tipo, 'nulo')
      using errcode = '22023';
  end if;

  -- ── Carrega a membership alvo ─────────────────────────────────────────────
  select m.club_id, m.status, m.player_id, m.user_id
    into v_club_id, v_status, v_player_id, v_user_id
    from public.memberships m
   where m.id = p_membership_id;

  if not found then
    raise exception 'Membership não encontrada: %.', p_membership_id
      using errcode = 'P0002';
  end if;

  -- ── Autorização (Req 4.8): só presidente ATIVO do clube da membership ─────
  if public.club_role(v_club_id) is distinct from 'presidente' then
    raise exception
      'Apenas o presidente do futebol pode aprovar membros.'
      using errcode = '42501';
  end if;

  -- ── Idempotência: já ativo com jogador vinculado → no-op ──────────────────
  if v_status = 'ativo' and v_player_id is not null then
    return v_player_id;
  end if;

  -- Só aprovamos quem está PENDENTE (não "reativamos" um recusado por aqui).
  if v_status is distinct from 'pendente' then
    raise exception
      'Só é possível aprovar uma membership pendente (status atual: %).', v_status
      using errcode = '22023';
  end if;

  -- ── Nome do jogador a partir do profile do usuário ────────────────────────
  select nullif(btrim(coalesce(p.full_name, '')), '')
    into v_player_name
    from public.profiles p
   where p.id = v_user_id;

  v_player_name := coalesce(v_player_name, 'Jogador sem nome');

  -- ── 1) Cria o jogador do clube (Req 4.6) ─────────────────────────────────
  -- Demais campos usam os defaults da tabela players (status 'ativo',
  -- skill_level 1, is_exempt false, valores personalizados nulos).
  insert into public.players (club_id, name, type)
  values (v_club_id, v_player_name, p_tipo)
  returning id into v_player_id;

  -- ── 2) Vincula e ativa a membership (Req 4.6) ─────────────────────────────
  update public.memberships
     set player_id = v_player_id,
         status    = 'ativo'
   where id = p_membership_id;

  -- ── 3) Auditoria da aprovação, escopada ao clube (Req 4.9) ────────────────
  -- memberships/players não têm trigger de auditoria (ver migration 2.4, que
  -- só cobre transactions/charges/payment_proofs/settings), então registramos
  -- explicitamente aqui.
  insert into public.audit_log (club_id, actor_id, action, entity, entity_id, before, after)
  values (
    v_club_id,
    v_uid,
    'membership.approve',
    'memberships',
    p_membership_id,
    jsonb_build_object('status', 'pendente'),
    jsonb_build_object(
      'status', 'ativo',
      'player_id', v_player_id,
      'player_type', p_tipo
    )
  );

  return v_player_id;
end;
$$;

comment on function public.approve_member(uuid, text) is
  'Aprova uma membership pendente (Req 4.5-4.9) de forma ATÔMICA: cria o players do clube com o tipo escolhido (mensalista|avulso), vincula memberships.player_id e muda status para ativo, e audita no audit_log do clube. Valida que auth.uid() é presidente ativo do clube (Req 4.8). avulso não entra na geração de mensalidades (Req 4.7). Idempotente: no-op se já ativo. SECURITY DEFINER. Retorna o players.id vinculado.';

-- Permissões: usuários autenticados podem chamar; a autorização fina
-- (presidente ativo do clube) é feita dentro da função.
revoke all on function public.approve_member(uuid, text) from public;
grant execute on function public.approve_member(uuid, text) to authenticated;
