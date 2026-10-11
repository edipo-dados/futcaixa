import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getMembershipSession } from "@/lib/auth/membership";
import { emptyPlayerFormValues } from "@/lib/validation/player";

import { PlayerForm } from "../player-form";

/**
 * Página de criação de jogador (Server Component).
 *
 * MULTI-TENANT (tarefa 21.2): só o `presidente` do futebol ATIVO cria jogadores
 * (Req 8.8). Sem futebol ativo ou sem papel de presidente, redireciona ao
 * dashboard. O `club_id` é injetado no servidor pela Server Action `createPlayer`
 * (nunca vem do formulário).
 */
export default async function NovoJogadorPage() {
  const session = await getMembershipSession();
  if (!session || !session.activeClub || session.role !== "presidente") {
    redirect("/dashboard");
  }

  return (
    <div className="container max-w-2xl py-8">
      <div className="mb-6">
        <Link
          href="/jogadores"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Voltar para jogadores
        </Link>
        <h1 className="text-2xl font-bold">Novo jogador</h1>
      </div>

      <PlayerForm mode="create" defaultValues={emptyPlayerFormValues()} />
    </div>
  );
}
