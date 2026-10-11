import { redirect } from "next/navigation";

import { getMembershipSession, hasClubRole } from "@/lib/auth/membership";
import {
  type ClubRole,
  isClubRole,
  ROLE_LABELS,
} from "@/lib/clubs/roles";
import { createClient } from "@/lib/supabase/server";

import { AlterarPapelForm } from "../alterar-papel-form";

/**
 * Sub-rota de gestão de PAPÉIS dos membros ativos do clube (tarefa 20.4).
 *
 * Rota própria (`/membros/papeis`) para não colidir com a tela de aprovação de
 * membros pendentes da tarefa 20.3 (`/membros`). Lista os membros ATIVOS do
 * clube ativo e, para cada um, um controle de troca de papel
 * (`AlterarPapelForm`). O presidente atual aparece com o controle para
 * promover outros; a guarda do último presidente é aplicada no banco (trigger)
 * e refletida na mensagem de erro do formulário.
 *
 * Guard de servidor (Req 5.5): só o presidente do clube ativo acessa; demais
 * papéis e o estado "sem futebol" são redirecionados. A RLS é a autoridade
 * final; esta checagem é defesa em profundidade/UX.
 *
 * Requisitos: 5.1, 5.5, 5.6.
 */

/** Linha bruta de `memberships` + join em `profiles` para o nome do membro. */
interface ActiveMemberRow {
  id: string;
  user_id: string;
  role: ClubRole;
  profiles: { full_name: string | null } | { full_name: string | null }[] | null;
}

/** Membro ativo pronto para render. */
interface ActiveMember {
  membershipId: string;
  role: ClubRole;
  name: string;
}

/** Normaliza o join `profiles` (objeto ou array) e extrai o nome. */
function nameFromRow(row: ActiveMemberRow): string {
  const profile = Array.isArray(row.profiles)
    ? (row.profiles[0] ?? null)
    : row.profiles;
  const fullName = profile?.full_name?.trim();
  return fullName && fullName !== "" ? fullName : "Sem nome";
}

async function loadActiveMembers(clubId: string): Promise<ActiveMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("id, user_id, role, profiles(full_name)")
    .eq("club_id", clubId)
    .eq("status", "ativo")
    .returns<ActiveMemberRow[]>();

  if (error || !data) {
    return [];
  }

  return data
    .filter((row): row is ActiveMemberRow => isClubRole(row.role))
    .map((row) => ({
      membershipId: row.id,
      role: row.role,
      name: nameFromRow(row),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export default async function MembrosPapeisPage() {
  const session = await getMembershipSession();

  // Sem sessão: fora da área autenticada.
  if (!session) {
    redirect("/login");
  }

  // Estado "sem futebol": vai ao onboarding/seletor.
  if (session.hasNoClub || !session.activeClub) {
    redirect("/dashboard");
  }

  // Guard de papel: só presidente do clube ativo gerencia papéis (Req 5.5).
  if (!hasClubRole(session, "presidente")) {
    redirect("/dashboard");
  }

  const members = await loadActiveMembers(session.activeClub.clubId);

  return (
    <div className="container max-w-3xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Papéis dos membros</h1>
        <p className="mt-1 text-muted-foreground">
          Promova ou rebaixe membros do futebol{" "}
          <span className="font-medium">{session.activeClub.clubName}</span>.
          Um futebol precisa ter sempre ao menos um presidente.
        </p>
      </div>

      {members.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          Nenhum membro ativo neste futebol ainda.
        </div>
      ) : (
        <ul className="space-y-2">
          {members.map((m) => (
            <li
              key={m.membershipId}
              className="flex flex-col gap-3 rounded-md border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{m.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Papel atual: {ROLE_LABELS[m.role]}
                </p>
              </div>
              <AlterarPapelForm
                membershipId={m.membershipId}
                currentRole={m.role}
                memberName={m.name}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
