import { PlayerFlowChart } from "@/components/charts/PlayerFlowChart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDate, formatPeriodLabel } from "@/lib/date";
import type {
  PlayerExitReason,
  PlayerFlow,
  PlayerFlowEntryItem,
} from "@/lib/dashboard/player-flow";

interface PlayerFlowSectionProps {
  /** `null` quando o carregamento falhou. */
  flow: PlayerFlow | null;
}

const REASON_LABEL: Record<PlayerExitReason, string> = {
  inativado: "Inativado",
  excluido: "Excluído",
};

const SUMMARY_ID = "player-flow-summary";

/** "1 entrada" / "2 entradas". */
function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** Nome com apelido entre parênteses, quando houver. */
function displayName(item: PlayerFlowEntryItem): string {
  return item.nickname ? `${item.name} (${item.nickname})` : item.name;
}

/**
 * Seção "Entradas e saídas de jogadores" do dashboard (Server Component).
 *
 * Visível SOMENTE para presidente e tesoureiro do clube ativo — a página
 * decide no servidor e nem busca os dados para `jogador`. Mostra o gráfico
 * mensal (desde Outubro de 2026) e, para o mês selecionado no filtro, quem
 * entrou e quem saiu (com motivo e marcação de data aproximada). As listas são
 * legíveis sem o gráfico; o gráfico tem resumo textual acessível.
 */
export function PlayerFlowSection({ flow }: PlayerFlowSectionProps) {
  return (
    <section className="mt-6" aria-labelledby="player-flow-title">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle id="player-flow-title" className="text-base">
            Entradas e saídas de jogadores
          </CardTitle>
          <CardDescription>
            Desde {formatPeriodLabel(flow?.startPeriod ?? "2026-10")} · visível
            só para presidente e tesoureiro.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {flow === null ? (
            <p className="text-sm text-muted-foreground">
              Não foi possível carregar as movimentações.
            </p>
          ) : (
            <PlayerFlowContent flow={flow} />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function PlayerFlowContent({ flow }: { flow: PlayerFlow }) {
  const monthLabel = formatPeriodLabel(flow.selectedPeriod);
  const summary =
    flow.series.length === 0
      ? "Sem meses no histórico."
      : flow.series
          .map(
            (p) =>
              `${formatPeriodLabel(p.month)}: ${plural(p.entries, "entrada", "entradas")}, ${plural(p.exits, "saída", "saídas")}`,
          )
          .join("; ") + ".";
  const hasApproximate = flow.exits.some((e) => e.approximate);

  return (
    <>
      <figure aria-labelledby="player-flow-title" aria-describedby={SUMMARY_ID}>
        <PlayerFlowChart data={flow.series} describedById={SUMMARY_ID} />
        <figcaption id={SUMMARY_ID} className="sr-only">
          {summary}
        </figcaption>
      </figure>

      {flow.selectedBeforeStart ? (
        <p className="text-sm text-muted-foreground">
          Histórico disponível a partir de {formatPeriodLabel(flow.startPeriod)}
          .
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">
              Entraram em {monthLabel} ({flow.entries.length})
            </h3>
            {flow.entries.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Nenhuma entrada neste mês.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {flow.entries.map((item) => (
                  <li
                    key={item.playerId}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 py-2"
                  >
                    <span className="text-sm font-medium text-green-700 dark:text-green-300">
                      {displayName(item)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(item.date)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold">
              Saíram em {monthLabel} ({flow.exits.length})
            </h3>
            {flow.exits.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Nenhuma saída neste mês.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {flow.exits.map((item) => (
                  <li
                    key={item.playerId}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-sm font-medium text-red-700 dark:text-red-300">
                        {displayName(item)}
                      </span>
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs">
                        {REASON_LABEL[item.reason]}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(item.date)}
                      {item.approximate && " (data aproximada)"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {hasApproximate && !flow.selectedBeforeStart && (
        <p className="text-xs text-muted-foreground">
          Data aproximada: inativações anteriores ao registro automático usam a
          última atualização do cadastro.
        </p>
      )}
    </>
  );
}
