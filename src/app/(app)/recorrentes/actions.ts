"use server";

import { revalidatePath } from "next/cache";

import { getMembershipSession } from "@/lib/auth/membership";
import { createClient } from "@/lib/supabase/server";
import {
  type RecurringActionState,
  type RecurringFormValues,
  type RecurringInput,
  type RecurringRow,
  type RecurringToggleActionState,
  recurringSchema,
} from "@/lib/validation/recurring";

/**
 * Server Actions de Despesas Recorrentes (Requisitos 10.1, 10.4).
 *
 * MULTI-TENANT (tarefa 21.6): o CRUD de `recurring_expenses` é escopado ao
 * FUTEBOL ATIVO (`club_id`). Apenas os papéis `presidente` e `tesoureiro` do
 * clube ativo podem criar, editar ou ativar/desativar despesas recorrentes
 * (Req 10.1). A regra é garantida aqui (verificação de papel + escopo explícito
 * de `club_id`) e, de forma autoritativa, pela RLS no Postgres.
 *
 * O `club_id` é SEMPRE o do clube ativo da sessão (`session.activeClub.clubId`),
 * nunca vindo do formulário: no insert ele é injetado; nas edições, toggles e
 * exclusões ele compõe o `where`, de modo que uma linha de outro clube jamais é
 * alvo (defesa em profundidade com a RLS). Toda entrada passa pelo
 * `recurringSchema` (revalidação no servidor), que rejeita valores ≤ 0 e dia
 * fora de 1..28.
 *
 * O campo `last_generated_period` NUNCA é escrito aqui: ele pertence ao cron
 * (tarefa 21.10), responsável pela geração idempotente dos lançamentos por
 * clube. Desativar uma despesa (`is_active = false`) faz o cron parar de gerar
 * novos lançamentos a partir dela, preservando os já gerados — que são linhas
 * independentes em `transactions` (Req 10.4).
 *
 * Todas as mutações usam o cliente ligado à sessão do usuário (`createClient`),
 * de modo que a RLS se aplique.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Garante que há um clube ativo e que o usuário é `presidente` ou `tesoureiro`
 * nele (Req 10.1). Retorna o `club_id` ativo para escopar todas as queries da
 * action; caso contrário, uma mensagem pronta para a UI.
 */
async function requireManager(): Promise<
  | { ok: true; clubId: string }
  | { ok: false; state: RecurringActionState }
> {
  const session = await getMembershipSession();

  if (!session || session.hasNoClub || !session.activeClub) {
    return {
      ok: false,
      state: {
        status: "error",
        message: "Selecione um futebol ativo para gerenciar despesas recorrentes.",
      },
    };
  }

  if (session.role !== "presidente" && session.role !== "tesoureiro") {
    return {
      ok: false,
      state: {
        status: "error",
        message:
          "Apenas presidente e tesoureiro podem gerenciar despesas recorrentes.",
      },
    };
  }

  return { ok: true, clubId: session.activeClub.clubId };
}

/** Extrai os campos do FormData no formato esperado pelo schema. */
function readFormData(formData: FormData): Record<string, unknown> {
  return {
    amountCents: formData.get("amountCents"),
    categoryId: formData.get("categoryId"),
    description: formData.get("description"),
    dayOfMonth: formData.get("dayOfMonth"),
    // Checkbox: presente ("on") quando marcado, ausente quando não.
    isActive: formData.get("isActive") ?? false,
  };
}

/** Mapeia os erros do Zod para o formato `fieldErrors` do estado. */
function toFieldErrors(
  issues: { path: (string | number)[]; message: string }[],
): Partial<Record<keyof RecurringFormValues, string>> {
  const fieldErrors: Partial<Record<keyof RecurringFormValues, string>> = {};
  for (const issue of issues) {
    const key = issue.path[0] as keyof RecurringFormValues | undefined;
    if (key && !fieldErrors[key]) {
      fieldErrors[key] = issue.message;
    }
  }
  return fieldErrors;
}

/**
 * Converte o payload validado (camelCase) para a linha do banco (snake_case).
 * NÃO inclui `last_generated_period` (gerido pelo cron) nem `club_id` (injetado
 * explicitamente no insert a partir do clube ativo).
 */
function toDbRow(data: RecurringInput) {
  return {
    amount_cents: data.amountCents,
    category_id: data.categoryId,
    description: data.description,
    day_of_month: data.dayOfMonth,
    is_active: data.isActive,
  };
}

// ─── Criar despesa recorrente (Req 10.1) ─────────────────────────────────────

export async function createRecurring(
  _prevState: RecurringActionState,
  formData: FormData,
): Promise<RecurringActionState> {
  const auth = await requireManager();
  if (!auth.ok) return auth.state;
  const { clubId } = auth;

  const parsed = recurringSchema.safeParse(readFormData(formData));
  if (!parsed.success) {
    return {
      status: "error",
      message: "Corrija os campos inválidos.",
      fieldErrors: toFieldErrors(parsed.error.issues),
    };
  }

  const supabase = await createClient();
  // Injeta o club_id do clube ativo no insert (escopo multi-tenant, Req 10.1).
  const { error } = await supabase
    .from("recurring_expenses")
    .insert({ ...toDbRow(parsed.data), club_id: clubId });

  if (error) {
    return { status: "error", message: `Erro ao salvar: ${error.message}` };
  }

  revalidatePath("/recorrentes");
  return {
    status: "success",
    message: "Despesa recorrente cadastrada com sucesso.",
  };
}

// ─── Editar despesa recorrente (Req 10.1, 10.4) ──────────────────────────────

export async function updateRecurring(
  _prevState: RecurringActionState,
  formData: FormData,
): Promise<RecurringActionState> {
  const auth = await requireManager();
  if (!auth.ok) return auth.state;
  const { clubId } = auth;

  const id = formData.get("id");
  if (typeof id !== "string" || id.trim() === "") {
    return { status: "error", message: "Despesa recorrente não identificada." };
  }

  const parsed = recurringSchema.safeParse(readFormData(formData));
  if (!parsed.success) {
    return {
      status: "error",
      message: "Corrija os campos inválidos.",
      fieldErrors: toFieldErrors(parsed.error.issues),
    };
  }

  const supabase = await createClient();
  // O filtro `club_id` impede editar despesas de outro futebol mesmo que o id
  // seja conhecido. A RLS reforça a mesma regra no banco.
  const { error } = await supabase
    .from("recurring_expenses")
    .update(toDbRow(parsed.data))
    .eq("id", id)
    .eq("club_id", clubId);

  if (error) {
    return { status: "error", message: `Erro ao salvar: ${error.message}` };
  }

  revalidatePath("/recorrentes");
  return {
    status: "success",
    message: "Despesa recorrente atualizada com sucesso.",
  };
}

// ─── Ativar/desativar (toggle is_active — Req 10.4) ──────────────────────────

/**
 * Alterna o status ativa/inativa de uma despesa recorrente do clube ativo.
 *
 * Ao DESATIVAR (`is_active = false`), o cron deixa de gerar novos lançamentos a
 * partir dela (Req 10.4). Os lançamentos já gerados NÃO são afetados — são
 * linhas independentes em `transactions` que apenas referenciam `recurring_id`.
 * O `where` exige o `club_id` ativo: linhas de outro clube nunca são alvo.
 */
export async function setRecurringActive(
  _prevState: RecurringToggleActionState,
  formData: FormData,
): Promise<RecurringToggleActionState> {
  const auth = await requireManager();
  if (!auth.ok) {
    return { status: "error", message: auth.state.message };
  }
  const { clubId } = auth;

  const id = formData.get("id");
  if (typeof id !== "string" || id.trim() === "") {
    return { status: "error", message: "Despesa recorrente não identificada." };
  }

  const nextActive = formData.get("isActive") === "true";

  const supabase = await createClient();
  const { error } = await supabase
    .from("recurring_expenses")
    .update({ is_active: nextActive })
    .eq("id", id)
    .eq("club_id", clubId);

  if (error) {
    return { status: "error", message: `Erro ao atualizar: ${error.message}` };
  }

  revalidatePath("/recorrentes");
  return {
    status: "success",
    message: nextActive
      ? "Despesa recorrente reativada."
      : "Despesa recorrente desativada. Novos lançamentos deixarão de ser gerados; os já gerados foram preservados.",
  };
}

// Reexporta o tipo para consumidores que precisam da forma da linha.
export type { RecurringRow };
