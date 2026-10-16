-- Migration: tabela `access_logs` + RPC `authorize_password_reset`
-- Contexto (design.md §3.4): parte administrativa da plataforma para
-- auditoria de ACESSO (logins e resets de senha) e para autorizar o reset de
-- senha de um jogador. Dois artefatos nesta migration:
--
--   1) public.access_logs — trilha de auditoria de eventos de acesso. Grava
--      quem fez (actor), sobre quem (target), em qual clube, de qual IP/agente
--      e quando. Os eventos são 'login' (autenticação bem-sucedida) e
--      'password_reset' (presidente resetou a senha de um jogador).
--
--   2) public.authorize_password_reset(p_player_id) — RPC SECURITY DEFINER que
--      valida que o chamador é PRESIDENTE ativo do clube do jogador e resolve
--      o usuário-alvo (memberships.user_id) cuja senha será resetada. Não
--      executa o reset em si (isso é feito pela Admin API no servidor), apenas
--      AUTORIZA e devolve os identificadores necessários.
--
-- RLS de access_logs (apenas LEITURA para admin da plataforma):
--   - A única policy é de SELECT, restrita a `public.is_system_admin()`: só o
--     administrador da plataforma enxerga a trilha de acesso. Jogadores e
--     presidentes NÃO leem esta tabela.
--   - NÃO há policy de insert/update/delete. Com RLS habilitada e sem policy
--     de escrita, nenhum papel autenticado consegue gravar via RLS.
--
-- Por que o service role grava (bypass de RLS):
--   - A gravação de login acontece logo após a autenticação, e o reset é
--     disparado por um fluxo administrativo no servidor. Ambos usam o cliente
--     de SERVICE ROLE (ver src/lib/auth/access-log.ts), que contorna a RLS. É
--     intencional não existir policy de insert: a escrita é um privilégio do
--     servidor confiável, nunca do cliente/sessão.
--
-- Forward-only e aditiva: cria a tabela, os índices, a RLS e a RPC. Não altera
-- schema existente. Pré-requisitos já migrados: profiles (id), clubs (id),
-- players (16.4), memberships (16.2), helpers club_role/is_system_admin (17.1).

-- =====================================================================
-- Tabela public.access_logs
-- =====================================================================
create table if not exists public.access_logs (
  id             uuid        primary key default gen_random_uuid(),
  event_type     text        not null check (event_type in ('login', 'password_reset')),
  actor_user_id  uuid,
  target_user_id uuid,
  club_id        uuid        references public.clubs(id) on delete set null,
  ip             text,
  user_agent     text,
  created_at     timestamptz not null default now(),
  -- FKs NOMEADAS para profiles: ao apagar um perfil, preservamos a trilha de
  -- auditoria anulando a referência (on delete set null) em vez de remover a
  -- linha de log.
  constraint access_logs_actor_fk
    foreign key (actor_user_id) references public.profiles(id) on delete set null,
  constraint access_logs_target_fk
    foreign key (target_user_id) references public.profiles(id) on delete set null
);

comment on table public.access_logs is
  'Trilha de auditoria de acesso (login e reset de senha). Leitura só para admin da plataforma (RLS select is_system_admin); escrita apenas via service role (bypass de RLS), nunca pelo cliente.';

-- Índices: a listagem administrativa ordena por data desc e filtra por tipo.
create index if not exists access_logs_created_at_idx
  on public.access_logs (created_at desc);

create index if not exists access_logs_event_type_idx
  on public.access_logs (event_type);

-- =====================================================================
-- RLS: somente admin da plataforma LÊ; nenhuma policy de escrita
-- =====================================================================
alter table public.access_logs enable row level security;

create policy access_logs_select_admin
  on public.access_logs
  for select
  to authenticated
  using (public.is_system_admin());

-- =====================================================================
-- RPC public.authorize_password_reset(p_player_id)
-- =====================================================================
-- Valida autorização (presidente ativo do clube do jogador) e resolve o
-- usuário-alvo cuja senha será resetada. SECURITY DEFINER: a autorização é
-- feita explicitamente via public.club_role() sobre o clube do jogador.
create or replace function public.authorize_password_reset(p_player_id uuid)
returns table(target_user_id uuid, club_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_club_id uuid;
  v_user_id uuid;
begin
  -- ── Autenticação ──────────────────────────────────────────────────────────
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;

  -- ── Carrega o clube do jogador (ignorando jogadores apagados) ──────────────
  select p.club_id
    into v_club_id
    from public.players p
   where p.id = p_player_id
     and p.deleted_at is null;

  if not found then
    raise exception 'Jogador não encontrado: %.', p_player_id
      using errcode = 'P0002';
  end if;

  -- ── Autorização: só presidente ATIVO do clube do jogador ───────────────────
  if public.club_role(v_club_id) is distinct from 'presidente' then
    raise exception
      'Apenas o presidente do futebol pode resetar a senha.'
      using errcode = '42501';
  end if;

  -- ── Resolve a membership-alvo (conta de acesso vinculada ao jogador) ───────
  -- Determinístico: a membership ativa mais recente com user_id preenchido.
  select m.user_id
    into v_user_id
    from public.memberships m
   where m.player_id = p_player_id
     and m.club_id = v_club_id
     and m.status = 'ativo'
     and m.user_id is not null
   order by m.updated_at desc
   limit 1;

  if v_user_id is null then
    raise exception
      'Este jogador ainda não tem conta de acesso vinculada.'
      using errcode = '22023';
  end if;

  return query select v_user_id, v_club_id;
end;
$$;

comment on function public.authorize_password_reset(uuid) is
  'Autoriza o reset de senha de um jogador: valida que auth.uid() é presidente ativo do clube do jogador e resolve o usuário-alvo (memberships.user_id) cuja senha será resetada. NÃO executa o reset (feito pela Admin API no servidor). Errcodes: 28000 (não autenticado), P0002 (jogador não encontrado), 42501 (não autorizado), 22023 (jogador sem conta de acesso). SECURITY DEFINER. Retorna (target_user_id, club_id).';

-- Permissões: usuários autenticados podem chamar; a autorização fina
-- (presidente ativo do clube) é feita dentro da função.
revoke all on function public.authorize_password_reset(uuid) from public;
grant execute on function public.authorize_password_reset(uuid) to authenticated;
