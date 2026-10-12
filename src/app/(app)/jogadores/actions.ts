"use server";

import { revalidatePath } from "next/cache";

import { getMembershipSession } from "@/lib/auth/membership";
import { createClient } from "@/lib/supabase/server";
import {
  PLAYER_STATUSES,
  playerSchema,
  type PlayerActionState,
  type PlayerFormValues,
  type PlayerInput,
  type PlayerStatus,
  type PlayerStatusActionState,
} from "@/lib/validation/player";

/**
 * Server Actions de Jogadores (Requisitos 8.1, 8.6, 8.8).
 *
 * MULTI-TENANT (tarefa 21.2): o CRUD de `players` é escopado ao FUTEBOL ATIVO.
 * Apenas o `presidente` do clube ativo cria, edita ou inativa jogadores do
 * clube (Req 8.8) — a leitura é permitida a membros (ver page.tsx). O escopo é
 * garantido aqui injetando/filtrando `club_id = clube ativo` (defesa em
 * profundidade) e, de forma autoritativa, pela RLS no Postgres (presidente CRUD
 * do próprio clube). Toda entrada passa pelo `playerSchema` (revalidação no
 * servidor — nunca confiar só no front).
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Revalida que o ator é presidente do clube ATIVO (Req 8.8). Retorna o
 * `clubId` ativo quando ok; caso contrário uma mensagem pronta para a UI. A UI
 * não é a fronteira real (a RLS é), mas esta barreira dá um erro amistoso e
 * evita escritas sem clube/contexto.
 */
async function requirePresident(): Promise<
  | { ok: true; clubId: string }
  | { ok: false; message: string }
> {
  const session = await getMembershipSession();
  if (!session) {
    return { ok: false, message: "Sua sessão expirou. Entre novamente." };
  }
  if (session.role !== "presidente" || !session.activeClub) {
    return {
      ok: false,
      message: "Apenas o presidente do futebol pode gerenciar jogadores.",
    };
  }
  return { ok: true, clubId: session.activeClub.clubId };
}

/** Extrai os campos do FormData no formato esperado pelo schema. */
function readFormData(formData: FormData): Record<string, unknown> {
  return {
    name: formData.get("name"),
    nickname: formData.get("nickname"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    company: formData.get("company"),
    type: formData.get("type"),
    status: formData.get("status"),
    skillLevel: formData.get("skillLevel"),
    // Checkbox não enviado = ausente; presente = "on"/"true".
    isExempt: formData.get("isExempt") != null,
    exemptReason: formData.get("exemptReason"),
    customMonthlyCents: formData.get("customMonthlyCents"),
    customDropInCents: formData.get("customDropInCents"),
  };
}

/** Mapeia os erros do Zod para o formato `fieldErrors` do estado. */
function toFieldErrors(
  issues: { path: (string | number)[]; message: string }[],
): Partial<Record<keyof PlayerFormValues, string>> {
  const fieldErrors: Partial<Record<keyof PlayerFormValues, string>> = {};
  for (const issue of issues) {
    const key = issue.path[0] as keyof PlayerFormValues | undefined;
    if (key && !fieldErrors[key]) {
      fieldErrors[key] = issue.message;
    }
  }
  return fieldErrors;
}

/** Converte o payload validado (camelCase) para a linha do banco (snake_case). */
function toDbRow(data: PlayerInput) {
  return {
    name: data.name,
    nickname: data.nickname,
    email: data.email,
    phone: data.phone,
    company: data.company,
    type: data.type,
    status: data.status,
    skill_level: data.skillLevel,
    // Quando não isento, não faz sentido guardar motivo.
    exempt_reason: data.isExempt ? data.exemptReason : null,
    custom_monthly_cents: data.customMonthlyCents,
    custom_drop_in_cents: data.customDropInCents,
    is_exempt: data.isExempt,
  };
}

// ─── Criar jogador (Req 8.1, 8.8) ────────────────────────────────────────────

export async function createPlayer(
  _prevState: PlayerActionState,
  formData: FormData,
): Promise<PlayerActionState> {
  const auth = await requirePresident();
  if (!auth.ok) {
    return { status: "error", message: auth.message };
  }

  const parsed = playerSchema.safeParse(readFormData(formData));
  if (!parsed.success) {
    return {
      status: "error",
      message: "Corrija os campos inválidos.",
      fieldErrors: toFieldErrors(parsed.error.issues),
    };
  }

  const supabase = await createClient();
  // Injeta o club_id do clube ativo no insert (escopo multi-tenant, Req 8.1).
  const { error } = await supabase
    .from("players")
    .insert({ ...toDbRow(parsed.data), club_id: auth.clubId });

  if (error) {
    // Violação de unicidade de e-mail (índice único quando presente).
    if (error.code === "23505") {
      return {
        status: "error",
        message: "Já existe um jogador com este e-mail.",
        fieldErrors: { email: "E-mail já cadastrado." },
      };
    }
    return { status: "error", message: `Erro ao salvar: ${error.message}` };
  }

  revalidatePath("/jogadores");
  return { status: "success", message: "Jogador cadastrado com sucesso." };
}

// ─── Editar jogador (Req 8.1, 8.8) ───────────────────────────────────────────

export async function updatePlayer(
  _prevState: PlayerActionState,
  formData: FormData,
): Promise<PlayerActionState> {
  const auth = await requirePresident();
  if (!auth.ok) {
    return { status: "error", message: auth.message };
  }

  const id = formData.get("id");
  if (typeof id !== "string" || id.trim() === "") {
    return { status: "error", message: "Jogador não identificado." };
  }

  const parsed = playerSchema.safeParse(readFormData(formData));
  if (!parsed.success) {
    return {
      status: "error",
      message: "Corrija os campos inválidos.",
      fieldErrors: toFieldErrors(parsed.error.issues),
    };
  }

  const supabase = await createClient();
  // Garante que a linha editada pertence ao clube ativo (escopo multi-tenant):
  // o filtro `club_id` impede editar jogadores de outro futebol mesmo que o id
  // seja conhecido. A RLS reforça a mesma regra no banco.
  const { error } = await supabase
    .from("players")
    .update(toDbRow(parsed.data))
    .eq("id", id)
    .eq("club_id", auth.clubId);

  if (error) {
    if (error.code === "23505") {
      return {
        status: "error",
        message: "Já existe um jogador com este e-mail.",
        fieldErrors: { email: "E-mail já cadastrado." },
      };
    }
    return { status: "error", message: `Erro ao salvar: ${error.message}` };
  }

  revalidatePath("/jogadores");
  return { status: "success", message: "Jogador atualizado com sucesso." };
}

// ─── Inativar / reativar jogador (Req 8.6, 8.8) ──────────────────────────────

/**
 * Altera o `status` de um jogador para `ativo` ou `inativo` (Requisito 8.6).
 *
 * IMPORTANTE: isto NÃO é uma exclusão. A inativação apenas altera a coluna
 * `status` — `deleted_at` permanece `null` e nenhum histórico é removido. As
 * cobranças e lançamentos continuam referenciando o jogador independentemente
 * do status, preservando o histórico. O efeito prático é que o jogador inativo
 * deixa de ser incluído na geração automática de mensalidades (ver o filtro
 * compartilhado em `lib/players/active-mensalistas.ts`, usado pelo cron da
 * tarefa 8.2).
 *
 * MULTI-TENANT (Req 8.8): apenas o `presidente` do clube ativo inativa/reativa,
 * e somente jogadores daquele clube (filtro `club_id`); a RLS reforça a regra
 * no banco. A mutação dispara o trigger de `updated_at`.
 */
export async function setPlayerStatus(
  _prevState: PlayerStatusActionState,
  formData: FormData,
): Promise<PlayerStatusActionState> {
  const auth = await requirePresident();
  if (!auth.ok) {
    return { status: "error", message: auth.message };
  }

  const id = formData.get("id");
  if (typeof id !== "string" || id.trim() === "") {
    return { status: "error", message: "Jogador não identificado." };
  }

  const rawStatus = formData.get("status");
  if (
    typeof rawStatus !== "string" ||
    !PLAYER_STATUSES.includes(rawStatus as PlayerStatus)
  ) {
    return { status: "error", message: "Status inválido." };
  }
  const nextStatus = rawStatus as PlayerStatus;

  const supabase = await createClient();
  // Apenas altera o status; mantém deleted_at = null (não é exclusão) e
  // preserva todo o histórico ligado ao jogador. O filtro `club_id` escopa a
  // operação ao clube ativo (não inativa jogador de outro futebol).
  const { error } = await supabase
    .from("players")
    .update({ status: nextStatus })
    .eq("id", id)
    .eq("club_id", auth.clubId)
    .is("deleted_at", null);

  if (error) {
    return { status: "error", message: `Erro ao salvar: ${error.message}` };
  }

  revalidatePath("/jogadores");
  revalidatePath(`/jogadores/${id}/editar`);
  return {
    status: "success",
    message:
      nextStatus === "inativo"
        ? "Jogador inativado. Ele não entrará em novas mensalidades; o histórico foi preservado."
        : "Jogador reativado. Ele voltará a entrar na geração de mensalidades.",
  };
}
