-- Migration: perfil automático no cadastro aberto (login por e-mail + senha)
-- Requisito 1.1/1.3
--
-- Contexto: o FutCaixa passou de login por magic link/OTP para e-mail + senha
-- com CADASTRO ABERTO. Qualquer pessoa pode criar uma conta e entrar na hora.
--
-- O que esta migration faz: cria um trigger em `auth.users` que, a cada novo
-- usuário, insere automaticamente a linha correspondente em `public.profiles`
-- com papel 'jogador' e o nome vindo dos metadados do cadastro
-- (`raw_user_meta_data.full_name`). Admins podem promover o papel depois
-- (para 'tesoureiro' ou 'admin').
--
-- Este é o padrão recomendado pelo Supabase: um trigger AFTER INSERT em
-- auth.users criando o perfil na tabela do app. `profiles.id` referencia
-- `auth.users(id)`, então o perfil nasce já vinculado ao usuário de auth.
--
-- Observação: isso COMPLEMENTA/substitui a criação manual de perfil que um
-- admin faria para novos usuários — agora o perfil 'jogador' é criado sozinho.
-- O vínculo opcional a um jogador (`profiles.player_id`) continua manual.
--
-- Idempotente: usamos `create or replace function` e recriamos o trigger
-- (drop if exists + create), de modo que a migration pode rodar novamente sem
-- erro.

-- Função que cria o perfil 'jogador' para o novo usuário autenticado.
-- security definer: executa com os privilégios do dono (ignora a RLS de
-- profiles), necessário porque o INSERT ocorre no contexto do Auth, sem um
-- usuário logado do app. search_path fixado em public por segurança.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    'jogador',
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Cria automaticamente um perfil (role=jogador) para cada novo usuário de auth no cadastro aberto. Admins promovem depois.';

-- Recria o trigger de forma idempotente.
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
