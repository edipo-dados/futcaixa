import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getMembershipSession } from "@/lib/auth/membership";
import { createClient } from "@/lib/supabase/server";
import {
  PLAYER_STATUSES,
  PLAYER_TYPES,
  type PlayerRow,
} from "@/lib/validation/player";

import { PlayerStatusToggle } from "./player-status-toggle";

/**
 * Página de Jogadores (Server Component).
 *
 * Lista os jogadores NÃO excluídos (soft delete) do FUTEBOL ATIVO com nome,
 * apelido, tipo, status, nível técnico e indicação de isenção.
 *
 * MULTI-TENANT (tarefa 21.2): a leitura é escopada ao clube ativo
 * (`.eq('club_id', ...)`); sem futebol ativo, redireciona ao dashboard (padrão
 * das telas internas). A leitura é permitida a membros do clube; apenas o
 * presidente vê os controles de gestão (criar/inativar — Req 8.8). A RLS no
 * Postgres é a autoridade final (presidente CRUD; tesoureiro/jogador SELECT).
 *
 * Requisitos: 8.1, 8.6, 8.8.
 */

const TYPE_LABELS: Record<(typeof PLAYER_TYPES)[number], string> = {
  mensalista: "Mensalista",
  avulso: "Avulso",
  convidado: "Convidado",
};

const STATUS_LABELS: Record<(typeof PLAYER_STATUSES)[number], string> = {
  ativo: "Ativo",
  inativo: "Inativo",
};

async function loadPlayers(clubId: string): Promise<PlayerRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("players")
    .select(
      "id, name, nickname, email, phone, type, status, skill_level, is_exempt, exempt_reason, custom_monthly_cents, custom_drop_in_cents, deleted_at",
    )
    .eq("club_id", clubId)
    .is("deleted_at", null)
    .order("name", { ascending: true })
    .returns<PlayerRow[]>();

  if (error || !data) return [];
  return data;
}

export default async function JogadoresPage() {
  const session = await getMembershipSession();

  // Guard no servidor: sem futebol ativo não há o que escopar (Req 6.3).
  if (!session || !session.activeClub) {
    redirect("/dashboard");
  }

  // Só o presidente do clube ativo gerencia jogadores (Req 8.8). Membros do
  // clube (tesoureiro/jogador) têm leitura — a RLS garante a mesma regra.
  const canManage = session.role === "presidente";

  const players = await loadPlayers(session.activeClub.clubId);

  return (
    <div className="container max-w-4xl py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Jogadores</h1>
          <p className="mt-1 text-muted-foreground">
            Cadastro e manutenção do grupo.
          </p>
        </div>
        {canManage ? (
          <Button asChild>
            <Link href="/jogadores/novo">
              <Plus aria-hidden="true" />
              Novo jogador
            </Link>
          </Button>
        ) : null}
      </div>

      {players.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          {canManage ? (
            <>
              Nenhum jogador cadastrado ainda. Clique em{" "}
              <span className="font-medium">Novo jogador</span> para começar.
            </>
          ) : (
            <>Nenhum jogador cadastrado ainda.</>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {players.map((p) => {
            const isInactive = p.status === "inativo";
            const nameBlock = (
              <>
                <p
                  className={`truncate font-medium ${
                    isInactive ? "text-muted-foreground" : ""
                  }`}
                >
                  {p.name}
                  {p.nickname ? (
                    <span className="text-muted-foreground">
                      {" "}
                      ({p.nickname})
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>{TYPE_LABELS[p.type]}</span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={
                      isInactive
                        ? "rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground"
                        : "rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-800 dark:bg-green-950 dark:text-green-200"
                    }
                  >
                    {STATUS_LABELS[p.status]}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Nível {p.skill_level}</span>
                  {p.is_exempt ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                      Isento
                    </span>
                  ) : null}
                </p>
              </>
            );

            return (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-md border bg-card p-4"
              >
                {canManage ? (
                  <Link
                    href={`/jogadores/${p.id}/editar`}
                    className="min-w-0 flex-1 rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {nameBlock}
                  </Link>
                ) : (
                  <div className="min-w-0 flex-1">{nameBlock}</div>
                )}
                {canManage ? (
                  <PlayerStatusToggle
                    playerId={p.id}
                    currentStatus={p.status}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
