-- Migration: bucket público de logos + policies de Storage
-- Cria o bucket PÚBLICO `logos` e as policies de RLS em storage.objects.
-- Requisitos: 10.5 (configurações são admin-only), 11.2 (contraste com proofs)
--
-- Contexto (design.md "RLS — Storage"):
--   - O logo do clube é um ativo de MARCA (branding) exibido na UI, não é um
--     dado sensível. Por isso o bucket `logos` é PÚBLICO (public=true): a
--     leitura dos objetos é aberta, servida por URL pública, sem necessidade de
--     URL assinada.
--   - Isso difere intencionalmente do bucket `proofs`, que é PRIVADO (Req 11.2):
--     comprovantes são sensíveis e servidos apenas por URL assinada no servidor.
--   - A action de upload (src/app/(app)/configuracoes/actions.ts, uploadLogo)
--     grava o objeto em um caminho fixo do tipo `logos/logo.<ext>`.
--
-- Regra de acesso:
--   - SELECT (leitura): aberta a todos (anon + authenticated). Como o bucket é
--     público, os objetos já são legíveis de qualquer forma; esta policy
--     apenas DOCUMENTA e torna explícita essa intenção para o acesso direto a
--     storage.objects.
--   - INSERT/UPDATE/DELETE: SOMENTE admin — a tela de configurações é
--     admin-only (Req 10.5), logo apenas o administrador pode enviar, substituir
--     ou remover o logo. Resolve-se o papel com public.current_role().
--
-- Observações:
--   - storage.objects já vem com RLS habilitada no Supabase; aqui apenas criamos
--     as policies específicas do bucket `logos`.
--   - Reutilizamos public.current_role() (migration 2.6) para resolver o papel.

-- =====================================================================
-- Bucket público `logos`
-- public=true garante que os objetos são servidos por URL pública (branding
-- não sensível), diferente do bucket `proofs` (privado, Req 11.2).
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

-- =====================================================================
-- SELECT (leitura pública)
--   Leitura aberta a todos (anon + authenticated). Bucket público já é legível;
--   esta policy documenta a intenção e cobre o acesso direto a storage.objects.
-- =====================================================================
create policy logos_select_public on storage.objects
  for select to public
  using (bucket_id = 'logos');

-- =====================================================================
-- INSERT (upload)
--   Somente admin — a tela de configurações é admin-only (Req 10.5).
-- =====================================================================
create policy logos_insert_admin on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'logos'
    and public.current_role() = 'admin'
  );

-- =====================================================================
-- UPDATE (substituição do logo)
--   Somente admin — a tela de configurações é admin-only (Req 10.5).
-- =====================================================================
create policy logos_update_admin on storage.objects
  for update to authenticated
  using (
    bucket_id = 'logos'
    and public.current_role() = 'admin'
  )
  with check (
    bucket_id = 'logos'
    and public.current_role() = 'admin'
  );

-- =====================================================================
-- DELETE (remoção do logo)
--   Somente admin — a tela de configurações é admin-only (Req 10.5).
-- =====================================================================
create policy logos_delete_admin on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'logos'
    and public.current_role() = 'admin'
  );
