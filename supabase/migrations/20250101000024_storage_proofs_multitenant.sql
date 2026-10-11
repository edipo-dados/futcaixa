-- Migration: RLS de Storage multi-tenant — bucket `proofs` com club_id no caminho (tarefa 17.5)
-- Requisitos: 6.8, 17.2
--
-- Contexto (design.md "RLS — Storage"): as policies originais do bucket privado
-- `proofs` (migration 2.8) usavam o papel GLOBAL via public.current_role() —
-- função já removida (migration 2.20) — e o caminho `<player_id>/<charge_id>/...`,
-- que não distingue tenant. No modelo multi-tenant o caminho passa a ser
-- escopado por clube:
--
--   proofs/<club_id>/<charge_id>/<arquivo>
--
-- de modo que a autorização seja resolvida por clube: upload/leitura são
-- permitidos ao DONO da cobrança (jogador vinculado) OU a presidente/tesoureiro
-- do MESMO clube (Req 6.8/17.2). A leitura real na UI continua por URL assinada
-- gerada no servidor (service role), que ignora estas policies; elas protegem o
-- acesso DIRETO ao Storage com a sessão do usuário.
--
-- Extração de segmentos do caminho (name) via storage.foldername(name):
--   [1] = club_id    [2] = charge_id
--
-- Autorização por clube:
--   - gestor:  club_role(<club_id do path>) in ('presidente','tesoureiro')
--   - dono:    a cobrança <charge_id> existe no clube <club_id> e pertence a
--              my_player_id(<club_id>). Validamos também que o charge_id do path
--              bate com a cobrança para o jogador não varrer a pasta do clube.
--   - system_admin: bypass de tenant.
--
-- UPDATE/DELETE: apenas gestor do clube (ou system_admin) — preserva a
-- evidência enviada pelo jogador (ele não apaga/substitui o próprio comprovante).
--
-- IMPORTANTE: o código do app (src/lib/storage/proofs.ts) ainda monta o caminho
-- como `<player_id>/<charge_id>/...`. A troca do caminho para
-- `<club_id>/<charge_id>/...` no app é feita na tarefa 21.4 (escopar Lançamentos/
-- comprovantes ao clube). Até lá, estas policies e o código ficam desalinhados;
-- por isso o acesso de produção ao comprovante é via URL assinada (service role),
-- que não depende destas policies. Alinhar na 21.4.
--
-- Idempotência: DROP das policies antigas (2.8) e das novas antes do CREATE.

-- Garante o bucket privado (idempotente).
insert into storage.buckets (id, name, public)
values ('proofs', 'proofs', false)
on conflict (id) do nothing;

-- =====================================================================
-- 1) Remover as policies single-tenant da migration 2.8
--    (usavam public.current_role(), já removida; caminho sem club_id).
-- =====================================================================
drop policy if exists proofs_insert_owner_or_manager on storage.objects;
drop policy if exists proofs_select_owner_or_manager on storage.objects;
drop policy if exists proofs_update_manager           on storage.objects;
drop policy if exists proofs_delete_manager           on storage.objects;

-- Também remove as novas (idempotência em reaplicação).
drop policy if exists proofs_mt_insert on storage.objects;
drop policy if exists proofs_mt_select on storage.objects;
drop policy if exists proofs_mt_update on storage.objects;
drop policy if exists proofs_mt_delete on storage.objects;

-- =====================================================================
-- INSERT (upload): gestor do clube em qualquer caminho do clube; dono apenas
-- sob a pasta da própria cobrança (<club_id>/<charge_id>/...).
-- =====================================================================
create policy proofs_mt_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'proofs'
    and (
      public.is_system_admin()
      or public.club_role(((storage.foldername(name))[1])::uuid) in ('presidente', 'tesoureiro')
      or (
        public.my_player_id(((storage.foldername(name))[1])::uuid) is not null
        and exists (
          select 1
          from public.charges c
          where c.id = ((storage.foldername(name))[2])::uuid
            and c.club_id = ((storage.foldername(name))[1])::uuid
            and c.player_id = public.my_player_id(((storage.foldername(name))[1])::uuid)
        )
      )
    )
  );

-- =====================================================================
-- SELECT (leitura/listagem direta): mesma regra do INSERT.
-- =====================================================================
create policy proofs_mt_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'proofs'
    and (
      public.is_system_admin()
      or public.club_role(((storage.foldername(name))[1])::uuid) in ('presidente', 'tesoureiro')
      or (
        public.my_player_id(((storage.foldername(name))[1])::uuid) is not null
        and exists (
          select 1
          from public.charges c
          where c.id = ((storage.foldername(name))[2])::uuid
            and c.club_id = ((storage.foldername(name))[1])::uuid
            and c.player_id = public.my_player_id(((storage.foldername(name))[1])::uuid)
        )
      )
    )
  );

-- =====================================================================
-- UPDATE: somente gestor do clube (ou system_admin) — preserva evidência.
-- =====================================================================
create policy proofs_mt_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'proofs'
    and (
      public.is_system_admin()
      or public.club_role(((storage.foldername(name))[1])::uuid) in ('presidente', 'tesoureiro')
    )
  )
  with check (
    bucket_id = 'proofs'
    and (
      public.is_system_admin()
      or public.club_role(((storage.foldername(name))[1])::uuid) in ('presidente', 'tesoureiro')
    )
  );

-- =====================================================================
-- DELETE: somente gestor do clube (ou system_admin).
-- =====================================================================
create policy proofs_mt_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'proofs'
    and (
      public.is_system_admin()
      or public.club_role(((storage.foldername(name))[1])::uuid) in ('presidente', 'tesoureiro')
    )
  );
