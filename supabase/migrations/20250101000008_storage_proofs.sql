-- Migration: bucket privado de comprovantes + policies de Storage (tarefa 2.7)
-- Cria o bucket privado `proofs` e as policies de RLS em storage.objects
-- seguindo a regra "dono ou gestor".
-- Requisitos: 3.7, 6.5, 11.2
--
-- Contexto (design.md "RLS — Storage"):
--   - O bucket `proofs` é PRIVADO (Req 11.2): nenhum objeto é servido
--     publicamente. O acesso de leitura real acontece por URL assinada gerada
--     no servidor (ver src/lib/storage/proofs.ts), que usa a service key e
--     portanto NÃO passa por estas policies. Ainda assim, as policies abaixo
--     protegem o acesso DIRETO ao Storage (ex.: um jogador tentando listar ou
--     baixar objetos de outro jogador com a própria sessão).
--
-- Convenção de caminho (path) dos objetos:
--   `<player_id>/<charge_id>/<arquivo>`
--   - O PRIMEIRO segmento é o player_id do jogador dono da cobrança.
--   - `(storage.foldername(name))[1]` extrai esse primeiro segmento.
--   - Isso amarra a posse do arquivo ao jogador (profiles.player_id), espelhando
--     a regra das tabelas charges/payment_proofs (migration 2.6).
--
-- Regra "dono ou gestor":
--   - INSERT: admin/tesoureiro em qualquer lugar do bucket; jogador apenas sob a
--     própria pasta (primeiro segmento = seu player_id).
--   - SELECT: admin/tesoureiro em todo o bucket; jogador apenas sob a própria
--     pasta.
--   - UPDATE/DELETE: SOMENTE admin/tesoureiro — preserva a evidência (um jogador
--     não apaga nem substitui o próprio comprovante após enviá-lo).
--
-- Observações:
--   - storage.objects já vem com RLS habilitada no Supabase; aqui apenas criamos
--     as policies específicas do bucket `proofs`.
--   - Reutilizamos public.current_role() (migration 2.6) para resolver o papel.

-- =====================================================================
-- Bucket privado `proofs` (Req 11.2)
-- public=false garante que os objetos não são servidos por URL pública;
-- o acesso ocorre apenas por URL assinada (servidor).
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('proofs', 'proofs', false)
on conflict (id) do nothing;

-- =====================================================================
-- INSERT (upload)
--   admin/tesoureiro: qualquer caminho no bucket.
--   jogador: apenas sob a própria pasta (primeiro segmento = seu player_id).
-- =====================================================================
create policy proofs_insert_owner_or_manager on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'proofs'
    and (
      public.current_role() in ('admin', 'tesoureiro')
      or (
        public.current_role() = 'jogador'
        and (storage.foldername(name))[1] = (
          select player_id::text
          from public.profiles
          where id = auth.uid()
        )
      )
    )
  );

-- =====================================================================
-- SELECT (leitura/listagem direta)
--   admin/tesoureiro: todo o bucket.
--   jogador: apenas sob a própria pasta.
-- (A leitura do comprovante na UI usa URL assinada do servidor, que ignora
--  esta policy; ela protege o acesso direto.)
-- =====================================================================
create policy proofs_select_owner_or_manager on storage.objects
  for select to authenticated
  using (
    bucket_id = 'proofs'
    and (
      public.current_role() in ('admin', 'tesoureiro')
      or (
        public.current_role() = 'jogador'
        and (storage.foldername(name))[1] = (
          select player_id::text
          from public.profiles
          where id = auth.uid()
        )
      )
    )
  );

-- =====================================================================
-- UPDATE
--   Somente admin/tesoureiro — preserva a evidência enviada pelo jogador.
-- =====================================================================
create policy proofs_update_manager on storage.objects
  for update to authenticated
  using (
    bucket_id = 'proofs'
    and public.current_role() in ('admin', 'tesoureiro')
  )
  with check (
    bucket_id = 'proofs'
    and public.current_role() in ('admin', 'tesoureiro')
  );

-- =====================================================================
-- DELETE
--   Somente admin/tesoureiro — mantém o histórico/evidência (nada é apagado
--   pelo jogador após o envio).
-- =====================================================================
create policy proofs_delete_manager on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'proofs'
    and public.current_role() in ('admin', 'tesoureiro')
  );
