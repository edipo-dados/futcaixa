-- Migration: remove o overload legado approve_member(uuid, text)
-- Requisitos: 4.5-4.9 (correção de ambiguidade de overload)
--
-- CONTEXTO
-- ------------------------------------------------------------------
-- A migration 20250101000032 criou approve_member(uuid, text, uuid) com default
-- no 3º parâmetro, mas (na primeira versão aplicada) NÃO removeu a função antiga
-- approve_member(uuid, text) da migration 20250101000028. Com os dois overloads
-- coexistindo, uma chamada com 2 argumentos fica AMBÍGUA e o PostgREST recusa
-- com PGRST203 ("could not choose the best candidate function").
--
-- Esta migration remove explicitamente o overload de 2 args. A versão de 3 args
-- (com default no 3º) atende tanto chamadas de 2 quanto de 3 argumentos, então
-- nada é perdido. É idempotente (`drop function if exists`) e segura mesmo em
-- ambientes onde a 20250101000032 já tenha sido corrigida para fazer o drop.
--
-- Forward-only: não altera tabelas nem dados; apenas remove a função legada.

drop function if exists public.approve_member(uuid, text);
