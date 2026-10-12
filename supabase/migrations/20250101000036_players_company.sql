-- Migration: campo "empresa" (company) em players
-- Requisito: cadastro do jogador informar a empresa onde trabalha.
--
-- Coluna opcional de texto. Nullable (nem todo jogador tem/informa empresa).
-- Sem default: ausência = NULL. A RLS de players já existente cobre esta coluna.
--
-- Forward-only e idempotente (`add column if not exists`).

alter table public.players
  add column if not exists company text;

comment on column public.players.company is
  'Empresa onde o jogador trabalha (opcional). Informada no cadastro do jogador.';
