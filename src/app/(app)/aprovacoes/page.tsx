import { redirect } from "next/navigation";

import { getMembershipSession, hasClubRole } from "@/lib/auth/membership";
import { formatDate } from "@/lib/date";
import { fromCents } from "@/lib/money";
import { CHARGE_KIND_LABELS } from "@/lib/validation/charge";

import { loadPendingProofs } from "./data";
import { ProofReviewActions } from "./proof-review-actions";

/**
 * Página de Aprovações (Server Component — presidente/tesoureiro, tarefa 9.6).
 *
 * Lista as cobranças atualmente `em_analise` do FUTEBOL ATIVO com o comprovante
 * mais recente de cada uma (join charges + players + payment_proofs). Para cada
 * item, o gestor vê o jogador, o valor e a descrição da cobrança, pode abrir o
 * comprovante (URL assinada) e aprovar (paga + receita — Req 6.6) ou rejeitar
 * com motivo (volta a cobrança para pendente — Req 6.7). A auditoria de ambas é
 * automática via triggers na tabela `payment_proofs`.
 *
 * MULTI-TENANT (tarefa 21): a fila é escopada ao clube ativo via `club_id`.
 * Sem futebol ativo (estado "sem futebol") → onboarding `/sem-futebol`; apenas
 * presidente ou tesoureiro do clube ativo revisam comprovantes, senão
 * `/dashboard`. O guard abaixo é a barreira de UX no servidor; a autoridade
 * real é a RLS no Postgres.
 *
 * Requisitos: 6.6 (aprovar → paga + receita + auditoria), 6.7 (rejeitar →
 * pendente + motivo + auditoria).
 */
export default async function AprovacoesPage() {
  const session = await getMembershipSession();

  // Guard no servidor: sem futebol ativo não há fila a escopar.
  if (!session || session.hasNoClub || !session.activeClub) {
    redirect("/sem-futebol");
  }

  // Só presidente ou tesoureiro do clube ativo revisam comprovantes.
  if (!hasClubRole(session, "presidente", "tesoureiro")) {
    redirect("/dashboard");
  }

  const proofs = await loadPendingProofs(session.activeClub.clubId);

  return (
    <div className="container max-w-4xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Aprovações</h1>
        <p className="mt-1 text-muted-foreground">
          Comprovantes enviados pelos jogadores aguardando sua análise. Aprove
          para marcar a cobrança como paga ou rejeite informando o motivo.
        </p>
      </div>

      {proofs.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          Nenhum comprovante aguardando análise no momento.
        </div>
      ) : (
        <ul className="space-y-2">
          {proofs.map((p) => {
            const playerLabel = p.playerNickname
              ? `${p.playerName} (${p.playerNickname})`
              : p.playerName;

            return (
              <li
                key={p.proofId}
                className="flex items-start gap-3 rounded-md border bg-card p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate font-medium">{playerLabel}</p>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {fromCents(p.amountCents)}
                    </span>
                  </div>
                  {p.description ? (
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {p.description}
                    </p>
                  ) : null}
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                      Em análise
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{CHARGE_KIND_LABELS[p.kind]}</span>
                    <span aria-hidden="true">·</span>
                    <span>Vence {formatDate(p.dueDate)}</span>
                    {p.period ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Ref. {p.period}</span>
                      </>
                    ) : null}
                    <span aria-hidden="true">·</span>
                    <span>Enviado em {formatDate(p.createdAt)}</span>
                  </p>

                  <ProofReviewActions
                    proofId={p.proofId}
                    filePath={p.filePath}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
