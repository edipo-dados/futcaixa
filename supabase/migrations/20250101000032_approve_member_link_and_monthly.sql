-- Migration: approve_member v2 — vincular a jogador existente + mensalidade do mês
-- Função: public.approve_member (recriada; agora com p_player_id opcional)
-- Requisitos: 4.5, 4.6, 4.7, 4.9, 5.1, 5.2
--
-- MUDANÇAS EM RELAÇÃO À 20250101000028
-- ------------------------------------------------------------------
-- 1) VINCULAR A JOGADOR JÁ CADASTRADO (novo p_player_id).
--    Antes, aprovar um membro SEMPRE criava um novo `players`. Na prática o
--    presidente costuma cadastrar o jogador manualmente em /jogadores ANTES de
--    o jogador entrar pelo link de convite — gerando dois registros para a
--    mesma pessoa. Agora a aprovação aceita um `p_player_id` opcional:
--      - p_player_id INFORMADO → VINCULA a membership a esse jogador existente
--        (sem criar outro). Valida que o jogador pertence ao mesmo clube, não
--        está excluído e ainda NÃO está vinculado a outra membership. O `p_tipo`
--        é aplicado ao jogador existente (atualiza players.type).
--      - p_player_id NULO → cria o jogador (comportamento anterior).
--
-- 2) MENSALIDADE DO MÊS AO APROVAR (geração imediata, Req 5.1/5.2).
--    Ao aprovar como `mensalista` (jogador ativo e não isento), geramos JÁ a
--    cobrança de mensalidade do PERÍODO CORRENTE (status 'pendente'), em vez de
--    esperar o cron mensal. É idempotente: a inserção respeita o índice único
--    parcial `charges(club_id, player_id, period) WHERE kind='mensalidade' AND
--    deleted_at IS NULL`; se a mensalidade do mês já existir (ex.: cron já
--    rodou), a violação 23505 é capturada e ignorada. `avulso` NÃO gera
--    mensalidade (Req 4.7). Jogador sem valor cobrável (padrão 0 e sem
--    personalizado) é pulado — não faz sentido cobrar R$ 0,00.
--
-- O período e o vencimento seguem a mesma convenção do cron
-- (lib/cron/gerar-mensalidades.ts): período = mês corrente (YYYY-MM, timezone
-- America/Sao_Paulo); vencimento = settings.due_day dentro do próprio mês
-- (due_day restrito a 1..28, então o dia sempre existe). O txid é gerado em SQL
-- como string hex de até 25 chars (compatível com generateTxid()/EMV).
--
-- ATOMICIDADE: criar/vincular o player, ativar a membership, auditar e gerar a
-- mensalidade acontecem numa única transação PL/pgSQL. Qualquer exceção
-- (exceto a 23505 da mensalidade, tratada internamente) aborta tudo.
--
-- SECURITY DEFINER + search_path=public: roda com privilégios do dono (contorna
-- RLS), mas AUTORIZA explicitamente via public.club_role() — só o presidente
-- ativo do clube da membership passa.
--
-- Forward-only: substitui a função. Como a NOVA assinatura ganha um 3º
-- parâmetro COM default, ela NÃO sobrescreve a de 2 args (seriam dois overloads
-- coexistindo). Isso quebraria chamadas com 2 argumentos por ambiguidade de
-- overload (PostgREST PGRST203). Por isso DERRUBAMOS explicitamente a função de
-- 2 args da migration 20250101000028 antes de criar a nova — assim a de 3 args
-- (com default no 3º) atende tanto chamadas de 2 quanto de 3 argumentos.

drop function if exists public.approve_member(uuid, text);

create or replace function public.approve_member(
  p_membership_id uuid,
  p_tipo          text,
  p_player_id     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid            uuid := auth.uid();
  v_club_id        uuid;
  v_status         text;
  v_player_id      uuid;
  v_user_id        uuid;
  v_player_name    text;
  -- Dados para a geração imediata da mensalidade.
  v_player_type    text;
  v_player_exempt  boolean;
  v_player_status  text;
  v_default_cents  integer;
  v_due_day        integer;
  v_amount_cents   integer;
  v_period         text;
  v_due_date       date;
  v_txid           text;
begin
  -- ── Autenticação ────────────────────────────────────────────────────────
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;

  -- ── Validação do tipo escolhido (Req 4.6) ────────────────────────────────
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

  -- Só aprovamos quem está PENDENTE.
  if v_status is distinct from 'pendente' then
    raise exception
      'Só é possível aprovar uma membership pendente (status atual: %).', v_status
      using errcode = '22023';
  end if;

  if p_player_id is not null then
    -- ══ Caminho A: VINCULAR a um jogador JÁ cadastrado ════════════════════
    -- Valida que o jogador existe, é do MESMO clube e não foi excluído.
    select pl.id, pl.type, pl.is_exempt, pl.status
      into v_player_id, v_player_type, v_player_exempt, v_player_status
      from public.players pl
     where pl.id = p_player_id
       and pl.club_id = v_club_id
       and pl.deleted_at is null;

    if not found then
      raise exception
        'Jogador % não encontrado neste futebol.', p_player_id
        using errcode = 'P0002';
    end if;

    -- O jogador não pode já estar vinculado a OUTRA membership (1 player ↔ 1
    -- membership por clube). Permite revincular se, por acaso, for esta mesma.
    if exists (
      select 1 from public.memberships m2
       where m2.player_id = p_player_id
         and m2.id <> p_membership_id
    ) then
      raise exception
        'Este jogador já está vinculado a outro membro.'
        using errcode = '23505';
    end if;

    -- Aplica o tipo escolhido ao jogador existente (ex.: marcar como
    -- mensalista) e garante que esteja ativo para entrar nas cobranças.
    update public.players
       set type = p_tipo
     where id = p_player_id;

    v_player_type   := p_tipo;
  else
    -- ══ Caminho B: CRIAR o jogador (comportamento anterior) ═══════════════
    select nullif(btrim(coalesce(p.full_name, '')), '')
      into v_player_name
      from public.profiles p
     where p.id = v_user_id;

    v_player_name := coalesce(v_player_name, 'Jogador sem nome');

    insert into public.players (club_id, name, type)
    values (v_club_id, v_player_name, p_tipo)
    returning id, type, is_exempt, status
      into v_player_id, v_player_type, v_player_exempt, v_player_status;
  end if;

  -- ── Vincula e ativa a membership (Req 4.6) ────────────────────────────────
  update public.memberships
     set player_id = v_player_id,
         status    = 'ativo'
   where id = p_membership_id;

  -- ── Auditoria da aprovação, escopada ao clube (Req 4.9) ───────────────────
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
      'player_type', p_tipo,
      'linked_existing', (p_player_id is not null)
    )
  );

  -- ── Geração imediata da mensalidade do mês (Req 5.1/5.2) ──────────────────
  -- Só para mensalista ativo e não isento. Avulso não gera (Req 4.7).
  if v_player_type = 'mensalista'
     and coalesce(v_player_exempt, false) = false
     and coalesce(v_player_status, 'ativo') = 'ativo'
  then
    -- Período corrente e dia de vencimento a partir da settings do clube.
    v_period := to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM');

    select s.default_monthly_cents, s.due_day
      into v_default_cents, v_due_day
      from public.settings s
     where s.club_id = v_club_id;

    -- due_day fora de 1..28 cai para o default 10 (igual ao cron).
    if v_due_day is null or v_due_day < 1 or v_due_day > 28 then
      v_due_day := 10;
    end if;

    -- Valor: personalizado do jogador ?? padrão da settings. Pula se <= 0.
    select pl.custom_monthly_cents
      into v_amount_cents
      from public.players pl
     where pl.id = v_player_id;

    v_amount_cents := coalesce(v_amount_cents, v_default_cents);

    if v_amount_cents is not null and v_amount_cents > 0 then
      v_due_date := to_date(v_period || '-' || lpad(v_due_day::text, 2, '0'), 'YYYY-MM-DD');
      -- txid hex de até 25 chars (compatível com generateTxid()/EMV campo 05).
      v_txid := substr(
        replace(gen_random_uuid()::text, '-', '') ||
        replace(gen_random_uuid()::text, '-', ''),
        1, 25
      );

      begin
        insert into public.charges (
          club_id, player_id, amount_cents, description, kind, period,
          due_date, status, txid
        )
        values (
          v_club_id, v_player_id, v_amount_cents,
          'Mensalidade ' || v_period, 'mensalidade', v_period,
          v_due_date, 'pendente', v_txid
        );
      exception
        when unique_violation then
          -- Mensalidade do mês já existe (ex.: cron já rodou): idempotente.
          null;
      end;
    end if;
  end if;

  return v_player_id;
end;
$$;

comment on function public.approve_member(uuid, text, uuid) is
  'Aprova uma membership pendente (Req 4.5-4.9) de forma ATÔMICA. Com p_player_id NULO cria o jogador; com p_player_id informado VINCULA a membership a um jogador já cadastrado do mesmo clube (valida clube/duplicidade) e aplica o tipo. Ativa a membership, audita e, para mensalista ativo não isento, GERA a mensalidade do mês corrente (status pendente, idempotente via índice único; avulso não gera — Req 4.7/5.1/5.2). Valida que auth.uid() é presidente ativo do clube. SECURITY DEFINER. Retorna o players.id vinculado.';

-- Permissões para a nova assinatura (3 args). A autorização fina é interna.
revoke all on function public.approve_member(uuid, text, uuid) from public;
grant execute on function public.approve_member(uuid, text, uuid) to authenticated;
