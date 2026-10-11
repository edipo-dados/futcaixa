-- Migration: funções auxiliares de autorização multi-tenant (tarefa 17.1)
-- Requisitos: 6.2, 6.7, 5.3
--
-- Contexto (design.md "RLS — políticas por papel E por tenant"): a RLS do
-- FutCaixa passa a ter DUAS dimensões — o TENANT (clube) e o PAPEL dentro dele.
-- A fonte de verdade do papel é `memberships` (Req 5.3), nunca mais `profiles`.
-- Para as policies ficarem legíveis e consistentes, concentramos a resolução de
-- autorização nestas quatro funções auxiliares, usadas por todas as policies da
-- tarefa 17.2+.
--
-- Por que SECURITY DEFINER + `set search_path = public`:
--   - As funções leem `profiles` e `memberships` para decidir o acesso. Se elas
--     respeitassem a RLS dessas próprias tabelas, uma policy que chamasse a
--     função reconsultaria a tabela sob RLS e cairia em RECURSÃO infinita.
--   - SECURITY DEFINER faz a leitura rodar com os privilégios do dono (ignora a
--     RLS de profiles/memberships), quebrando a recursão e permitindo que as
--     demais tabelas resolvam papel/tenant com segurança.
--   - `set search_path = public` fixa o schema, evitando sequestro de resolução
--     de nomes por search_path do chamador.
--   - STABLE: dentro do mesmo statement/transação o resultado é constante
--     (auth.uid() e os vínculos não mudam no meio da avaliação da policy).
--
-- Esta migration é ADITIVA e PARA FRENTE: apenas CRIA as novas funções.
--   - NÃO remove `public.current_role()` nem policies antigas (isso é 17.2).
--   - NÃO altera tabelas.
-- As novas funções CONVIVEM temporariamente com a antiga `current_role()` até a
-- 17.2 trocar as policies e então derrubar a função legada. Usa
-- `create or replace`, podendo rodar novamente.

-- =====================================================================
-- is_system_admin() — é administrador da PLATAFORMA? (bypass de tenant)
-- Lê o flag `profiles.is_system_admin` (migration 20250101000014). Não é papel
-- de clube: concedido via SQL/seed. coalesce garante false quando não há perfil.
-- =====================================================================
create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_system_admin from public.profiles where id = auth.uid()), false)
$$;

comment on function public.is_system_admin() is
  'Administrador da plataforma? Lê profiles.is_system_admin (bypass de tenant na RLS). SECURITY DEFINER para ler profiles sem passar pela RLS e evitar recursão.';

-- =====================================================================
-- club_role(p_club_id) — papel do usuário atual NAQUELE clube
-- Retorna o papel (presidente|tesoureiro|jogador) SE houver membership ATIVA no
-- clube; caso contrário, null. O unique(user_id, club_id) de `memberships`
-- (migration 20250101000015) garante no máximo uma linha, logo o select é
-- determinístico sem precisar de limit explícito.
-- =====================================================================
create or replace function public.club_role(p_club_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.memberships
  where user_id = auth.uid()
    and club_id = p_club_id
    and status = 'ativo'
$$;

comment on function public.club_role(uuid) is
  'Papel (presidente|tesoureiro|jogador) do usuário atual no clube informado, ou null se não houver membership ativa. SECURITY DEFINER para ler memberships sem RLS e evitar recursão.';

-- =====================================================================
-- is_member_of(p_club_id) — é membro ATIVO do clube (ou system_admin)?
-- system_admin tem bypass de tenant; demais só são membros se tiverem papel
-- ativo no clube (club_role não-nulo). Base das policies de leitura.
-- =====================================================================
create or replace function public.is_member_of(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_system_admin() or (public.club_role(p_club_id) is not null)
$$;

comment on function public.is_member_of(uuid) is
  'É membro ativo do clube informado, ou administrador da plataforma (bypass de tenant)? SECURITY DEFINER para resolver via profiles/memberships sem recursão de RLS.';

-- =====================================================================
-- my_player_id(p_club_id) — jogador (players.id) que o usuário representa
-- Retorna o `memberships.player_id` da membership ATIVA do usuário no clube
-- (null se não houver vínculo com jogador ou membership ativa). Usado para
-- amarrar o jogador às próprias cobranças/comprovantes por clube (17.3).
-- =====================================================================
create or replace function public.my_player_id(p_club_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select player_id
  from public.memberships
  where user_id = auth.uid()
    and club_id = p_club_id
    and status = 'ativo'
$$;

comment on function public.my_player_id(uuid) is
  'Jogador (players.id) que o usuário representa no clube informado, via memberships ativa; null se não houver. SECURITY DEFINER para ler memberships sem RLS e evitar recursão.';
