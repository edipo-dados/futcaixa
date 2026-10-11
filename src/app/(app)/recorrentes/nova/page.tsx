import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getMembershipSession } from "@/lib/auth/membership";
import { emptyRecurringFormValues } from "@/lib/validation/recurring";

import { loadActiveExpenseCategories } from "../data";
import { RecurringForm } from "../recurring-form";

/**
 * Página de criação de despesa recorrente (Server Component —
 * presidente/tesoureiro).
 *
 * MULTI-TENANT (tarefa 21.6): sem futebol ativo redireciona ao dashboard; só
 * presidente/tesoureiro acessam (Req 10.1). Carrega as categorias ativas de
 * despesa DO CLUBE ATIVO no servidor e as passa ao formulário (uma despesa
 * recorrente é sempre do tipo despesa, Req 10.1).
 */
export default async function NovaRecorrentePage() {
  const session = await getMembershipSession();
  if (!session || !session.activeClub) {
    redirect("/dashboard");
  }
  if (session.role !== "presidente" && session.role !== "tesoureiro") {
    redirect("/dashboard");
  }

  const categories = await loadActiveExpenseCategories(session.activeClub.clubId);

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
        <h1 className="text-2xl font-bold">Nova despesa recorrente</h1>
      </div>

      <RecurringForm
        mode="create"
        defaultValues={emptyRecurringFormValues()}
        categories={categories}
      />
    </div>
  );
}
