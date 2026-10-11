import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Inbox, UsersRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getMembershipSession } from "@/lib/auth/membership";
import { canManageMembers } from "@/lib/clubs/approveMember";
import { createClient } from "@/lib/supabase/server";

import { InviteLinkCard } from "./invite-link-card";
import { RevisarMembroForm } from "./revisar-membro-form";

export const metadata: Metadata = {
  title: "Membros — FutCaixa",
  description:
    "Aprovar ou recusar membros pendentes do futebol (presidente).",
};

// A lista reflete o estado atual das solicitações; nunca deve ser cacheada.
export const dynamic = "force-dynamic";

/** Linha de membership pendente, com o nome do usuário via join em profiles. */
interface PendingMembershipRow {
  id: string;
  user_id: string;
  created_at: string;
  profiles:
    | { full_name: string | null }
    | { full_name: string | null }[]
    | null;
}

/** Normaliza o join `profiles` (Supabase pode devolver objeto ou array). */
function nameFromJoin(row: PendingMembershipRow): string {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const name = profile?.full_name?.trim();
  return name && name.length > 0 ? name : "Usuário sem nome";
}

/** Jogador do clube ainda não vinculado a nenhuma membership. */
export interface UnlinkedPlayer {
  id: string;
  name: string;
  nickname: string | null;
}

/** Linha mínima de players lida para montar a lista de não vinculados. */
interface PlayerRow {
  id: string;
  name: string;
  nickname: string | null;
}

/**
 * Lista os jogadores do clube ATIVO que ainda NÃO estão vinculados a nenhuma
 * membership (candidatos para o presidente "linkar" ao aprovar quem entrou pelo
 * link). Útil quando o jogador foi cadastrado manualmente em /jogadores antes
 * de entrar pelo convite — evita criar um registro duplicado.
 *
 * Como não há relação direta player→membership no PostgREST, resolvemos em dois
 * passos: (1) coletamos os `player_id` já usados em memberships do clube; (2)
 * listamos os players ativos/não excluídos do clube que não estão nessa lista.
 */
async function loadUnlinkedPlayers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clubId: string,
): Promise<UnlinkedPlayer[]> {
  const { data: links } = await supabase
    .from("memberships")
    .select("player_id")
    .eq("club_id", clubId)
    .not("player_id", "is", null)
    .returns<{ player_id: string }[]>();

  const linkedIds = new Set((links ?? []).map((l) => l.player_id));

  const { data: players } = await supabase
    .from("players")
    .select("id, name, nickname")
    .eq("club_id", clubId)
    .eq("status", "ativo")
    .is("deleted_at", null)
    .order("name", { ascending: true })
    .returns<PlayerRow[]>();

  return (players ?? [])
    .filter((p) => !linkedIds.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, nickname: p.nickname }));
}

/**
 * Resolve a URL base do app a partir dos headers da requisição (robusto em dev
 * e produção), com fallback para `NEXT_PUBLIC_APP_URL` e, por fim, localhost.
 * Mesmo padrão usado em `(auth)/login/actions.ts` para montar links absolutos.
 */
async function resolveOrigin(): Promise<string> {
  const hdrs = await headers();
  return (
    hdrs.get("origin") ??
    (hdrs.get("x-forwarded-proto") && hdrs.get("x-forwarded-host")
      ? `${hdrs.get("x-forwarded-proto")}://${hdrs.get("x-forwarded-host")}`
      : null) ??
    (hdrs.get("host") ? `https://${hdrs.get("host")}` : null) ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000"
  );
}

/**
 * Tela de membros do futebol (tarefa 20.3 — Requisitos 4.5, 4.6, 4.7, 4.8, 4.9).
 *
 * Lista as memberships `pendentes` do clube ATIVO (join em `profiles` para o
 * nome do usuário) e, para cada uma, os controles de APROVAR (escolhendo o tipo
 * mensalista/avulso) e RECUSAR, via Server Actions.
 *
 * Guard: só o presidente do clube ativo acessa (Req 4.8). O middleware já
 * protege `/membros` exigindo papel presidente; aqui reforçamos no servidor
 * (defesa em profundidade) e redirecionamos ao dashboard quem não for
 * presidente ou estiver sem futebol. A RLS de `memberships` é a autoridade
 * final: a leitura só retorna as memberships do clube do presidente.
 */
export default async function MembrosPage() {
  const session = await getMembershipSession();

  // Guard no servidor: só presidente do clube ativo (Req 4.8).
  if (!session || !canManageMembers(session.role) || !session.activeClub) {
    redirect("/dashboard");
  }

  const supabase = await createClient();

  // Código de convite do clube ativo (fixo por clube). A RLS de `clubs` já
  // permite ao presidente ler o próprio clube; filtramos pelo clube ativo.
  const { data: club } = await supabase
    .from("clubs")
    .select("invite_code")
    .eq("id", session.activeClub.clubId)
    .maybeSingle<{ invite_code: string | null }>();

  const inviteCode = club?.invite_code?.trim() ?? "";
  const inviteUrl =
    inviteCode.length > 0
      ? `${await resolveOrigin()}/convite/${encodeURIComponent(inviteCode)}`
      : null;

  const { data } = await supabase
    .from("memberships")
    .select("id, user_id, created_at, profiles(full_name)")
    .eq("club_id", session.activeClub.clubId)
    .eq("status", "pendente")
    .order("created_at", { ascending: true })
    .returns<PendingMembershipRow[]>();

  const pending = data ?? [];

  // Jogadores já cadastrados e ainda não vinculados — oferecidos no form para o
  // presidente vincular (em vez de criar um novo jogador).
  const unlinkedPlayers = await loadUnlinkedPlayers(
    supabase,
    session.activeClub.clubId,
  );

  return (
    <div className="container max-w-3xl py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">Membros pendentes</h1>
          <p className="text-muted-foreground">
            Aprove ou recuse quem entrou pelo link de convite do{" "}
            <span className="font-medium">{session.activeClub.clubName}</span>.
            Ao aprovar, escolha se o jogador é mensalista ou avulso.
          </p>
        </div>
        {/* Acesso à gestão de papéis: promover membros a presidente/tesoureiro
            (co-administração) ou rebaixar. */}
        <Button asChild variant="outline" className="shrink-0">
          <Link href="/membros/papeis">
            <UsersRound aria-hidden="true" />
            Gerenciar papéis
          </Link>
        </Button>
      </div>

      {inviteUrl ? (
        <InviteLinkCard
          inviteUrl={inviteUrl}
          clubName={session.activeClub.clubName}
        />
      ) : null}

      {pending.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
            <Inbox className="size-5" aria-hidden="true" />
            <span>Nenhum membro aguardando aprovação no momento.</span>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {pending.map((row) => (
            <li key={row.id}>
              <Card>
                <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-medium">{nameFromJoin(row)}</span>
                  <RevisarMembroForm
                    membershipId={row.id}
                    unlinkedPlayers={unlinkedPlayers}
                  />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
