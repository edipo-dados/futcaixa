import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getMembershipSession } from "@/lib/auth/membership";
import { createClient } from "@/lib/supabase/server";
import {
  CATEGORY_KINDS,
  CATEGORY_KIND_LABELS,
  type CategoryKind,
  type CategoryRow as CategoryRowData,
} from "@/lib/validation/category";

import { CategoryRow } from "./category-row";
import { CreateCategoryForm } from "./create-category-form";

/**
 * Página de Categorias (Server Component — presidente-only, Req 9.2–9.5).
 *
 * Multi-tenant (tarefa 21.3): as categorias são escopadas ao FUTEBOL ATIVO
 * (`club_id`). Lista as categorias do clube ativo agrupadas por tipo
 * (receita/despesa), ordenadas por `sort_order` e, em empate, por nome. Mostra
 * o estado ativo/inativo e um selo para categorias padrão (de sistema).
 *
 * Guard de acesso: sem futebol ativo → redirect ao onboarding (padrão das
 * telas internas); somente o papel `presidente` do clube ativo gerencia as
 * categorias (Req 9.3). A leitura usa o cliente ligado à sessão, de modo que a
 * RLS também se aplica; ainda assim filtramos por `club_id` explicitamente.
 */

async function loadCategories(clubId: string): Promise<CategoryRowData[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, kind, name, sort_order, is_active, is_system")
    .eq("club_id", clubId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<CategoryRowData[]>();

  if (error || !data) return [];
  return data;
}

function groupByKind(
  categories: CategoryRowData[],
): Record<CategoryKind, CategoryRowData[]> {
  const groups: Record<CategoryKind, CategoryRowData[]> = {
    receita: [],
    despesa: [],
  };
  for (const category of categories) {
    groups[category.kind].push(category);
  }
  return groups;
}

export default async function CategoriasPage() {
  const session = await getMembershipSession();

  // Sem sessão ou sem futebol ativo: cai no fluxo de onboarding "sem futebol"
  // (mesma rota usada pelo middleware — Req 1.6/7.7).
  if (!session || session.hasNoClub || !session.activeClub) {
    redirect("/sem-futebol");
  }

  // Guard no servidor: só o presidente do clube ativo gerencia categorias
  // (Req 9.3). A RLS reforça a regra no banco.
  if (session.role !== "presidente") {
    redirect("/dashboard");
  }

  const categories = await loadCategories(session.activeClub.clubId);
  const groups = groupByKind(categories);

  return (
    <div className="container max-w-3xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Categorias</h1>
        <p className="mt-1 text-muted-foreground">
          Crie, renomeie, reordene e ative/desative as categorias de receita e
          despesa. Categorias usadas em lançamentos não podem ser excluídas —
          desative-as para preservar o histórico.
        </p>
      </div>

      <div className="space-y-6">
        {CATEGORY_KINDS.map((kind) => {
          const items = groups[kind];
          return (
            <Card key={kind}>
              <CardHeader>
                <CardTitle>{CATEGORY_KIND_LABELS[kind]}</CardTitle>
                <CardDescription>
                  {kind === "despesa"
                    ? "Categorias para classificar as despesas do caixa."
                    : "Categorias para classificar as receitas do caixa."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <CreateCategoryForm defaultKind={kind} />

                {items.length === 0 ? (
                  <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                    Nenhuma categoria de{" "}
                    {CATEGORY_KIND_LABELS[kind].toLowerCase()} cadastrada.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {items.map((category, index) => (
                      <CategoryRow
                        key={category.id}
                        category={category}
                        isFirst={index === 0}
                        isLast={index === items.length - 1}
                      />
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
