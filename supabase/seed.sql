-- ============================================================================
-- Seed de exemplo — FutCaixa MULTI-TENANT (tarefa 24.1)
-- Requisito 19.1: dados de exemplo escopados a UM futebol (club_id de exemplo):
--   * 1 system_admin de exemplo (is_system_admin = true);
--   * 1 futebol "Pelada do Sábado" com invite_code e settings do clube;
--   * 1 presidente (membership presidente/ativa, president_status aprovado);
--   * alguns jogadores vinculados (memberships jogador/ativo com player_id) +
--     os 10 players do clube;
--   * categorias padrão do clube (via public.seed_club_categories);
--   * ~6 meses de cobranças/lançamentos/metas/recorrentes — TUDO com club_id.
-- Suficiente para popular TODOS os dashboards por clube:
--   v_monthly_summary, v_balance_history, v_category_breakdown,
--   v_delinquency_rate, v_recent_expenses (todos filtram por club_id).
--
-- ============================================================================
-- CREDENCIAIS DE EXEMPLO (apenas DEV — NÃO usar em produção)
-- ----------------------------------------------------------------------------
--   system_admin : admin@futcaixa.dev      / senha: futcaixa123
--   presidente   : presidente@futcaixa.dev / senha: futcaixa123
--   (jogadores de exemplo NÃO têm login criado por padrão — ver nota de auth)
--
-- COMO RODAR
-- ----------------------------------------------------------------------------
--   * `supabase db reset`  -> aplica as migrations e executa este seed.sql
--     automaticamente (fluxo recomendado em dev). O seed roda como owner/
--     superuser, então PODE inserir em `auth.users`/`auth.identities` e
--     escrever em todas as tabelas (a RLS não bloqueia o dono).
--   * Alternativa manual (banco já migrado, com privilégios de owner):
--       psql "$DATABASE_URL" -f supabase/seed.sql
--
-- NOTA SOBRE AUTH (auth.users) — LEIA
-- ----------------------------------------------------------------------------
-- `profiles.id` referencia `auth.users(id)` e `memberships.user_id` referencia
-- `profiles.id`. Para existir um system_admin e um presidente "logáveis" em
-- dev, o seed cria DUAS linhas em `auth.users` (com id/uuid fixos, e-mail
-- confirmado e senha via `crypt(... , gen_salt('bf'))`) + a linha
-- correspondente em `auth.identities`. O trigger `handle_new_user` (migration
-- 20250101000012) cria o `profiles` automaticamente a cada INSERT em
-- auth.users; depois apenas AJUSTAMOS os flags do perfil (is_system_admin /
-- president_status). Esse é o padrão comum de seed Supabase local.
--
-- Portabilidade: inserir em `auth.users` exige rodar como OWNER do schema auth
-- (é o caso em `supabase db reset` e com a service_role/owner no psql). Se, no
-- seu ambiente, o seed NÃO tiver permissão para escrever em `auth.*`, o bloco
-- de auth abaixo falhará; nesse caso rode-o separadamente com um papel owner,
-- ou crie os dois usuários pelo painel/Auth Admin API e ajuste os UUIDs fixos
-- abaixo. Os UUIDs são FIXOS justamente para o restante do seed poder
-- referenciá-los de forma determinística.
--
-- IDEMPOTÊNCIA / AMBIENTE
-- ----------------------------------------------------------------------------
-- Escrito para ser RE-EXECUTÁVEL num banco migrado:
--   * auth.users/identities, profiles, clubs, settings e memberships usam
--     UUIDs fixos + ON CONFLICT DO NOTHING / UPDATE guardado.
--   * `settings` é uma linha por clube (club_id UNIQUE): UPSERT por club_id.
--   * categorias vêm de `public.seed_club_categories(club_id)` (idempotente).
--   * `players` usam ON CONFLICT no índice único de e-mail -> não duplicam;
--     o club_id é resolvido pelo UUID fixo do clube de exemplo.
--   * `charges` de mensalidade respeitam o índice único parcial
--     (club_id, player_id, period) e geram `txid` determinístico
--     ('seed:' || club || ':' || period || ':' || player_id).
--   * `transactions`, `goals` e `recurring_expenses` são guardados por
--     `where not exists (...)` sobre uma chave de negócio estável + club_id.
-- Datas são RELATIVAS a `current_date` (os 6 meses sempre terminam no mês atual).
--
-- CONVENÇÕES
-- ----------------------------------------------------------------------------
--   * Dinheiro sempre em CENTAVOS (integer), amount_cents > 0 (CHECKs).
--   * club_id de exemplo FIXO: 11111111-1111-1111-1111-111111111111.
--   * created_by das transações do seed fica NULL (origem "sistema/seed").
-- ============================================================================

-- UUIDs fixos de exemplo (determinísticos para reexecução)
-- club    : 11111111-1111-1111-1111-111111111111
-- admin   : aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa (auth.users.id = profiles.id)
-- preside : bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb

-- ============================================================================
-- 0) AUTH — system_admin e presidente de exemplo (auth.users + identities)
--    O trigger handle_new_user cria o profile automaticamente a cada INSERT.
-- ============================================================================
do $$
declare
  v_admin_id uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_pres_id  uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
begin
  -- system_admin ----------------------------------------------------------
  -- Os campos de token (confirmation_token, recovery_token, email_change*) são
  -- preenchidos com '' por portabilidade: em versões mais antigas do schema
  -- GoTrue eles são NOT NULL sem default; em versões recentes aceitam o ''.
  insert into auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_admin_id,
    'authenticated', 'authenticated',
    'admin@futcaixa.dev',
    crypt('futcaixa123', gen_salt('bf')),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('full_name', 'Admin da Plataforma'),
    '', '', '', '',
    now(), now()
  )
  on conflict (id) do nothing;

  -- presidente ------------------------------------------------------------
  insert into auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_pres_id,
    'authenticated', 'authenticated',
    'presidente@futcaixa.dev',
    crypt('futcaixa123', gen_salt('bf')),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('full_name', 'Presidente de Exemplo'),
    '', '', '', '',
    now(), now()
  )
  on conflict (id) do nothing;

  -- Identidades de e-mail (necessárias para login por senha).
  -- `provider_id` é obrigatório em versões recentes do GoTrue; usamos o id do
  -- usuário como provider_id (padrão para provider 'email'). `identity_data`
  -- precisa conter ao menos sub + email.
  insert into auth.identities (
    provider_id, user_id, identity_data, provider, last_sign_in_at,
    created_at, updated_at
  ) values (
    v_admin_id::text, v_admin_id,
    jsonb_build_object('sub', v_admin_id::text, 'email', 'admin@futcaixa.dev', 'email_verified', true),
    'email', now(), now(), now()
  )
  on conflict (provider, provider_id) do nothing;

  insert into auth.identities (
    provider_id, user_id, identity_data, provider, last_sign_in_at,
    created_at, updated_at
  ) values (
    v_pres_id::text, v_pres_id,
    jsonb_build_object('sub', v_pres_id::text, 'email', 'presidente@futcaixa.dev', 'email_verified', true),
    'email', now(), now(), now()
  )
  on conflict (provider, provider_id) do nothing;
end
$$;

-- Ajusta os flags de perfil (o trigger já criou os profiles com id + full_name).
--   * system_admin: is_system_admin = true.
--   * presidente  : president_status = 'aprovado' (pode criar/possuir futebol).
update public.profiles
   set is_system_admin = true,
       full_name = coalesce(nullif(full_name, ''), 'Admin da Plataforma')
 where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

update public.profiles
   set president_status = 'aprovado',
       full_name = coalesce(nullif(full_name, ''), 'Presidente de Exemplo')
 where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- Trilha de aprovação do presidente (histórico) — idempotente por user_id.
insert into public.president_requests (user_id, status, requested_at, reviewed_by, reviewed_at, note)
select
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'aprovado',
  now() - interval '30 days',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  now() - interval '29 days',
  'Aprovado via seed de exemplo.'
where not exists (
  select 1 from public.president_requests
  where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
);

-- ============================================================================
-- 1) CLUBE de exemplo + SETTINGS do clube + CATEGORIAS padrão
-- ============================================================================
-- Clube (club_id fixo). invite_code fixo e estável para o link /convite/<codigo>
-- de exemplo; created_by = presidente.
insert into public.clubs (id, name, slug, invite_code, created_by)
values (
  '11111111-1111-1111-1111-111111111111',
  'Pelada do Sábado',
  'pelada-do-sabado',
  'peladadosabado01',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
)
on conflict (id) do nothing;

-- Settings do clube (uma linha por clube; club_id UNIQUE). `settings.id` é
-- smallint com default 1 — informamos id explícito, como faz a RPC create_club.
-- UPSERT por club_id para reexecução.
insert into public.settings (
  id, club_id, club_name, pix_key, pix_receiver_name, pix_city,
  default_monthly_cents, default_drop_in_cents, due_day, generation_day,
  initial_balance_cents
)
values (
  1,
  '11111111-1111-1111-1111-111111111111',
  'Pelada do Sábado',
  'pelada.sabado@futcaixa.com.br',
  'Associação Pelada do Sábado',
  'SAO PAULO',
  5000,    -- R$ 50,00 mensalidade padrão
  1500,    -- R$ 15,00 avulso (diária)
  10,      -- vencimento dia 10
  1,       -- geração das mensalidades no dia 1
  50000    -- R$ 500,00 de saldo inicial do caixa
)
on conflict (club_id) do update set
  club_name             = excluded.club_name,
  pix_key               = excluded.pix_key,
  pix_receiver_name     = excluded.pix_receiver_name,
  pix_city              = excluded.pix_city,
  default_monthly_cents = excluded.default_monthly_cents,
  default_drop_in_cents = excluded.default_drop_in_cents,
  due_day               = excluded.due_day,
  generation_day        = excluded.generation_day,
  initial_balance_cents = excluded.initial_balance_cents;

-- Categorias padrão do clube — reaproveita a função oficial (idempotente).
select public.seed_club_categories('11111111-1111-1111-1111-111111111111');

-- ============================================================================
-- 2) PLAYERS — 10 jogadores do clube de exemplo (todos com club_id)
--    maioria mensalista; 1 isento goleiro; 1 inativo; 2 com mensalidade
--    personalizada; 1 avulso. (reaproveitados do seed single-tenant anterior)
-- ============================================================================
insert into public.players
  (club_id, name, nickname, email, phone, type, status, skill_level,
   is_exempt, exempt_reason, custom_monthly_cents, custom_drop_in_cents)
values
  ('11111111-1111-1111-1111-111111111111', 'Carlos Eduardo Silva', 'Cadu',    'cadu@example.com',    '11910000001', 'mensalista', 'ativo',   3, false, null, null,  null),
  ('11111111-1111-1111-1111-111111111111', 'Rafael Augusto Lima',  'Rafa',    'rafa@example.com',    '11910000002', 'mensalista', 'ativo',   2, false, null, null,  null),
  ('11111111-1111-1111-1111-111111111111', 'Bruno Henrique Costa', 'Bruninho','bruno@example.com',   '11910000003', 'mensalista', 'ativo',   2, false, null, null,  null),
  ('11111111-1111-1111-1111-111111111111', 'Thiago Pereira Souza', 'Thiago',  'thiago@example.com',  '11910000004', 'mensalista', 'ativo',   1, false, null, null,  null),
  ('11111111-1111-1111-1111-111111111111', 'Marcelo Dias Rocha',   'Marcelo', 'marcelo@example.com', '11910000005', 'mensalista', 'ativo',   3, false, null, null,  null),
  ('11111111-1111-1111-1111-111111111111', 'André Luiz Fernandes', 'Dedé',    'dede@example.com',    '11910000006', 'mensalista', 'ativo',   2, false, null, 4000,  null),
  ('11111111-1111-1111-1111-111111111111', 'Felipe Santos Araujo', 'Felipão', 'felipe@example.com',  '11910000007', 'mensalista', 'ativo',   1, false, null, 6000,  null),
  ('11111111-1111-1111-1111-111111111111', 'Gustavo Nunes Teixeira','Guga',   'guga@example.com',    '11910000008', 'mensalista', 'inativo', 2, false, null, null,  null),
  ('11111111-1111-1111-1111-111111111111', 'Diego Martins Alves',  'Diego',   'diego@example.com',   '11910000009', 'avulso',     'ativo',   2, false, null, null,  2000),
  ('11111111-1111-1111-1111-111111111111', 'Paulo Roberto Gomes',  'Paulão',  'paulao@example.com',  '11910000010', 'mensalista', 'ativo',   3, true,  'goleiro', null, null)
on conflict (lower(email)) where email is not null do nothing;

-- ============================================================================
-- 3) MEMBERSHIPS — presidente + alguns jogadores vinculados a players
-- ============================================================================
-- Presidente: membership presidente/ativa no clube (player_id nulo — não
-- precisa representar um jogador). unique(user_id, club_id) garante idempotência.
insert into public.memberships (user_id, club_id, role, status, player_id)
values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '11111111-1111-1111-1111-111111111111',
  'presidente', 'ativo', null
)
on conflict (user_id, club_id) do nothing;

-- Observação: os 10 players de exemplo NÃO têm, por padrão, usuário de auth
-- (login) criado — manter 10 logins no seed seria ruído em dev. Caso queira
-- um jogador "logável" vinculado, crie o auth.user como no bloco 0 e insira a
-- membership jogador/ativo com o player_id correspondente. Como DEMONSTRAÇÃO,
-- vinculamos o PRÓPRIO presidente também como jogador (um presidente que joga):
-- preenchemos memberships.player_id do presidente com o player 'Cadu', deixando
-- "Meu extrato" do presidente com dados reais.
update public.memberships m
   set player_id = (
     select p.id from public.players p
     where p.club_id = '11111111-1111-1111-1111-111111111111'
       and lower(p.email) = 'cadu@example.com'
     limit 1
   )
 where m.user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
   and m.club_id = '11111111-1111-1111-1111-111111111111'
   and m.player_id is null;

-- ============================================================================
-- 4) GOALS (vaquinhas) — do clube de exemplo. Guardadas por (club_id, título).
-- ============================================================================
insert into public.goals (club_id, title, target_cents, current_cents, is_active)
select '11111111-1111-1111-1111-111111111111', 'Jogo de camisas novo', 80000, 50000, true
where not exists (
  select 1 from public.goals
  where club_id = '11111111-1111-1111-1111-111111111111' and title = 'Jogo de camisas novo'
);

insert into public.goals (club_id, title, target_cents, current_cents, is_active)
select '11111111-1111-1111-1111-111111111111', 'Churrasco de confraternização', 30000, 12000, true
where not exists (
  select 1 from public.goals
  where club_id = '11111111-1111-1111-1111-111111111111' and title = 'Churrasco de confraternização'
);

-- ============================================================================
-- 5) RECURRING_EXPENSES — despesas recorrentes do clube. Guardadas por
--    (club_id, descrição). category_id resolvido dentro do clube.
-- ============================================================================
insert into public.recurring_expenses (club_id, amount_cents, category_id, description, day_of_month, is_active)
select
  '11111111-1111-1111-1111-111111111111', 40000,
  (select id from public.categories
     where club_id = '11111111-1111-1111-1111-111111111111'
       and kind = 'despesa' and lower(name) = lower('Quadra')),
  'Aluguel da quadra (mensal)', 5, true
where not exists (
  select 1 from public.recurring_expenses
  where club_id = '11111111-1111-1111-1111-111111111111'
    and description = 'Aluguel da quadra (mensal)'
);

insert into public.recurring_expenses (club_id, amount_cents, category_id, description, day_of_month, is_active)
select
  '11111111-1111-1111-1111-111111111111', 3000,
  (select id from public.categories
     where club_id = '11111111-1111-1111-1111-111111111111'
       and kind = 'despesa' and lower(name) = lower('Água/Gelo')),
  'Água/Gelo (mensal)', 6, true
where not exists (
  select 1 from public.recurring_expenses
  where club_id = '11111111-1111-1111-1111-111111111111'
    and description = 'Água/Gelo (mensal)'
);

-- ============================================================================
-- 6) 6 MESES de COBRANÇAS e LANÇAMENTOS — escopados ao club_id de exemplo
--    (reaproveita a lógica PL/pgSQL do seed anterior, agora com club_id em
--     todos os inserts e categorias resolvidas DENTRO do clube).
-- ============================================================================
do $$
declare
  v_club          uuid := '11111111-1111-1111-1111-111111111111';

  -- IDs de categorias do CLUBE (resolvidos uma vez)
  cat_mensalidade uuid := (select id from public.categories where club_id = v_club and kind = 'receita' and lower(name) = lower('Mensalidade'));
  cat_quadra      uuid := (select id from public.categories where club_id = v_club and kind = 'despesa' and lower(name) = lower('Quadra'));
  cat_bolas       uuid := (select id from public.categories where club_id = v_club and kind = 'despesa' and lower(name) = lower('Bolas'));
  cat_arbitragem  uuid := (select id from public.categories where club_id = v_club and kind = 'despesa' and lower(name) = lower('Arbitragem'));
  cat_goleiro     uuid := (select id from public.categories where club_id = v_club and kind = 'despesa' and lower(name) = lower('Goleiro'));
  cat_agua        uuid := (select id from public.categories where club_id = v_club and kind = 'despesa' and lower(name) = lower('Água/Gelo'));

  v_month_start   date;
  v_period        text;
  v_is_current    boolean;
  v_due_date      date;

  n               integer;
  idx             integer;
  v_charge_id     uuid;
  v_amount        integer;
  v_status        text;
  v_paid_at       timestamptz;
  v_default_month integer := coalesce(
    (select default_monthly_cents from public.settings where club_id = v_club), 5000);
  v_sat           date;
  v_game_no       integer;
  rec             record;
begin
  for n in reverse 5..0 loop
    v_month_start := (date_trunc('month', current_date) - make_interval(months => n))::date;
    v_period      := to_char(v_month_start, 'YYYY-MM');
    v_is_current  := (n = 0);
    v_due_date    := (v_month_start + make_interval(days => 9))::date; -- dia 10

    -- --------------------------------------------------------------------
    -- a) COBRANÇAS de mensalidade (um por mensalista ATIVO e NÃO isento do clube)
    -- --------------------------------------------------------------------
    idx := 0;
    for rec in
      select p.id, p.name, coalesce(p.custom_monthly_cents, v_default_month) as amount
      from public.players p
      where p.club_id = v_club
        and p.type = 'mensalista'
        and p.status = 'ativo'
        and p.is_exempt = false
        and p.deleted_at is null
      order by p.name
    loop
      idx := idx + 1;
      v_amount := rec.amount;

      if v_is_current then
        if (idx % 5) in (0, 3) then
          v_status := 'pendente';
        else
          v_status := 'paga';
        end if;
      else
        if (idx % 5) = 0 then
          v_status := 'pendente';
        else
          v_status := 'paga';
        end if;
      end if;

      if v_status = 'paga' then
        v_paid_at := (v_due_date - make_interval(days => (idx % 4)))::timestamptz + time '14:30';
        if v_is_current and v_paid_at::date > current_date then
          v_paid_at := current_date::timestamptz + time '14:30';
        end if;
      else
        v_paid_at := null;
      end if;

      -- Insere a cobrança (idempotente: txid determinístico + guarda pelo
      -- índice único parcial (club_id, player_id, period) de mensalidade).
      v_charge_id := null;
      insert into public.charges
        (club_id, player_id, amount_cents, description, kind, period, due_date, status, paid_at, txid)
      select
        v_club, rec.id, v_amount, 'Mensalidade ' || v_period, 'mensalidade',
        v_period, v_due_date, v_status, v_paid_at,
        'seed:' || v_club::text || ':' || v_period || ':' || rec.id::text
      where not exists (
        select 1 from public.charges c
        where c.club_id = v_club and c.kind = 'mensalidade'
          and c.player_id = rec.id and c.period = v_period
          and c.deleted_at is null
      )
      returning id into v_charge_id;

      if v_charge_id is null then
        select c.id into v_charge_id
        from public.charges c
        where c.club_id = v_club and c.kind = 'mensalidade'
          and c.player_id = rec.id and c.period = v_period
          and c.deleted_at is null
        limit 1;
      end if;

      -- b) RECEITA correspondente à cobrança PAGA (vinculada por charge_id).
      if v_status = 'paga' and v_charge_id is not null then
        insert into public.transactions
          (club_id, kind, amount_cents, occurred_on, category_id, description, player_id, charge_id, created_by)
        select
          v_club, 'receita', v_amount, v_paid_at::date, cat_mensalidade,
          'Mensalidade ' || v_period || ' - ' || rec.name, rec.id, v_charge_id, null
        where not exists (
          select 1 from public.transactions t
          where t.charge_id = v_charge_id and t.kind = 'receita' and t.deleted_at is null
        );
      end if;
    end loop;

    -- --------------------------------------------------------------------
    -- c) DESPESAS de caixa do mês (todas com club_id)
    -- --------------------------------------------------------------------

    -- Quadra: aluguel mensal (dia 5) — não lança no futuro no mês corrente
    if (v_month_start + make_interval(days => 4))::date <= current_date then
      insert into public.transactions
        (club_id, kind, amount_cents, occurred_on, category_id, description, created_by)
      select v_club, 'despesa', 40000, (v_month_start + make_interval(days => 4))::date, cat_quadra,
             'Aluguel da quadra ' || v_period, null
      where not exists (
        select 1 from public.transactions t
        where t.club_id = v_club and t.kind = 'despesa' and t.category_id = cat_quadra
          and t.occurred_on = (v_month_start + make_interval(days => 4))::date
          and t.deleted_at is null
      );
    end if;

    -- Bolas: compra pontual (dia 8) — não lança no futuro no mês corrente
    if (v_month_start + make_interval(days => 7))::date <= current_date then
      insert into public.transactions
        (club_id, kind, amount_cents, occurred_on, category_id, description, created_by)
      select v_club, 'despesa', 12000, (v_month_start + make_interval(days => 7))::date, cat_bolas,
             'Compra de bolas ' || v_period, null
      where not exists (
        select 1 from public.transactions t
        where t.club_id = v_club and t.kind = 'despesa' and t.category_id = cat_bolas
          and t.occurred_on = (v_month_start + make_interval(days => 7))::date
          and t.deleted_at is null
      );
    end if;

    -- Água/Gelo: ocasional (meses alternados; dia 6) — sem lançamento futuro
    if (n % 2) = 0 and (v_month_start + make_interval(days => 5))::date <= current_date then
      insert into public.transactions
        (club_id, kind, amount_cents, occurred_on, category_id, description, created_by)
      select v_club, 'despesa', 3000, (v_month_start + make_interval(days => 5))::date, cat_agua,
             'Água e gelo ' || v_period, null
      where not exists (
        select 1 from public.transactions t
        where t.club_id = v_club and t.kind = 'despesa' and t.category_id = cat_agua
          and t.occurred_on = (v_month_start + make_interval(days => 5))::date
          and t.deleted_at is null
      );
    end if;

    -- Arbitragem + GOLEIRO em DIAS DE JOGO (sábados do mês).
    v_game_no := 0;
    v_sat := v_month_start;
    while extract(dow from v_sat) <> 6 loop
      v_sat := v_sat + 1;
    end loop;
    while date_trunc('month', v_sat) = date_trunc('month', v_month_start) loop
      if v_sat <= current_date then
        v_game_no := v_game_no + 1;

        insert into public.transactions
          (club_id, kind, amount_cents, occurred_on, category_id, description, created_by)
        select v_club, 'despesa', 8000, v_sat, cat_arbitragem,
               'Arbitragem - jogo ' || v_game_no || ' (' || v_period || ')', null
        where not exists (
          select 1 from public.transactions t
          where t.club_id = v_club and t.kind = 'despesa' and t.category_id = cat_arbitragem
            and t.occurred_on = v_sat and t.deleted_at is null
        );

        insert into public.transactions
          (club_id, kind, amount_cents, occurred_on, category_id, description, created_by)
        select v_club, 'despesa', 6000, v_sat, cat_goleiro,
               'Goleiro - jogo ' || v_game_no || ' (' || v_period || ')', null
        where not exists (
          select 1 from public.transactions t
          where t.club_id = v_club and t.kind = 'despesa' and t.category_id = cat_goleiro
            and t.occurred_on = v_sat and t.deleted_at is null
        );
      end if;
      v_sat := v_sat + 7;
    end loop;
  end loop;
end
$$;

-- ============================================================================
-- FIM DO SEED (multi-tenant)
-- Resultado esperado após rodar em um banco migrado e fresco:
--   * 2 usuários de auth: admin@futcaixa.dev (system_admin) e
--     presidente@futcaixa.dev (presidente aprovado). Senha: futcaixa123.
--   * 1 clube "Pelada do Sábado" (club_id 1111...1111, invite_code
--     'peladadosabado01') com settings do clube e categorias padrão.
--   * membership presidente/ativa (também vinculada ao player 'Cadu').
--   * 10 players do clube (mix de níveis/status/mensalidades personalizadas).
--   * 6 meses de mensalidades (pagas + pendentes/vencidas) -> inadimplentes e
--     v_delinquency_rate com dados POR CLUBE.
--   * receitas vinculadas às cobranças pagas + despesas de Quadra, Bolas,
--     Arbitragem, Água/Gelo e GOLEIRO (dias de jogo) -> v_monthly_summary,
--     v_balance_history, v_category_breakdown e v_recent_expenses populadas
--     (todas filtradas por club_id).
--   * 2 metas/vaquinhas e 2 despesas recorrentes do clube.
-- ============================================================================
