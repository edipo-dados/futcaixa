import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getMembershipSession } from "@/lib/auth/membership";
import { currentPeriod, defaultDueDate } from "@/lib/date";
import { emptyChargeFormValues } from "@/lib/validation/charge";

import { ChargeForm } from "../charge-form";
import { loadActivePlayers, loadDueDay } from "../data";

/**
 * Página de criação de cobrança manual (Server Component — presidente/
 * tesoureiro do futebol ativo).
 *
 * Carrega no servidor os jogadores ativos do clube ativo (para o select) e o
 * dia de vencimento padrão das Configurações do clube (Req 11.4), usado para
 * pré-preencher o vencimento. O período padrão (para mensalidade) é o mês
 * corrente.
 *
 * MULTI-TENANT (tarefa 21.5): jogadores e configurações são escopados ao clube
 * ativo. Sem futebol ativo ou sem papel de gestor, redireciona ao dashboard.
 *
 * Requisitos: 11.3, 11.4.
 */
export default async function NovaCobrancaPage() {
  const session = await getMembershipSession();
  if (!session || !session.activeClub) {
    redirect("/dashboard");
  }
  if (session.role !== "presidente" && session.role !== "tesoureiro") {
    redirect("/dashboard");
  }

  const clubId = session.activeClub.clubId;
  const [players, dueDay] = await Promise.all([
    loadActivePlayers(clubId),
    loadDueDay(clubId),
  ]);

  // Vencimento padrão a partir das Configurações; fallback para o dia 10 quando
  // o valor não estiver configurado (Req 5.8).
  const defaultDue = defaultDueDate(dueDay ?? 10);
  const defaultPeriod = currentPeriod();

  return (
    <div className="container max-w-2xl py-8">
      <div className="mb-6">
        <Link
          href="/cobrancas"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Voltar para cobranças
        </Link>
        <h1 className="text-2xl font-bold">Nova cobrança</h1>
      </div>

      <ChargeForm
        players={players}
        defaultValues={emptyChargeFormValues(defaultDue, defaultPeriod)}
      />
    </div>
  );
}
