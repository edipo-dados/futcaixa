"use server";

import { revalidatePath } from "next/cache";

import { getMembershipSession } from "@/lib/auth/membership";
import { createClient } from "@/lib/supabase/server";
import {
  type CategoryActionState,
  type CategoryRow,
  createCategorySchema,
  renameCategorySchema,
} from "@/lib/validation/category";

/**
 * Server Actions de Categorias (Requisitos 9.2, 9.3, 9.4, 9.5).
 *
 * MULTI-TENANT (tarefa 21.3): as categorias são escopadas ao FUTEBOL ATIVO
 * (`club_id`). Somente o papel `presidente` do clube ativo gerencia categorias
 * (Req 9.3). A regra é garantida aqui (verificação de papel + escopo explícito
 * de `club_id`) e, de forma autoritativa, pela RLS no Postgres.
 *
 * O `club_id` é SEMPRE o do clube ativo da sessão (`session.activeClub.clubId`),
 * nunca vindo do formulário: no insert ele é injetado; nas edições, reordenações
 * e exclusões ele compõe o `where`, de modo que uma linha de outro clube jamais
 * é alvo (defesa em profundidade com a RLS). Toda entrada textual passa pelos
 * schemas Zod (revalidação no servidor).
 *
 * Pontos-chave preservados do single-tenant:
 *  - criar/renomear respeitam o índice único `(club_id, kind, lower(name))`;
 *  - reordenar troca o `sort_order` com o vizinho DO MESMO CLUBE (swap simples);
 *  - desativar substitui a exclusão quando a categoria já é usada ou é de
 *    sistema (Req 9.4) — os lançamentos antigos continuam apontando para a
 *    categoria original (Req 9.5), pois nada é apagado.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

const UNIQUE_VIOLATION = "23505";

/**
 * Resultado da guarda de acesso: ou devolve um erro pronto (sem clube ativo ou
 * papel insuficiente), ou o `clubId` do clube ativo para escopar as operações.
 */
type Guard =
  | { ok: false; state: CategoryActionState }
  | { ok: true; clubId: string };

/**
 * Garante que há um clube ativo e que o usuário é `presidente` nele (Req 9.3).
 * Retorna o `club_id` ativo para escopar todas as queries da action.
 */
async function requirePresident(): Promise<Guard> {
  const session = await getMembershipSession();

  if (!session || session.hasNoClub || !session.activeClub) {
    return {
      ok: false,
      state: {
        status: "error",
        message: "Selecione um futebol ativo para gerenciar categorias.",
      },
    };
  }

  if (session.role !== "presidente") {
    return {
      ok: false,
      state: {
        status: "error",
        message: "Apenas o presidente do futebol pode gerenciar categorias.",
      },
    };
  }

  return { ok: true, clubId: session.activeClub.clubId };
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function revalidate() {
  revalidatePath("/categorias");
}

// ─── Criar categoria (Req 9.3) ───────────────────────────────────────────────

/**
 * Cria uma categoria nova no clube ativo. O `sort_order` é definido como o
 * último da lista do mesmo tipo DENTRO do clube (fica no fim), e a categoria
 * nasce ativa e não-sistema. O `club_id` é injetado a partir do clube ativo.
 */
export async function createCategory(
  _prevState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const guard = await requirePresident();
  if (!guard.ok) return guard.state;
  const { clubId } = guard;

  const parsed = createCategorySchema.safeParse({
    kind: readString(formData, "kind"),
    name: readString(formData, "name"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }

  const supabase = await createClient();

  // Calcula a próxima ordem (fim da lista do mesmo tipo NO CLUBE ATIVO).
  const { data: last } = await supabase
    .from("categories")
    .select("sort_order")
    .eq("club_id", clubId)
    .eq("kind", parsed.data.kind)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();

  const nextOrder = (last?.sort_order ?? 0) + 1;

  const { error } = await supabase.from("categories").insert({
    club_id: clubId,
    kind: parsed.data.kind,
    name: parsed.data.name,
    sort_order: nextOrder,
    is_active: true,
    is_system: false,
  });

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        status: "error",
        message: "Já existe uma categoria com este nome neste tipo.",
      };
    }
    return { status: "error", message: `Erro ao salvar: ${error.message}` };
  }

  revalidate();
  return { status: "success", message: "Categoria criada com sucesso." };
}

// ─── Renomear categoria (Req 9.3) ────────────────────────────────────────────

/**
 * Renomeia uma categoria do clube ativo, inclusive as de sistema (Req 9.3). Os
 * lançamentos antigos continuam vinculados à mesma linha (preserva o histórico,
 * exibindo o novo nome na categoria — a identidade não muda). O `where` exige
 * `club_id` do clube ativo: linhas de outro clube nunca são alvo.
 */
export async function renameCategory(
  _prevState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const guard = await requirePresident();
  if (!guard.ok) return guard.state;
  const { clubId } = guard;

  const parsed = renameCategorySchema.safeParse({
    id: readString(formData, "id"),
    name: readString(formData, "name"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.id)
    .eq("club_id", clubId);

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        status: "error",
        message: "Já existe uma categoria com este nome neste tipo.",
      };
    }
    return { status: "error", message: `Erro ao salvar: ${error.message}` };
  }

  revalidate();
  return { status: "success", message: "Categoria renomeada." };
}

// ─── Ativar / desativar categoria (Req 9.3, 9.4, 9.5) ────────────────────────

/**
 * Ativa ou desativa uma categoria do clube ativo. Desativar a remove da oferta
 * em novos lançamentos (Req 9.4), mas preserva o histórico: os lançamentos
 * antigos continuam exibindo a categoria original (Req 9.5), pois a linha não é
 * removida nem alterada em sua identidade. O `where` exige o `club_id` ativo.
 */
export async function setCategoryActive(
  _prevState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const guard = await requirePresident();
  if (!guard.ok) return guard.state;
  const { clubId } = guard;

  const id = readString(formData, "id").trim();
  if (id === "") {
    return { status: "error", message: "Categoria não identificada." };
  }

  const rawActive = readString(formData, "isActive");
  // O formulário envia o estado desejado ("true"/"false").
  const nextActive = rawActive === "true";

  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .update({ is_active: nextActive })
    .eq("id", id)
    .eq("club_id", clubId);

  if (error) {
    return { status: "error", message: `Erro ao salvar: ${error.message}` };
  }

  revalidate();
  return {
    status: "success",
    message: nextActive
      ? "Categoria ativada. Voltará a ser oferecida em novos lançamentos."
      : "Categoria desativada. Deixa de aparecer em novos lançamentos; o histórico foi preservado.",
  };
}

// ─── Reordenar categoria (Req 9.3) ───────────────────────────────────────────

/**
 * Move uma categoria do clube ativo para cima ou para baixo, trocando o
 * `sort_order` com o vizinho imediato do mesmo tipo DENTRO DO CLUBE. Abordagem
 * simples e robusta (sem biblioteca de drag-and-drop): localiza o vizinho pela
 * ordem e faz um swap atômico de valores. Idempotente nas bordas (se não há
 * vizinho, nada muda). Todas as queries filtram por `club_id` do clube ativo.
 */
export async function moveCategory(
  _prevState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const guard = await requirePresident();
  if (!guard.ok) return guard.state;
  const { clubId } = guard;

  const id = readString(formData, "id").trim();
  if (id === "") {
    return { status: "error", message: "Categoria não identificada." };
  }

  const direction = readString(formData, "direction");
  if (direction !== "up" && direction !== "down") {
    return { status: "error", message: "Direção inválida." };
  }

  const supabase = await createClient();

  // Carrega a categoria a mover (precisamos de kind e sort_order), restrita ao
  // clube ativo.
  const { data: current, error: currentError } = await supabase
    .from("categories")
    .select("id, kind, sort_order")
    .eq("id", id)
    .eq("club_id", clubId)
    .maybeSingle<Pick<CategoryRow, "id" | "kind" | "sort_order">>();

  if (currentError || !current) {
    return { status: "error", message: "Categoria não encontrada." };
  }

  // Encontra o vizinho imediato na direção pedida, dentro do mesmo tipo e do
  // mesmo clube. "up" = menor sort_order mais próximo; "down" = maior mais
  // próximo.
  const neighborQuery = supabase
    .from("categories")
    .select("id, sort_order")
    .eq("club_id", clubId)
    .eq("kind", current.kind)
    .limit(1);

  const { data: neighbor, error: neighborError } =
    direction === "up"
      ? await neighborQuery
          .lt("sort_order", current.sort_order)
          .order("sort_order", { ascending: false })
          .maybeSingle<{ id: string; sort_order: number }>()
      : await neighborQuery
          .gt("sort_order", current.sort_order)
          .order("sort_order", { ascending: true })
          .maybeSingle<{ id: string; sort_order: number }>();

  if (neighborError) {
    return {
      status: "error",
      message: `Erro ao reordenar: ${neighborError.message}`,
    };
  }

  // Já está na borda — nada a fazer (idempotente).
  if (!neighbor) {
    revalidate();
    return { status: "success", message: "Categoria já está nessa posição." };
  }

  // Swap dos valores de sort_order entre a categoria e o vizinho (ambos do
  // clube ativo).
  const { error: updateCurrentError } = await supabase
    .from("categories")
    .update({ sort_order: neighbor.sort_order })
    .eq("id", current.id)
    .eq("club_id", clubId);

  if (updateCurrentError) {
    return {
      status: "error",
      message: `Erro ao reordenar: ${updateCurrentError.message}`,
    };
  }

  const { error: updateNeighborError } = await supabase
    .from("categories")
    .update({ sort_order: current.sort_order })
    .eq("id", neighbor.id)
    .eq("club_id", clubId);

  if (updateNeighborError) {
    return {
      status: "error",
      message: `Erro ao reordenar: ${updateNeighborError.message}`,
    };
  }

  revalidate();
  return { status: "success", message: "Ordem atualizada." };
}

// ─── Excluir categoria (Req 9.4) ─────────────────────────────────────────────

/**
 * Exclui uma categoria do clube ativo APENAS quando ela é segura de remover:
 *  - não é de sistema (`is_system = false`); e
 *  - não está vinculada a nenhum lançamento (transactions) nem despesa
 *    recorrente (recurring_expenses) do clube.
 *
 * Caso contrário, a exclusão é recusada (Req 9.4) e orienta-se a desativá-la,
 * preservando o histórico (Req 9.5). Essa checagem no servidor é uma camada de
 * UX; a integridade referencial do banco (FKs) é a barreira final. Todas as
 * consultas e a exclusão filtram por `club_id` do clube ativo.
 */
export async function deleteCategory(
  _prevState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const guard = await requirePresident();
  if (!guard.ok) return guard.state;
  const { clubId } = guard;

  const id = readString(formData, "id").trim();
  if (id === "") {
    return { status: "error", message: "Categoria não identificada." };
  }

  const supabase = await createClient();

  // Carrega a categoria (precisamos saber se é de sistema), restrita ao clube.
  const { data: category, error: loadError } = await supabase
    .from("categories")
    .select("id, is_system")
    .eq("id", id)
    .eq("club_id", clubId)
    .maybeSingle<Pick<CategoryRow, "id" | "is_system">>();

  if (loadError || !category) {
    return { status: "error", message: "Categoria não encontrada." };
  }

  // Categorias de sistema nunca são excluídas (Req 9.4) — apenas desativadas.
  if (category.is_system) {
    return {
      status: "error",
      message:
        "Categorias padrão não podem ser excluídas. Desative-a para deixar de oferecê-la em novos lançamentos.",
    };
  }

  // Checa uso em lançamentos e em despesas recorrentes do mesmo clube.
  const { count: txCount, error: txError } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("club_id", clubId)
    .eq("category_id", id);

  if (txError) {
    return {
      status: "error",
      message: `Erro ao verificar uso: ${txError.message}`,
    };
  }

  const { count: recurringCount, error: recurringError } = await supabase
    .from("recurring_expenses")
    .select("id", { count: "exact", head: true })
    .eq("club_id", clubId)
    .eq("category_id", id);

  if (recurringError) {
    return {
      status: "error",
      message: `Erro ao verificar uso: ${recurringError.message}`,
    };
  }

  if ((txCount ?? 0) > 0 || (recurringCount ?? 0) > 0) {
    return {
      status: "error",
      message:
        "Esta categoria já está vinculada a lançamentos. Em vez de excluir, desative-a para preservar o histórico.",
    };
  }

  const { error: deleteError } = await supabase
    .from("categories")
    .delete()
    .eq("id", id)
    .eq("club_id", clubId);

  if (deleteError) {
    // Violação de FK (uso detectado no banco) — orienta a desativar.
    if (deleteError.code === "23503") {
      return {
        status: "error",
        message:
          "Esta categoria está em uso e não pode ser excluída. Desative-a para preservar o histórico.",
      };
    }
    return {
      status: "error",
      message: `Erro ao excluir: ${deleteError.message}`,
    };
  }

  revalidate();
  return { status: "success", message: "Categoria excluída." };
}
