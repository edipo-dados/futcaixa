import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatPeriodLabel, shiftPeriod } from "@/lib/date";

/**
 * Seletor de mês do dashboard (Server Component).
 *
 * Navega por `?mes=YYYY-MM` com links anterior/próximo — sem estado no cliente,
 * para funcionar com os loaders server-side que já recebem o período. O botão
 * "próximo" é desabilitado quando o mês selecionado é o atual (não faz sentido
 * navegar para o futuro, onde não há dados).
 */
export function MonthPicker({
  period,
  currentPeriodValue,
}: {
  /** Período selecionado (YYYY-MM). */
  period: string;
  /** Período atual (YYYY-MM) — limite superior da navegação. */
  currentPeriodValue: string;
}) {
  const prev = shiftPeriod(period, -1);
  const next = shiftPeriod(period, 1);
  const atCurrent = period >= currentPeriodValue;

  return (
    <div className="flex items-center gap-2">
      <Button
        asChild
        variant="outline"
        size="icon"
        aria-label="Mês anterior"
      >
        <Link href={`/dashboard?mes=${prev}`}>
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Link>
      </Button>

      <span className="min-w-40 text-center text-sm font-medium capitalize">
        {formatPeriodLabel(period)}
      </span>

      {atCurrent ? (
        <Button
          variant="outline"
          size="icon"
          disabled
          aria-label="Próximo mês (indisponível)"
          aria-disabled="true"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
      ) : (
        <Button asChild variant="outline" size="icon" aria-label="Próximo mês">
          <Link href={`/dashboard?mes=${next}`}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      )}
    </div>
  );
}
