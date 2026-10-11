import { redirect } from "next/navigation";

import { getMembershipSession, hasClubRole } from "@/lib/auth/membership";
import { aggregateDelinquents, type DelinquentRow } from "@/lib/delinquency";
import { fromCents } from "@/lib/money";

import { loadSettings } from "../configuracoes/actions";
import { DelinquentsMessage } from "./delinquents-message";
import { loadOverdueCharges } from "./data";

/**
 * Página de Inadimplentes (Server Component — presidente/tesoureiro).
 *
 * Lista os jogadores do futebol ATIVO com cobranças atrasadas — vencimento no
 * passado E status `pendente` (estado derivado, Req 5.5) — mostrando nome,
 * valor total devido e número de meses em atraso (Req 13.1). A seleção das
 * cobranças atrasadas ocorre na query (`loadOverdueCharges`, escopada por
 * `club_id`) e a agregação por jogador no helper puro `aggregateDelinquents`,
 * mantendo esta tela fina.
 *
 * MULTI-TENANT (tarefa 21.7): tudo é escopado ao clube ATIVO. O guard no
 * servidor redireciona quem não tem futebol ativo ou não é
 * presidente/tesoureiro; a leitura das cobranças filtra por `club_id` (sem
 * cruzar futebóis) e a mensagem de WhatsApp usa a chave Pix do clube ativo,
 * resolvida por `loadSettings(clubId)` (Req 13.2). A RLS no Postgres é a
 * autoridade final; o guard aqui é defesa em profundidade + UX.
 *
 * Requisitos: 13.1 (lista de inadimplentes do clube com nome, total devido e
 * meses em atraso), 13.2 (mensagem de cobrança via WhatsApp com a chave Pix do
 * clube).
 */

/** Rótulo do jogador: "Nome (Apelido)" quando houver apelido. */
function playerLabel(row: DelinquentRow): string {
  return row.playerNickname
    ? `${row.playerName} (${row.playerNickname})`
    : row.playerName;
}

/** Pluraliza "mês"/"meses" e "cobrança"/"cobranças". */
function pluralize(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export default async function InadimplentesPage() {
  const session = await getMembershipSession();

  // Guard no servidor: sem futebol ativo não há o que escopar; só
  // presidente/tesoureiro do clube ativo veem os inadimplentes (Req 13.1).
  if (!session || !session.activeClub) {
    redirect("/dashboard");
  }
  if (!hasClubRole(session, "presidente", "tesoureiro")) {
    redirect("/dashboard");
  }

  const clubId = session.activeClub.clubId;

  // Cobranças atrasadas e settings SEMPRE do clube ativo (Req 13.1, 13.2).
  const [overdue, settings] = await Promise.all([
    loadOverdueCharges(clubId),
    loadSettings(clubId),
  ]);
  const rows = aggregateDelinquents(overdue);

  const totalOwedCents = rows.reduce((sum, r) => sum + r.totalCents, 0);

  // Dados para a mensagem de cobrança via WhatsApp: nome e chave Pix vêm das
  // settings do CLUBE ATIVO (Req 13.2); nunca de outro futebol.
  const clubName = settings?.club_name ?? "Futebol";
  const pixKey = settings?.pix_key ?? "";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  return (
    <main className="container max-w-4xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Inadimplentes</h1>
        <p className="mt-1 text-muted-foreground">
          Jogadores com cobranças atrasadas (vencidas e ainda pendentes), com o
          valor total devido e os meses em atraso.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          Nenhum jogador em atraso. Tudo em dia por aqui. 🎉
        </div>
      ) : (
        <>
          <DelinquentsMessage
            rows={rows}
            clubName={clubName}
            pixKey={pixKey}
            appUrl={appUrl}
          />

          <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span>
              {pluralize(
                rows.length,
                "jogador em atraso",
                "jogadores em atraso",
              )}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Total devido:{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {fromCents(totalOwedCents)}
              </span>
            </span>
          </div>

          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.playerId}
                className="flex items-start gap-3 rounded-md border bg-card p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate font-medium">{playerLabel(row)}</p>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {fromCents(row.totalCents)}
                    </span>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive">
                      {pluralize(
                        row.monthsOverdue,
                        "mês em atraso",
                        "meses em atraso",
                      )}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {pluralize(row.chargeCount, "cobrança", "cobranças")}
                    </span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
