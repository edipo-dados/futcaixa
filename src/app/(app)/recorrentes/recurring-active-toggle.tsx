"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Power, PowerOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { RecurringToggleActionState } from "@/lib/validation/recurring";

import { setRecurringActive } from "./actions";

/**
 * Botão de ativar/desativar despesa recorrente (Req 4.4).
 *
 * Usa um `<form>` + Server Action (`setRecurringActive`). O status atual
 * determina a ação enviada: uma despesa ativa recebe o botão "Desativar"
 * (envia `isActive=false`) e vice-versa. Mobile-first: botão compacto, com
 * rótulo textual ao lado do ícone.
 *
 * Desativar NÃO apaga os lançamentos já gerados — apenas interrompe a geração
 * de novos lançamentos pelo cron.
 */

const initialState: RecurringToggleActionState = { status: "idle" };

interface RecurringActiveToggleProps {
  recurringId: string;
  isActive: boolean;
}

function ToggleButton({ isActive }: { isActive: boolean }) {
  const { pending } = useFormStatus();
  const willDeactivate = isActive;
  const label = willDeactivate ? "Desativar" : "Reativar";

  return (
    <Button
      type="submit"
      size="sm"
      variant={willDeactivate ? "outline" : "default"}
      disabled={pending}
      aria-label={`${label} despesa recorrente`}
    >
      {willDeactivate ? (
        <PowerOff className="size-4" aria-hidden="true" />
      ) : (
        <Power className="size-4" aria-hidden="true" />
      )}
      {pending ? "Salvando..." : label}
    </Button>
  );
}

export function RecurringActiveToggle({
  recurringId,
  isActive,
}: RecurringActiveToggleProps) {
  const [, formAction] = useActionState(setRecurringActive, initialState);
  const nextActive = isActive ? "false" : "true";

  return (
    <form action={formAction} className="shrink-0">
      <input type="hidden" name="id" value={recurringId} />
      <input type="hidden" name="isActive" value={nextActive} />
      <ToggleButton isActive={isActive} />
    </form>
  );
}
