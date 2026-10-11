import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getMembershipSession } from "@/lib/auth/membership";
import { emptyTransactionFormValues } from "@/lib/validation/transaction";

import { loadActiveCategories, loadActivePlayers } from "../data";
import { TransactionForm } from "../transaction-form";

/**
 * Atalho "Despesa do dia do jogo" (Server Component — presidente/tesoureiro,
 * Req 9.6/9.11).
 *
 * Reutiliza o `TransactionForm`, pré-configurando-o para uma despesa do dia do
 * jogo:
 *  - tipo pré-selecionado como `despesa` (via `emptyTransactionFormValues`);
 *  - categoria pré-selecionada em "Goleiro" quando existir entre as ativas;
 *  - data já vem defaultada para hoje (America/Sao_Paulo);
 *  - descrição livre (vazia), com placeholder orientando;
 *  - jogador relacionado opcional.
 *
 * A seleção de categoria só é honrada pelo form quando pertence ao tipo visível
 * (despesa) — por isso buscamos a "Goleiro" entre as categorias de despesa.
 *
 * MULTI-TENANT (tarefa 21.4): categorias e jogadores vêm escopados ao FUTEBOL
 * ATIVO. Sem futebol ativo → onboarding; só presidente/tesoureiro acessam.
 */
export default async function DespesaDiaDoJogoPage() {
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

  // Pré-seleciona a categoria "Goleiro" (despesa) quando ativa; o form só honra
  // categorias do tipo visível, então restringimos a busca a `kind === despesa`.
  const goalkeeperCategory = categories.find(
    (c) => c.kind === "despesa" && c.name.trim().toLowerCase() === "goleiro",
  );

  const defaultValues = {
    ...emptyTransactionFormValues("despesa"),
    categoryId: goalkeeperCategory?.id ?? "",
  };

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
        <h1 className="text-2xl font-bold">Despesa do dia do jogo</h1>
        <p className="mt-1 text-muted-foreground">
          Registre rapidamente uma despesa do jogo (ex.: goleiro contratado).
          Informe a data do jogo, a categoria e uma descrição livre. Vincular um
          jogador é opcional.
        </p>
      </div>

      <TransactionForm
        mode="create"
        defaultValues={defaultValues}
        categories={categories}
        players={players}
      />
    </div>
  );
}
