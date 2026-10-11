import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getMembershipSession } from "@/lib/auth/membership";
import { emptyTransactionFormValues } from "@/lib/validation/transaction";

import { loadActiveCategories, loadActivePlayers } from "../data";
import { TransactionForm } from "../transaction-form";

/**
 * Página de criação de lançamento (Server Component — presidente/tesoureiro,
 * Req 9.11).
 *
 * MULTI-TENANT (tarefa 21.4): carrega as categorias ativas e os jogadores
 * ativos do FUTEBOL ATIVO no servidor e os passa ao formulário (o filtro de
 * categoria por tipo acontece no cliente). Sem futebol ativo → onboarding; só
 * presidente/tesoureiro acessam (Req 9.11).
 */
export default async function NovoLancamentoPage() {
  const session = await getMembershipSession();
  if (!session || session.hasNoClub || !session.activeClub) {
    redirect("/sem-futebol");
  }
  if (session.role !== "presidente" && session.role !== "tesoureiro") {
    redirect("/dashboard");
  }

  const clubId = session.activeClub.clubId;
  const [categories, players] = await Promise.all([
    loadActiveCategories(clubId),
    loadActivePlayers(clubId),
  ]);

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
        <h1 className="text-2xl font-bold">Novo lançamento</h1>
      </div>

      <TransactionForm
        mode="create"
        defaultValues={emptyTransactionFormValues()}
        categories={categories}
        players={players}
      />
    </div>
  );
}
