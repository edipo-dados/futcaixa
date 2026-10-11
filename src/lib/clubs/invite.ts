import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Convite por link fixo (tarefa 20.2).
 *
 * Esta é a camada server-only que a página pública `/convite/<codigo>` consome.
 * Ela cobre as duas operações do fluxo 4 do design ("Convite por link fixo →
 * membro pendente"):
 *
 *   1) `resolveInvite(code)` — traduz um `invite_code` (público) no futebol
 *      correspondente, SEM exigir sessão. Como a RLS de `clubs` só deixa um
 *      membro ativo ler o próprio clube, a resolução passa pela RPC
 *      `resolve_invite` (SECURITY DEFINER), que revela apenas `(club_id,
 *      club_name)` de um convite válido (clube não arquivado). Ver migration
 *      20250101000027_resolve_invite_rpc.sql. Isso evita afrouxar a RLS de
 *      `clubs` (Req 4.1).
 *
 *   2) `joinClubAsPlayer(clubId)` — para um usuário AUTENTICADO, cria (ou
 *      reaproveita) uma membership `jogador`/`pendente` naquele clube. É
 *      idempotente: a constraint `unique (user_id, club_id)` garante no máximo
 *      uma membership por par; se já existir, apenas reportamos o status atual
 *      sem duplicar (Req 4.3). A RLS (`memberships_insert`) só permite o INSERT
 *      quando `user_id = auth.uid()`, `status = 'pendente'` e `role = 'jogador'`
 *      — exatamente o que fazemos aqui.
 */

/** Resultado da resolução de um convite por código. */
export type ResolveInviteResult =
  | { ok: true; clubId: string; clubName: string }
  | {
      ok: false;
      /** `not_found`: código inválido ou clube arquivado. `error`: falha de banco. */
      reason: "not_found" | "error";
    };

/** Formato bruto devolvido pela RPC `resolve_invite`. */
interface ResolveInviteRow {
  club_id: string;
  club_name: string;
}

/**
 * Resolve um `invite_code` no futebol correspondente, de forma PÚBLICA (sem
 * sessão). Trata código inválido e clube arquivado (`deleted_at`) como
 * `not_found` — a RPC devolve zero linhas em ambos os casos.
 *
 * @param code O código vindo da rota `/convite/<codigo>`.
 */
export async function resolveInvite(code: string): Promise<ResolveInviteResult> {
  const normalized = code?.trim() ?? "";
  if (normalized === "") {
    return { ok: false, reason: "not_found" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_invite", {
    p_code: normalized,
  });

  if (error) {
    return { ok: false, reason: "error" };
  }

  // A RPC retorna um conjunto de linhas (table); normalizamos para o primeiro
  // registro. O supabase-js não conhece o tipo da função, então tratamos o
  // retorno como desconhecido e validamos a forma antes de usar.
  const rows = (Array.isArray(data) ? data : []) as ResolveInviteRow[];
  const row = rows[0];
  if (!row || typeof row.club_id !== "string") {
    return { ok: false, reason: "not_found" };
  }

  return { ok: true, clubId: row.club_id, clubName: row.club_name };
}

/** Resultado de `joinClubAsPlayer`. */
export type JoinClubResult =
  | {
      ok: true;
      /** Status da membership resultante (sempre do próprio usuário). */
      status: "pendente" | "ativo" | "recusado";
      /** `true` quando uma membership nova foi criada; `false` se já existia. */
      created: boolean;
    }
  | {
      ok: false;
      reason: "unauthenticated" | "error";
      message: string;
    };

/** Linha mínima de `memberships` lida para checar o vínculo existente. */
interface MembershipStatusRow {
  id: string;
  status: "pendente" | "ativo" | "recusado";
}

/**
 * Cria (ou reaproveita) a membership `jogador`/`pendente` do usuário
 * AUTENTICADO no clube informado (Req 4.3). Idempotente:
 *
 *   - sem membership → INSERT `role='jogador'`, `status='pendente'`;
 *   - já existe (qualquer status) → NÃO duplica nem rebaixa; devolve o status
 *     atual. Assim, reabrir o convite depois de aprovado continua `ativo`, e
 *     reabrir após recusa continua `recusado` (sem reabrir o pedido à força).
 *
 * A unicidade real é a constraint `unique (user_id, club_id)` no banco; a
 * checagem de existência aqui apenas evita um INSERT que a constraint
 * rejeitaria e nos permite reportar o status corrente.
 *
 * @param clubId O `clubs.id` resolvido a partir do `invite_code`.
 */
export async function joinClubAsPlayer(clubId: string): Promise<JoinClubResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      reason: "unauthenticated",
      message: "Entre ou crie uma conta para entrar neste futebol.",
    };
  }

  // Reaproveitamento idempotente: se já há vínculo (unique user_id+club_id),
  // devolvemos o status atual sem tentar inserir de novo.
  const { data: existing, error: selectError } = await supabase
    .from("memberships")
    .select("id, status")
    .eq("user_id", user.id)
    .eq("club_id", clubId)
    .maybeSingle<MembershipStatusRow>();

  if (selectError) {
    return {
      ok: false,
      reason: "error",
      message: "Não foi possível verificar seu vínculo. Tente novamente.",
    };
  }

  if (existing) {
    return { ok: true, status: existing.status, created: false };
  }

  // Novo pedido de entrada como jogador pendente. A RLS (`memberships_insert`)
  // só aceita quando user_id = auth.uid(), status 'pendente' e role 'jogador'.
  const { error: insertError } = await supabase.from("memberships").insert({
    user_id: user.id,
    club_id: clubId,
    role: "jogador",
    status: "pendente",
  });

  if (insertError) {
    // Corrida: outra aba pode ter inserido entre o SELECT e o INSERT. A
    // constraint unique dispara `23505`; nesse caso, releia o status atual.
    if (insertError.code === "23505") {
      const { data: raced } = await supabase
        .from("memberships")
        .select("id, status")
        .eq("user_id", user.id)
        .eq("club_id", clubId)
        .maybeSingle<MembershipStatusRow>();
      if (raced) {
        return { ok: true, status: raced.status, created: false };
      }
    }
    return {
      ok: false,
      reason: "error",
      message: "Não foi possível entrar no futebol. Tente novamente.",
    };
  }

  return { ok: true, status: "pendente", created: true };
}
