"use server";

import { revalidatePath } from "next/cache";

import { getMembershipSession } from "@/lib/auth/membership";
import { createClient } from "@/lib/supabase/server";
import {
  type ChargeActionState,
  type ChargeFormValues,
  type ChargeInput,
  type ChargeKind,
  type ChargeStatus,
  type ChargeStatusActionState,
  chargeSchema,
  generateTxid,
} from "@/lib/validation/charge";

import { generateChargeRevenue } from "./data";

/**
 * Server Actions de Cobranças (Requisitos 11.3, 11.4, 11.5, 11.6, 11.7).
 *
 * MULTI-TENANT (tarefa 21.5): todo o CRUD de `charges` é escopado ao FUTEBOL
 * ATIVO. Apenas o `presidente` ou o `tesoureiro` do clube ativo podem criar
 * cobranças e alterar seus status; sem futebol ativo a ação é negada. O escopo
 * é garantido aqui injetando/filtrando `club_id = clube ativo` (defesa em
 * profundidade) e, de forma autoritativa, pela RLS no Postgres. Toda entrada
 * passa pelo `chargeSchema` (revalidação no servidor), que rejeita valores ≤ 0,
 * exige período para mensalidades e valida o vencimento.
 *
 * A cobrança nasce com `status = 'pendente'` (Req 11.4) e com um `txid` único
 * gerado no servidor. As transições de status — marcar como paga (gerando a
 * receita vinculada e escopada ao MESMO clube, Req 11.5) e cancelar (auditado
 * via trigger, Req 11.6/11.7) — vivem em `markChargePaid` e `cancelCharge`
 * nesta mesma Server Action.
 *
 * Para `kind = 'mensalidade'`, o período é gravado e a unicidade por
 * `(player_id, period)` é garantida por índice único parcial no banco; uma
 * tentativa de duplicar dispara o erro Postgres 23505, traduzido aqui para uma
 * mensagem amigável.
 *
 * Todas as mutações usam o cliente ligado à sessão do usuário (`createClient`),
 * de modo que a RLS se aplique.
 */

/** Código Postgres para violação de unicidade (unique_violation). */
const PG_UNIQUE_VIOLATION = "23505";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Revalida que o ator é presidente OU tesoureiro do clube ATIVO (Req 11.3).
 * Retorna o `clubId` ativo quando ok; caso contrário uma mensagem pronta para a
 * UI. A UI não é a fronteira real (a RLS é), mas esta barreira dá um erro
 * amistoso e evita escritas sem clube/contexto.
 */
async function requireManager(): Promise<
  { ok: true; clubId: string } | { ok: false; message: string }
> {
  const session = await getMembershipSession();
  if (!session) {
    return { ok: false, message: "Sua sessão expirou. Entre novamente." };
  }
  if (!session.activeClub) {
    return {
      ok: false,
      message: "Selecione um futebol ativo para gerenciar cobranças.",
    };
  }
  if (session.role !== "presidente" && session.role !== "tesoureiro") {
    return {
      ok: false,
      message:
        "Apenas presidente e tesoureiro do futebol podem criar cobranças.",
    };
  }
  return { ok: true, clubId: session.activeClub.clubId };
}

/** Extrai os campos do FormData no formato esperado pelo schema. */
function readFormData(formData: FormData): Record<string, unknown> {
  return {
    playerId: formData.get("playerId"),
    amountCents: formData.get("amountCents"),
    description: formData.get("description"),
    kind: formData.get("kind"),
    dueDate: formData.get("dueDate"),
    period: formData.get("period") ?? "",
  };
}

/** Mapeia os erros do Zod para o formato `fieldErrors` do estado. */
function toFieldErrors(
  issues: { path: (string | number)[]; message: string }[],
): Partial<Record<keyof ChargeFormValues, string>> {
  const fieldErrors: Partial<Record<keyof ChargeFormValues, string>> = {};
  for (const issue of issues) {
    const key = issue.path[0] as keyof ChargeFormValues | undefined;
    if (key && !fieldErrors[key]) {
      fieldErrors[key] = issue.message;
    }
  }
  return fieldErrors;
}

/**
 * Converte o payload validado (camelCase) para a linha do banco (snake_case).
 * Injeta o `club_id` do clube ativo (escopo multi-tenant, Req 11.3), gera o
 * `txid`, define `status = 'pendente'` e grava `period` apenas para
 * mensalidades (para os demais tipos, `period` é nulo).
 */
function toDbRow(data: ChargeInput, clubId: string) {
  return {
    club_id: clubId,
    player_id: data.playerId,
    amount_cents: data.amountCents,
    description: data.description,
    kind: data.kind,
    period: data.kind === "mensalidade" ? (data.period ?? null) : null,
    due_date: data.dueDate,
    status: "pendente" as const,
    txid: generateTxid(),
  };
}

// ─── Criar cobrança manual (Req 5.3, 5.8) ────────────────────────────────────

export async function createCharge(
  _prevState: ChargeActionState,
  formData: FormData,
): Promise<ChargeActionState> {
  const auth = await requireManager();
  if (!auth.ok) {
    return { status: "error", message: auth.message };
  }

  const parsed = chargeSchema.safeParse(readFormData(formData));
  if (!parsed.success) {
    return {
      status: "error",
      message: "Corrija os campos inválidos.",
      fieldErrors: toFieldErrors(parsed.error.issues),
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("charges")
    .insert(toDbRow(parsed.data, auth.clubId));

  if (error) {
    // Unicidade parcial (player_id, period) para mensalidades: evita duplicar
    // a cobrança do mesmo jogador no mesmo período (Req 5.2).
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        status: "error",
        message: "Já existe mensalidade para este jogador neste período.",
        fieldErrors: { period: "Já existe mensalidade neste período." },
      };
    }
    return { status: "error", message: `Erro ao salvar: ${error.message}` };
  }

  revalidatePath("/cobrancas");
  return {
    status: "success",
    message: "Cobrança criada com sucesso.",
  };
}

// ─── Transição de status (tarefa 8.3) ────────────────────────────────────────

/**
 * Linha mínima da cobrança usada nas transições de status.
 */
interface ChargeStatusRow {
  id: string;
  club_id: string;
  player_id: string;
  amount_cents: number;
  description: string;
  kind: ChargeKind;
  period: string | null;
  status: ChargeStatus;
}

/**
 * Revalida que o ator é presidente OU tesoureiro do clube ATIVO para as
 * transições de status (variante com `clubId`, Req 11.3). Mesma regra do
 * `requireManager` da criação.
 */
async function requireManagerStatus(): Promise<
  { ok: true; clubId: string } | { ok: false; message: string }
> {
  const session = await getMembershipSession();
  if (!session) {
    return { ok: false, message: "Sua sessão expirou. Entre novamente." };
  }
  if (!session.activeClub) {
    return {
      ok: false,
      message: "Selecione um futebol ativo para alterar cobranças.",
    };
  }
  if (session.role !== "presidente" && session.role !== "tesoureiro") {
    return {
      ok: false,
      message:
        "Apenas presidente e tesoureiro do futebol podem alterar cobranças.",
    };
  }
  return { ok: true, clubId: session.activeClub.clubId };
}

/** Lê e valida o id da cobrança vindo do FormData. */
function readChargeId(formData: FormData): string | null {
  const id = formData.get("chargeId");
  if (typeof id !== "string" || id.trim() === "") return null;
  return id.trim();
}

/**
 * Carrega a cobrança (não excluída) do clube ATIVO necessária para a
 * transição. O filtro `club_id` impede operar sobre cobranças de outro futebol
 * mesmo que o id seja conhecido (escopo multi-tenant, Req 11.3); a RLS reforça
 * a mesma regra no banco.
 */
async function loadChargeForStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  chargeId: string,
  clubId: string,
): Promise<ChargeStatusRow | null> {
  const { data, error } = await supabase
    .from("charges")
    .select(
      "id, club_id, player_id, amount_cents, description, kind, period, status",
    )
    .eq("id", chargeId)
    .eq("club_id", clubId)
    .is("deleted_at", null)
    .maybeSingle<ChargeStatusRow>();

  if (error || !data) return null;
  return data;
}

/**
 * Marca uma cobrança como PAGA e gera o lançamento de receita vinculado,
 * escopado ao MESMO futebol da cobrança (Req 11.4, 11.5).
 *
 * Idempotência da receita: só transiciona quando o status atual NÃO é `paga`
 * (guarda o estado anterior). Além disso, antes de inserir, verifica que não
 * existe nenhum lançamento (não excluído) com o mesmo `charge_id` — assim uma
 * chamada repetida não cria receita em dobro.
 *
 * O lançamento nasce como `receita`, com `amount_cents` da cobrança,
 * `occurred_on = hoje` (fuso do app), `club_id` herdado da cobrança (escopo
 * multi-tenant, Req 11.5), categoria resolvida pelo tipo da cobrança no mesmo
 * clube (`resolveReceitaCategoryId`), `player_id` e `charge_id` vinculados e
 * `created_by` do usuário atual. Todas as mutações passam pelo cliente de
 * sessão para que os triggers de auditoria capturem `auth.uid()` (Req 11.6).
 */
export async function markChargePaid(
  _prevState: ChargeStatusActionState,
  formData: FormData,
): Promise<ChargeStatusActionState> {
  const auth = await requireManagerStatus();
  if (!auth.ok) {
    return { status: "error", message: auth.message };
  }

  const session = await getMembershipSession();
  if (!session) {
    return {
      status: "error",
      message: "Sessão expirada. Faça login novamente.",
    };
  }

  const chargeId = readChargeId(formData);
  if (!chargeId) {
    return { status: "error", message: "Cobrança não identificada." };
  }

  const supabase = await createClient();
  const charge = await loadChargeForStatus(supabase, chargeId, auth.clubId);
  if (!charge) {
    return { status: "error", message: "Cobrança não encontrada." };
  }

  // Guarda de estado: evita regerar receita se já estiver paga.
  if (charge.status === "paga") {
    return { status: "error", message: "Esta cobrança já está paga." };
  }
  if (charge.status === "cancelada") {
    return {
      status: "error",
      message: "Cobrança cancelada não pode ser marcada como paga.",
    };
  }

  // Transição de status → paga. O WHERE em `status != 'paga'` fecha a janela
  // de corrida (dupla submissão): só uma atualização efetiva o pagamento.
  const { data: updated, error: updateError } = await supabase
    .from("charges")
    .update({ status: "paga", paid_at: new Date().toISOString() })
    .eq("id", chargeId)
    .eq("club_id", auth.clubId)
    .neq("status", "paga")
    .is("deleted_at", null)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (updateError) {
    return {
      status: "error",
      message: `Erro ao marcar como paga: ${updateError.message}`,
    };
  }
  if (!updated) {
    // Outra transição já ocorreu entre o load e o update.
    return { status: "error", message: "Esta cobrança já está paga." };
  }

  // Gera a receita vinculada (uma única vez) pelo helper compartilhado com a
  // aprovação de comprovante (tarefa 9.6), garantindo regra consistente de
  // categoria/descrição e idempotência (Req 5.6).
  const revenue = await generateChargeRevenue(supabase, charge, session.userId);
  if (!revenue.ok) {
    return {
      status: "error",
      message: `Cobrança marcada como paga, mas ${revenue.message}`,
    };
  }

  revalidatePath("/cobrancas");
  revalidatePath("/lancamentos");
  return {
    status: "success",
    message: "Cobrança marcada como paga e receita lançada.",
  };
}

/**
 * Cancela uma cobrança (Req 11.6, 11.7).
 *
 * Só permite cancelar cobranças `pendente` ou `em_analise` — uma cobrança
 * `paga` já tem receita lançada e não é revertida aqui (fluxo de estorno fora
 * do escopo desta tarefa). O cancelamento é um UPDATE escopado por `club_id`
 * pelo cliente de sessão, então o trigger de auditoria da tabela `charges`
 * registra a ação (Req 11.7) e não cruza futebóis (Req 11.3).
 */
export async function cancelCharge(
  _prevState: ChargeStatusActionState,
  formData: FormData,
): Promise<ChargeStatusActionState> {
  const auth = await requireManagerStatus();
  if (!auth.ok) {
    return { status: "error", message: auth.message };
  }

  const chargeId = readChargeId(formData);
  if (!chargeId) {
    return { status: "error", message: "Cobrança não identificada." };
  }

  const supabase = await createClient();
  const charge = await loadChargeForStatus(supabase, chargeId, auth.clubId);
  if (!charge) {
    return { status: "error", message: "Cobrança não encontrada." };
  }

  if (charge.status === "paga") {
    return {
      status: "error",
      message:
        "Cobrança paga não pode ser cancelada (a receita já foi lançada).",
    };
  }
  if (charge.status === "cancelada") {
    return { status: "error", message: "Esta cobrança já está cancelada." };
  }

  // UPDATE pelo cliente de sessão: o trigger de auditoria registra o
  // cancelamento com actor + before/after (Req 5.7).
  const { data: updated, error } = await supabase
    .from("charges")
    .update({ status: "cancelada" })
    .eq("id", chargeId)
    .eq("club_id", auth.clubId)
    .in("status", ["pendente", "em_analise"])
    .is("deleted_at", null)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    return { status: "error", message: `Erro ao cancelar: ${error.message}` };
  }
  if (!updated) {
    return {
      status: "error",
      message: "Não foi possível cancelar esta cobrança.",
    };
  }

  revalidatePath("/cobrancas");
  return { status: "success", message: "Cobrança cancelada." };
}
