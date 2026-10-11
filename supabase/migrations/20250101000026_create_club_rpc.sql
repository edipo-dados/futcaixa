-- Migration: RPC `create_club` — criação atômica de futebol (tarefa 20.1)
-- Requisitos: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
--
-- Contexto (design.md, fluxo 3 "Criar futebol"): criar um futebol é uma
-- operação ATÔMICA (Req 3.6) que, numa única transação:
--   1) valida que o chamador é um presidente APROVADO
--      (profiles.president_status = 'aprovado') — Req 2.2/2.6;
--   2) insere a linha em `clubs` com `created_by = auth.uid()` e um
--      `invite_code` único e estável (default da própria tabela) — Req 3.1/3.5;
--   3) insere a membership do criador (`role = presidente`, `status = ativo`)
--      — Req 3.4;
--   4) insere a `settings` do clube (uma linha por clube) — Req 3.2;
--   5) semeia as categorias padrão do clube via `seed_club_categories` — Req 3.3;
--   6) registra a ação no `audit_log` com `club_id` do novo clube — Req 3.7;
--   7) retorna o `club_id`.
--
-- Como tudo roda dentro do corpo de uma função PL/pgSQL, qualquer exceção em
-- qualquer etapa aborta a transação inteira: ou `clubs` + `settings` +
-- categorias + membership de presidente existem juntos, ou nada é persistido
-- (Req 3.6 — rollback total).
--
-- SECURITY DEFINER + `set search_path = public`: a função roda com os
-- privilégios do dono (contorna RLS para conseguir inserir em todas as tabelas
-- do clube recém-criado numa só transação), mas a AUTORIZAÇÃO é feita
-- explicitamente no início (checagem de president_status), de modo que apenas
-- presidentes aprovados consigam criar futebóis. `auth.uid()` continua
-- refletindo o usuário autenticado que chamou a RPC.
--
-- Esta migration é ADITIVA e PARA FRENTE: cria apenas a função `create_club`.
-- Não altera dados nem schema de tabelas. Pré-requisitos (já migrados):
--   - clubs .................. migration 16.1 (20250101000013)
--   - profiles multi-tenant .. migration 16.3 (20250101000014)
--   - memberships ............ migration 16.2 (20250101000015)
--   - club_id/settings ....... migration 16.4 (20250101000016)
--   - seed_club_categories ... migration 16.5 (20250101000017)

create or replace function public.create_club(
  p_name                  text,
  p_pix_key               text,
  p_pix_receiver_name     text,
  p_pix_city              text,
  p_default_monthly_cents integer default 0,
  p_default_drop_in_cents integer default 0,
  p_due_day               smallint default 10,
  p_generation_day        smallint default 1,
  p_initial_balance_cents integer default 0,
  p_logo_path             text default null,
  p_slug                  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid              uuid := auth.uid();
  v_president_status text;
  v_club_id          uuid;
  v_settings_id      smallint;
  v_name             text := btrim(coalesce(p_name, ''));
begin
  -- ── Autorização (Req 2.2/2.6): só presidente APROVADO cria futebol ──────
  if v_uid is null then
    raise exception 'Usuário não autenticado.' using errcode = '28000';
  end if;

  select president_status
    into v_president_status
    from public.profiles
   where id = v_uid;

  if v_president_status is distinct from 'aprovado' then
    raise exception
      'Apenas um presidente aprovado pode criar um futebol (president_status atual: %).',
      coalesce(v_president_status, 'desconhecido')
      using errcode = '42501';
  end if;

  -- ── Validações mínimas de entrada (defesa em profundidade) ──────────────
  if v_name = '' then
    raise exception 'O nome do futebol é obrigatório.' using errcode = '23514';
  end if;

  -- ── 1) clubs (Req 3.1/3.5): invite_code vem do default da tabela ────────
  insert into public.clubs (name, slug, created_by, logo_path)
  values (v_name, p_slug, v_uid, p_logo_path)
  returning id into v_club_id;

  -- ── 2) membership do criador: presidente / ativo (Req 3.4) ──────────────
  insert into public.memberships (user_id, club_id, role, status)
  values (v_uid, v_club_id, 'presidente', 'ativo');

  -- ── 3) settings do clube — uma linha por clube (Req 3.2) ────────────────
  -- `settings.id` é smallint com default 1 (herança do antigo singleton);
  -- precisamos informar um id explícito para não colidir a PK ao inserir por
  -- clube. Usamos o próximo id disponível.
  select coalesce(max(id), 0) + 1 into v_settings_id from public.settings;

  insert into public.settings (
    id,
    club_id,
    club_name,
    logo_path,
    pix_key,
    pix_receiver_name,
    pix_city,
    default_monthly_cents,
    default_drop_in_cents,
    due_day,
    generation_day,
    initial_balance_cents
  )
  values (
    v_settings_id,
    v_club_id,
    v_name,
    p_logo_path,
    coalesce(p_pix_key, ''),
    coalesce(p_pix_receiver_name, ''),
    coalesce(p_pix_city, ''),
    coalesce(p_default_monthly_cents, 0),
    coalesce(p_default_drop_in_cents, 0),
    coalesce(p_due_day, 10),
    coalesce(p_generation_day, 1),
    coalesce(p_initial_balance_cents, 0)
  );

  -- ── 4) categorias padrão do clube (Req 3.3) ─────────────────────────────
  perform public.seed_club_categories(v_club_id);

  -- ── 5) auditoria da criação do futebol (Req 3.7) ────────────────────────
  insert into public.audit_log (club_id, actor_id, action, entity, entity_id, before, after)
  values (
    v_club_id,
    v_uid,
    'club.create',
    'clubs',
    v_club_id,
    null,
    jsonb_build_object('id', v_club_id, 'name', v_name)
  );

  -- ── 6) retorna o id do futebol criado ───────────────────────────────────
  return v_club_id;
end;
$$;

comment on function public.create_club(
  text, text, text, text, integer, integer, smallint, smallint, integer, text, text
) is
  'Cria um futebol de forma ATÔMICA (Req 3.6): clubs + membership (presidente/ativo) + settings + categorias padrão + auditoria, numa única transação. Valida president_status=aprovado do chamador (auth.uid()). SECURITY DEFINER. Retorna o club_id.';

-- Permissões de execução: usuários autenticados podem chamar a RPC; a
-- autorização fina (presidente aprovado) é feita dentro da função.
revoke all on function public.create_club(
  text, text, text, text, integer, integer, smallint, smallint, integer, text, text
) from public;

grant execute on function public.create_club(
  text, text, text, text, integer, integer, smallint, smallint, integer, text, text
) to authenticated;
