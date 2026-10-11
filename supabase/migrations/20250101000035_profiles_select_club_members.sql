-- Migration: permitir ler o perfil (nome) de companheiros do MESMO clube
-- Requisitos: 4.5, 5.1 (exibição de nomes dos membros ao presidente)
--
-- PROBLEMA CORRIGIDO
-- ------------------------------------------------------------------
-- As telas de Membros (/membros) e Papéis (/membros/papeis) listam membros do
-- clube com o nome vindo de `profiles.full_name` via join. A ÚNICA policy de
-- SELECT em `profiles` era `profiles_select_self_or_admin`
-- (migration 20250101000020): `id = auth.uid() OR is_system_admin()`. Ou seja,
-- o presidente só conseguia ler o PRÓPRIO perfil — o nome dos demais membros
-- vinha NULL e a UI exibia "Sem nome".
--
-- CORREÇÃO
-- ------------------------------------------------------------------
-- Adiciona uma policy de SELECT que libera a leitura do perfil de qualquer
-- usuário que COMPARTILHE um clube ativo com o leitor (ambos com membership
-- `ativo` no mesmo `club_id`). Isso cobre o presidente vendo os nomes dos
-- membros e, de forma geral, companheiros de um mesmo futebol vendo o nome uns
-- dos outros — sem expor perfis de usuários de outros clubes.
--
-- Múltiplas policies PERMISSIVE para SELECT são combinadas por OR, então a
-- `profiles_select_self_or_admin` continua valendo (próprio perfil / admin) e
-- esta adiciona o caso "mesmo clube".
--
-- SEGURANÇA / RECURSÃO: a checagem usa a função SECURITY DEFINER
-- `shares_active_club(p_user_id)` (abaixo), que lê `memberships` IGNORANDO a RLS
-- — necessário para evitar recursão (uma policy de profiles que consultasse
-- memberships sob RLS, cujas policies por sua vez podem tocar profiles, entraria
-- em laço). A função expõe apenas um booleano, não dados.

-- =====================================================================
-- shares_active_club(p_user_id) — auth.uid() e p_user_id têm, juntos, ao menos
-- um clube onde AMBOS são membros ativos?
-- =====================================================================
create or replace function public.shares_active_club(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m_self
    join public.memberships m_other
      on m_other.club_id = m_self.club_id
    where m_self.user_id = auth.uid()
      and m_self.status = 'ativo'
      and m_other.user_id = p_user_id
      and m_other.status = 'ativo'
  )
$$;

comment on function public.shares_active_club(uuid) is
  'Verdadeiro quando auth.uid() e p_user_id compartilham ao menos um clube com membership ativa de ambos. SECURITY DEFINER para ler memberships sem RLS e evitar recursão. Usado pela policy de SELECT de profiles para exibir nomes de companheiros de clube.';

-- =====================================================================
-- Nova policy de SELECT em profiles: companheiros de clube.
-- =====================================================================
drop policy if exists profiles_select_club_members on public.profiles;
create policy profiles_select_club_members on public.profiles
  for select to authenticated
  using (public.shares_active_club(id));
