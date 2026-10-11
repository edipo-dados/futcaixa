import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getMembershipSession } from "@/lib/auth/membership";
import { createClient } from "@/lib/supabase/server";
import { rowToForm, type TransactionRow } from "@/lib/validation/transaction";

import { loadActiveCategories, loadActivePlayers } from "../../data";
import { TransactionForm, type CategoryOption } from "../../transaction-form";

/**
 * Página de edição de lançamento (Server Component — presidente/tesoureiro,
 * Req 9.11).
 *
 * MULTI-TENANT (tarefa 21.4): carrega o lançamento pelo id DENTRO do FUTEBOL
 * ATIVO (`.eq('club_id', clubId)`) e preenche o formulário — não é possível
 * abrir um lançamento de outro futebol mesmo conhecendo o id. A RLS reforça a
 * autorização no banco; o guard de papel evita renderizar a tela para quem não
 * é presidente/tesoureiro.
 *
 * As categorias ativas do clube são carregadas para os selects; se a categoria
 * original do lançamento tiver sido desativada, ela é injetada na lista
 * (também escopada por `club_id`) para continuar visível/selecionável nesta
 * edição (preserva o histórico).
 */
export default async function EditarLancamentoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getMembershipSession();
  if (!session || session.hasNoClub || !session.activeClub) {
    redirect("/sem-futebol");
  }
  if (session.role !== "presidente" && session.role !== "tesoureiro") {
    redirect("/dashboard");
  }

  const clubId = session.activeClub.clubId;
  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select(
      "id, kind, amount_cents, occurred_on, category_id, description, player_id, charge_id, proof_path, recurring_id, created_by, deleted_at",
    )
    .eq("id", id)
    .eq("club_id", clubId)
    .is("deleted_at", null)
    .maybeSingle<TransactionRow>();

  if (error || !data) {
    notFound();
  }

  const [categories, players] = await Promise.all([
    loadActiveCategories(clubId),
    loadActivePlayers(clubId),
  ]);

  // Se a categoria original foi desativada, injeta-a para seguir selecionável
  // nesta edição (o lançamento preserva a categoria original). A busca é
  // escopada por `club_id` para não cruzar categorias de outro futebol.
  let categoryOptions: CategoryOption[] = categories;
  if (!categories.some((c) => c.id === data.category_id)) {
    const { data: original } = await supabase
      .from("categories")
      .select("id, kind, name")
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
          href="/lancamentos"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Voltar para lançamentos
        </Link>
        <h1 className="text-2xl font-bold">Editar lançamento</h1>
      </div>

      <TransactionForm
        mode="edit"
        transactionId={data.id}
        defaultValues={rowToForm(data)}
        categories={categoryOptions}
        players={players}
        hasExistingProof={!!data.proof_path}
      />
    </div>
  );
}
