import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getMembershipSession } from "@/lib/auth/membership";
import { createClient } from "@/lib/supabase/server";
import {
  playerRowToFormValues,
  type PlayerRow,
} from "@/lib/validation/player";

import { PlayerForm } from "../../player-form";

/**
 * Página de edição de jogador (Server Component).
 *
 * MULTI-TENANT (tarefa 21.2): só o `presidente` do futebol ATIVO edita
 * jogadores (Req 8.8); sem futebol ativo ou sem o papel, redireciona ao
 * dashboard. A leitura do jogador é escopada ao clube ativo (`.eq('club_id',
 * ...)`) para não carregar/editar jogador de outro futebol mesmo com o id
 * conhecido. A RLS garante a autorização no banco.
 */
export default async function EditarJogadorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getMembershipSession();
  if (!session || !session.activeClub || session.role !== "presidente") {
    redirect("/dashboard");
  }

  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("players")
    .select(
      "id, name, nickname, email, phone, type, status, skill_level, is_exempt, exempt_reason, custom_monthly_cents, custom_drop_in_cents, deleted_at",
    )
    .eq("id", id)
    .eq("club_id", session.activeClub.clubId)
    .is("deleted_at", null)
    .maybeSingle<PlayerRow>();

  if (error || !data) {
    notFound();
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
        <h1 className="text-2xl font-bold">Editar jogador</h1>
      </div>

      <PlayerForm
        mode="edit"
        playerId={data.id}
        defaultValues={playerRowToFormValues(data)}
      />
    </div>
  );
}
