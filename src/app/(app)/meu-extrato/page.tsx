import Link from "next/link";
import { redirect } from "next/navigation";
import { CreditCard, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getMembershipSession } from "@/lib/auth/membership";
import { formatDate, todayISO } from "@/lib/date";
import { fromCents } from "@/lib/money";
import { createPixProvider } from "@/lib/payments/StaticPixProvider";
import { validatePixConfig } from "@/lib/payments/pix-config";
import { createClient } from "@/lib/supabase/server";
import {
  CHARGE_KIND_LABELS,
  CHARGE_STATUS_LABELS,
  type ChargeKind,
  type ChargeStatus,
} from "@/lib/validation/charge";

import { ClubPixCard } from "./club-pix-card";

/**
 * Página "Meu extrato" (Server Component — qualquer membro ativo do futebol).
 *
 * Mostra APENAS as cobranças e pagamentos do próprio jogador NO FUTEBOL ATIVO
 * (Requisito 14.9). A leitura usa o cliente ligado à sessão do usuário; a
 * policy RLS do jogador (seção 17) é a GUARDA AUTORITATIVA: um `jogador` só
 * enxerga as linhas onde `player_id = my_player_id(club_id)`, nunca as de
 * terceiros nem as de outro futebol. O filtro por `club_id` + `player_id`
 * abaixo é defesa em profundidade/clareza — a segurança não depende do front.
 *
 * MULTI-TENANT (tarefa 21.8): o `player_id` do próprio usuário é resolvido POR
 * CLUBE via `getMembershipSession().playerId` (equivalente a
 * `my_player_id(club_id)`); o mesmo usuário pode ter players diferentes em
 * clubes diferentes. A leitura das cobranças filtra por `club_id` do clube
 * ativo E pelo `player_id` daquele clube — NUNCA cruzando futebóis.
 *
 * Casos tratados:
 *  - Sem futebol ativo (estado "sem futebol") → onboarding `/sem-futebol`.
 *  - Membro com `playerId` vinculado no clube ativo: lista suas cobranças (não
 *    excluídas), mais recentes por vencimento, com tipo, descrição, valor
 *    (BRL), vencimento, selo de status, indicador derivado de "Atrasada"
 *    (vencimento no passado E status `pendente` — Req 5.5, nunca armazenado) e
 *    a data de pagamento quando `paga`. Cobranças pagáveis
 *    (`pendente`/`em_analise`) oferecem o link para a tela de pagamento.
 *  - Usuário sem `playerId` no clube ativo (ex.: presidente/tesoureiro sem
 *    jogador vinculado): mensagem informativa de que não há jogador vinculado
 *    neste futebol, portanto não há extrato pessoal — sem erro. Gestores usam
 *    primariamente `/cobrancas`.
 *
 * Requisitos: 14.9 (extrato só do próprio jogador, por clube).
 */

/** Linha de cobrança exibida no extrato do jogador. */
interface ExtratoChargeRow {
  id: string;
  amount_cents: number;
  description: string;
  kind: ChargeKind;
  period: string | null;
  due_date: string;
  status: ChargeStatus;
  paid_at: string | null;
}

/** Status que ainda permitem pagar (ou reexibir o comprovante em análise). */
const PAYABLE_STATUSES = new Set<ChargeStatus>(["pendente", "em_analise"]);

/**
 * Carrega as cobranças do próprio jogador NO FUTEBOL ATIVO. A RLS garante o
 * escopo (Req 14.9); os filtros `.eq("club_id", clubId)` e `.eq("player_id",
 * playerId)` reforçam a intenção no servidor e impedem cruzar futebóis.
 */
async function loadOwnCharges(
  clubId: string,
  playerId: string,
): Promise<ExtratoChargeRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("charges")
    .select(
      "id, amount_cents, description, kind, period, due_date, status, paid_at",
    )
    .eq("club_id", clubId)
    .eq("player_id", playerId)
    .is("deleted_at", null)
    .order("due_date", { ascending: false })
    .order("created_at", { ascending: false })
    .returns<ExtratoChargeRow[]>();

  if (error || !data) return [];
  return data;
}

/** Settings de Pix + mensalidade padrão do clube, usadas no card de Pix. */
interface ClubPixSettingsRow {
  pix_key: string | null;
  pix_receiver_name: string | null;
  pix_city: string | null;
  default_monthly_cents: number | null;
}

/**
 * Carrega os dados de Pix e o valor da mensalidade padrão do CLUBE ATIVO
 * (`settings`, uma linha por clube). Usado para montar o Pix "copia e cola" da
 * mensalidade no painel do jogador. A RLS por tenant garante que o jogador só
 * lê a settings do próprio futebol; o filtro por `club_id` é defesa em
 * profundidade.
 */
async function loadClubPixSettings(
  clubId: string,
): Promise<ClubPixSettingsRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("settings")
    .select("pix_key, pix_receiver_name, pix_city, default_monthly_cents")
    .eq("club_id", clubId)
    .maybeSingle<ClubPixSettingsRow>();

  if (error || !data) return null;
  return data;
}

/**
 * Monta o payload Pix estático da MENSALIDADE do futebol (valor configurado
 * pelo presidente em `settings.default_monthly_cents`). Retorna `null` quando o
 * Pix não está configurado ou a mensalidade é zero — nesses casos o card não é
 * exibido. O `txid` é fixo (`MENSALIDADE`) por não haver cobrança específica.
 */
async function buildClubMonthlyPix(
  clubId: string,
): Promise<{ payload: string; monthlyCents: number } | null> {
  const settings = await loadClubPixSettings(clubId);
  if (!settings) return null;

  const monthlyCents = settings.default_monthly_cents ?? 0;
  if (monthlyCents <= 0) return null;

  const pixResult = validatePixConfig(settings);
  if (!pixResult.ok) return null;

  const provider = createPixProvider(pixResult.config);
  const { payload } = provider.createStaticCharge({
    amountCents: monthlyCents,
    txid: "MENSALIDADE",
    description: "Mensalidade",
  });

  return { payload, monthlyCents };
}

/** Classe do selo de status (mesmas cores da tela de Cobranças). */
function statusBadgeClass(status: ChargeStatus): string {
  switch (status) {
    case "paga":
      return "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200";
    case "em_analise":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200";
    case "cancelada":
      return "bg-muted text-muted-foreground";
    case "pendente":
    default:
      return "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200";
  }
}

export default async function MeuExtratoPage() {
  const session = await getMembershipSession();

  // Sem sessão → login (defesa em profundidade junto ao middleware/layout).
  if (!session) {
    redirect("/login");
  }

  // Sem futebol ativo → onboarding (ponto de entrada do seletor de futebol).
  if (session.hasNoClub || !session.activeClub) {
    redirect("/sem-futebol");
  }

  const clubId = session.activeClub.clubId;
  const playerId = session.playerId;

  // Sem jogador vinculado NO CLUBE ATIVO (ex.: presidente/tesoureiro sem
  // player): sem extrato pessoal neste futebol, mas também sem erro.
  if (!playerId) {
    return (
      <div className="container max-w-2xl py-8">
        <h1 className="text-2xl font-bold">Meu extrato</h1>
        <div className="mt-6 flex items-start gap-3 rounded-md border border-dashed p-6 text-muted-foreground">
          <Info className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium text-foreground">
              Nenhum jogador vinculado à sua conta neste futebol.
            </p>
            <p className="text-sm">
              Seu usuário não está associado a um jogador em{" "}
              <span className="font-medium text-foreground">
                {session.activeClub.clubName}
              </span>
              , então não há extrato pessoal para exibir. A gestão de cobranças
              fica em{" "}
              <Link
                href="/cobrancas"
                className="underline hover:text-foreground"
              >
                Cobranças
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    );
  }

  const charges = await loadOwnCharges(clubId, playerId);
  const clubPix = await buildClubMonthlyPix(clubId);
  const today = todayISO();

  // Resumo: total pendente/em atraso ainda devido (não conta pagas/canceladas).
  const owedCents = charges
    .filter((c) => c.status === "pendente" || c.status === "em_analise")
    .reduce((sum, c) => sum + c.amount_cents, 0);
  const overdueCount = charges.filter(
    (c) => c.status === "pendente" && c.due_date < today,
  ).length;

  return (
    <div className="container max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Meu extrato</h1>
        <p className="mt-1 text-muted-foreground">
          Suas cobranças e pagamentos. Apenas você vê este extrato.
        </p>
      </div>

      {clubPix ? (
        <ClubPixCard
          payload={clubPix.payload}
          monthlyCents={clubPix.monthlyCents}
          clubName={session.activeClub.clubName}
        />
      ) : null}

      {charges.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-muted-foreground">
          Você ainda não tem cobranças. Quando houver, elas aparecem aqui.
        </div>
      ) : (
        <>
          {owedCents > 0 ? (
            <div className="mb-4 rounded-md border bg-card p-4">
              <p className="text-sm text-muted-foreground">Total em aberto</p>
              <p className="text-xl font-semibold tabular-nums">
                {fromCents(owedCents)}
              </p>
              {overdueCount > 0 ? (
                <p className="mt-1 text-sm font-medium text-destructive">
                  {overdueCount === 1
                    ? "1 cobrança atrasada"
                    : `${overdueCount} cobranças atrasadas`}
                </p>
              ) : null}
            </div>
          ) : null}

          <ul className="space-y-2">
            {charges.map((c) => {
              const isOverdue = c.status === "pendente" && c.due_date < today;
              const isPayable = PAYABLE_STATUSES.has(c.status);

              return (
                <li
                  key={c.id}
                  className="flex items-start gap-3 rounded-md border bg-card p-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate font-medium">
                        {CHARGE_KIND_LABELS[c.kind]}
                      </p>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {fromCents(c.amount_cents)}
                      </span>
                    </div>
                    {c.description ? (
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">
                        {c.description}
                      </p>
                    ) : null}
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span
                        className={`rounded-full px-2 py-0.5 font-medium ${statusBadgeClass(
                          c.status,
                        )}`}
                      >
                        {CHARGE_STATUS_LABELS[c.status]}
                      </span>
                      {isOverdue && (
                        <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive">
                          Atrasada
                        </span>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>Vence {formatDate(c.due_date)}</span>
                      {c.period ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Ref. {c.period}</span>
                        </>
                      ) : null}
                      {c.status === "paga" && c.paid_at ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Paga em {formatDate(c.paid_at)}</span>
                        </>
                      ) : null}
                    </p>
                    {isPayable ? (
                      <div className="mt-3">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/meu-extrato/${c.id}/pagar`}>
                            <CreditCard aria-hidden="true" />
                            {c.status === "em_analise"
                              ? "Ver pagamento"
                              : "Pagar"}
                          </Link>
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
