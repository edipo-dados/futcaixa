-- Migration: RLS de Storage multi-tenant — bucket `logos` por clube (complemento da tarefa 17.5)
-- Requisitos: 6.8, 17.2
--
-- Contexto: as policies originais do bucket PÚBLICO `logos` (migration 2.11)
-- usavam o papel GLOBAL via public.current_role() (removida na 2.20) e um
-- caminho fixo `logos/logo.<ext>`, sem tenant. No modelo multi-tenant cada
-- futebol tem o SEU logo, escopado por clube no caminho:
--
--   logos/<club_id>/<arquivo>
--
-- A leitura permanece PÚBLICA (branding não sensível, bucket public=true). A
-- escrita (upload/substituir/remover) passa a exigir papel de GESTOR no clube
-- do caminho (presidente/tesoureiro) ou system_admin (bypass).
--
-- Resolução de clube pelo path: (storage.foldername(name))[1] = club_id.
--
-- NOTA (código): a action de upload de logo (configurações) ainda grava em
-- `logos/logo.<ext>`; o alinhamento do caminho para `logos/<club_id>/...` é
-- feito ao escopar Configurações ao clube (tarefa 21.1). A leitura é pública,
-- então a exibição do logo não quebra nesse intervalo; apenas o upload direto
-- com a sessão do usuário passa a exigir o caminho com club_id.
--
-- Idempotência: DROP IF EXISTS das policies antigas (2.11) e das novas.

-- Garante o bucket público (idempotente).
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

-- Remove as policies single-tenant da 2.11 (as de escrita já foram dropadas na
-- 2.20; a de leitura pública some aqui para ser recriada abaixo).
drop policy if exists logos_select_public on storage.objects;
drop policy if exists logos_insert_admin  on storage.objects;
drop policy if exists logos_update_admin  on storage.objects;
drop policy if exists logos_delete_admin  on storage.objects;

-- Remove as novas (idempotência em reaplicação).
drop policy if exists logos_mt_select on storage.objects;
drop policy if exists logos_mt_insert on storage.objects;
drop policy if exists logos_mt_update on storage.objects;
drop policy if exists logos_mt_delete on storage.objects;

-- =====================================================================
-- SELECT (leitura pública) — mantém o branding acessível a todos.
-- =====================================================================
create policy logos_mt_select on storage.objects
  for select to public
  using (bucket_id = 'logos');

-- =====================================================================
-- INSERT (upload) — gestor do clube do caminho (ou system_admin).
-- =====================================================================
create policy logos_mt_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'logos'
    and (
      public.is_system_admin()
      or public.club_role(((storage.foldername(name))[1])::uuid) in ('presidente', 'tesoureiro')
    )
  );

-- =====================================================================
-- UPDATE (substituição) — gestor do clube do caminho (ou system_admin).
-- =====================================================================
create policy logos_mt_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'logos'
    and (
      public.is_system_admin()
      or public.club_role(((storage.foldername(name))[1])::uuid) in ('presidente', 'tesoureiro')
    )
  )
  with check (
    bucket_id = 'logos'
    and (
      public.is_system_admin()
      or public.club_role(((storage.foldername(name))[1])::uuid) in ('presidente', 'tesoureiro')
    )
  );

-- =====================================================================
-- DELETE (remoção) — gestor do clube do caminho (ou system_admin).
-- =====================================================================
create policy logos_mt_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'logos'
    and (
      public.is_system_admin()
      or public.club_role(((storage.foldername(name))[1])::uuid) in ('presidente', 'tesoureiro')
    )
  );
