-- Migration: RPC `resolve_invite` — resolução pública de convite (tarefa 20.2)
-- Requisitos: 4.1, 4.2, 4.3, 4.4
--
-- Contexto (design.md, fluxo 4 "Convite por link fixo → membro pendente"): a
-- página `/convite/<codigo>` é PÚBLICA (middleware trata `/convite` como rota
-- pública). Qualquer pessoa — inclusive um visitante ANÔNIMO, ainda sem conta —
-- precisa descobrir o NOME do futebol a partir do `invite_code` para decidir se
-- cadastra/entra.
--
-- PROBLEMA DE RLS: a policy `clubs_select` (migration 2.20) só deixa um usuário
-- ler um clube do qual ele JÁ é membro ativo (ou sendo system_admin). Um
-- visitante anônimo (ou um autenticado que ainda não entrou no clube) não tem
-- SELECT em `clubs`. Afrouxar a RLS de `clubs` para liberar leitura por
-- `invite_code` ao papel `anon` vazaria dados do clube de forma ampla.
--
-- SOLUÇÃO: expor uma função `SECURITY DEFINER` de superfície mínima que recebe
-- o código e devolve APENAS `(club_id, club_name)` de um convite VÁLIDO — isto
-- é, de um clube NÃO arquivado (`deleted_at is null`). A função roda com os
-- privilégios do dono (contorna a RLS de `clubs`), mas só revela o par id/nome
-- necessário para montar a tela de convite; nada mais do clube é exposto. O
-- `grant execute` é dado a `anon` E `authenticated` para cobrir o visitante sem
-- conta e o já logado.
--
-- Código inválido / clube arquivado → a função retorna ZERO linhas (a página
-- trata como "convite inválido"). Não lança exceção, para que o chamador possa
-- distinguir "não encontrado" de "erro de banco".
--
-- Esta migration é ADITIVA e PARA FRENTE: cria apenas a função `resolve_invite`.
-- Não altera schema de tabelas, dados nem a RLS existente. Pré-requisito já
-- migrado: `clubs` (com `invite_code`/`deleted_at`) — migration 16.1
-- (20250101000013).

create or replace function public.resolve_invite(p_code text)
returns table (club_id uuid, club_name text)
language sql
security definer
set search_path = public
stable
as $$
  select c.id, c.name
    from public.clubs c
   where c.invite_code = btrim(coalesce(p_code, ''))
     and c.deleted_at is null
   limit 1;
$$;

comment on function public.resolve_invite(text) is
  'Resolve um invite_code (público) para (club_id, club_name) de um clube não arquivado. SECURITY DEFINER de superfície mínima: contorna a RLS de clubs apenas para revelar id/nome do convite; retorna zero linhas para código inválido/clube arquivado. Usado pela página pública /convite/<codigo> (Req 4.1).';

-- Permissões: visitante anônimo (sem conta) e usuário autenticado podem
-- resolver um convite. A função não expõe nada além de id/nome.
revoke all on function public.resolve_invite(text) from public;
grant execute on function public.resolve_invite(text) to anon, authenticated;
