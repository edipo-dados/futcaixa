import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getMembershipSession } from "@/lib/auth/membership";
import { createClient } from "@/lib/supabase/server";
import { rowToForm, type RecurringRow } from "@/lib/validation/recurring";

import { loadActiveExpenseCategories } from "../../data";
import { RecurringForm, type CategoryOption } from "../../recurring-form";

/**
 * Página de edição de despesa recorrente (Server Component —
 * presidente/tesoureiro).
 *
 * Carrega a despesa pelo id e preenche o formulário. A RLS garante a
 * autorização no banco; o guard de papel evita renderizar a tela para quem não
 * é presidente/tesoureiro.
 *
 * MULTI-TENANT (tarefa 21.6): sem futebol ativo redireciona ao dashboard; a
 * busca da despesa e das categorias é escopada ao clube ativo
 * (`.eq('club_id', ...)`), de modo que uma despesa de outro futebol resulte em
 * `notFound()` mesmo com id conhecido.
 *
 * As categorias ativas de despesa do clube são carregadas para o select; se a
 * categoria original tiver sido desativada, ela é injetada na lista (restrita
 * ao mesmo clube) para continuar visível/selecionável nesta edição (preserva o
 * cadastro). O campo `last_generated_period` é lido apenas para contexto, nunca
 * editado.
 */
export default async function EditarRecorrentePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getMembershipSession();
  if (!session || !session.activeClub) {
    redirect("/dashboard");
  }
  if (session.role !== "presidente" && session.role !== "tesoureiro") {
    redirect("/dashboard");
  }

  const clubId = session.activeClub.clubId;
  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recurring_expenses")
    .select(
      "id, amount_cents, category_id, description, day_of_month, is_active, last_generated_period",
    )
    .eq("id", id)
    .eq("club_id", clubId)
    .maybeSingle<RecurringRow>();

  if (error || !data) {
    notFound();
  }

  const categories = await loadActiveExpenseCategories(clubId);

  // Se a categoria original foi desativada, injeta-a para seguir selecionável
  // nesta edição (preserva a referência original). Restrita ao mesmo clube.
  let categoryOptions: CategoryOption[] = categories;
  if (!categories.some((c) => c.id === data.category_id)) {
    const { data: original } = await supabase
      .from("categories")
      .select("id, name")
      .eq("id", data.category_id)
      .eq("club_id", clubId)
      .maybeSingle<CategoryOption>();
    if (original) {
      categoryOptions = [...categories, original];
    }
  }

  return (
    <div className="container max-w-2xl py-8">
      <div className="mb-6">
        <Link
          href="/recorrentes"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Voltar para despesas recorrentes
        </Link>
        <h1 className="text-2xl font-bold">Editar despesa recorrente</h1>
      </div>

      <RecurringForm
        mode="edit"
        recurringId={data.id}
        defaultValues={rowToForm(data)}
        categories={categoryOptions}
      />
    </div>
  );
}
