-- Migration: RLS multi-tenant — jogador vê/anexa apenas as próprias cobranças (tarefa 17.3)
-- Requisitos: 6.6, 14.9
--
-- Contexto (design.md "RLS — políticas por papel E por tenant"): a migration
-- 2.21 (tarefa 17.2 p2) deu a presidente/tesoureiro o CRUD de charges e
-- payment_proofs. Falta o acesso do JOGADOR, que é restrito às SUAS cobranças
-- dentro do SEU clube (Req 6.6/14.9): ele nunca vê dados financeiros de
-- terceiros nem de outros futebóis.
--
-- Fonte de verdade do vínculo: my_player_id(club_id) (helper da migration 2.19)
-- devolve o players.id que o usuário representa NAQUELE clube, via memberships
-- ativa. Se o usuário não tem vínculo com jogador no clube, a função retorna
-- null e as comparações `= null` resultam em NENHUMA linha — o jogador sem
-- player vinculado simplesmente não enxerga cobranças (comportamento correto).
--
-- payment_proofs não tem player_id próprio: a posse é derivada da cobrança
-- (payment_proofs.charge_id -> charges.player_id). Para o INSERT do jogador,
-- exigimos ainda uploaded_by = auth.uid() (não anexa em nome de terceiros) e o
-- club_id do comprovante igual ao da cobrança/jogador.
--
-- Policies são ADITIVAS (OR com as de gestor da 2.21): um gestor continua com
-- CRUD; o jogador ganha SELECT das próprias e INSERT do próprio comprovante.
-- O jogador NÃO recebe UPDATE/DELETE (preserva a evidência; a aprovação é do
-- gestor). Idempotente: DROP ... IF EXISTS antes de cada CREATE.

-- =====================================================================
-- charges — jogador SELECT apenas as próprias (player_id = my_player_id(club_id)).
-- =====================================================================
drop policy if exists charges_player_select on public.charges;
create policy charges_player_select on public.charges
  for select to authenticated
  using (
    public.my_player_id(club_id) is not null
    and player_id = public.my_player_id(club_id)
  );

-- =====================================================================
-- payment_proofs — jogador SELECT apenas os das próprias cobranças.
-- A posse vem de charges.player_id = my_player_id(club_id). Também amarramos
-- o mesmo clube (c.club_id = payment_proofs.club_id) por robustez.
-- =====================================================================
drop policy if exists payment_proofs_player_select on public.payment_proofs;
create policy payment_proofs_player_select on public.payment_proofs
  for select to authenticated
  using (
    public.my_player_id(club_id) is not null
    and exists (
      select 1
      from public.charges c
      where c.id = payment_proofs.charge_id
        and c.club_id = payment_proofs.club_id
        and c.player_id = public.my_player_id(payment_proofs.club_id)
    )
  );

-- =====================================================================
-- payment_proofs — jogador INSERT apenas comprovante da PRÓPRIA cobrança.
--   - uploaded_by = auth.uid()  (não anexa em nome de terceiros)
--   - a cobrança (charge_id) é do jogador no mesmo clube
--   - club_id do comprovante == club_id da cobrança
-- =====================================================================
drop policy if exists payment_proofs_player_insert on public.payment_proofs;
create policy payment_proofs_player_insert on public.payment_proofs
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and public.my_player_id(club_id) is not null
    and exists (
      select 1
      from public.charges c
      where c.id = payment_proofs.charge_id
        and c.club_id = payment_proofs.club_id
        and c.player_id = public.my_player_id(payment_proofs.club_id)
    )
  );
