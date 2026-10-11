"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Ban, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ChargeStatusActionState } from "@/lib/validation/charge";

import { cancelCharge, markChargePaid } from "./actions";

/**
 * Ações por linha da lista de cobranças (tarefa 8.3).
 *
 * Exibe os botões de transição de status conforme o estado atual:
 *  - "Marcar paga" e "Cancelar" para cobranças `pendente`/`em_analise`.
 *  - Nada para `paga`/`cancelada` (estados terminais nesta tela).
 *
 * Cada botão é um `<form>` + Server Action (`markChargePaid` / `cancelCharge`),
 * mantendo a autorização e os triggers de auditoria no servidor. O cancelamento
 * pede confirmação (ação não otimista). Mensagens de erro da Server Action são
 * exibidas inline abaixo dos botões.
 */

const initialState: ChargeStatusActionState = { status: "idle" };

function PayButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      disabled={pending}
      aria-label="Marcar cobrança como paga"
    >
      <CheckCircle2 className="size-4" aria-hidden="true" />
      {pending ? "Marcando..." : "Marcar paga"}
    </Button>
  );
}

function CancelButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant="outline"
      disabled={pending}
      aria-label="Cancelar cobrança"
      className="text-destructive hover:text-destructive"
      onClick={(e) => {
        if (!confirm("Cancelar esta cobrança? A ação ficará registrada.")) {
          e.preventDefault();
        }
      }}
    >
      <Ban className="size-4" aria-hidden="true" />
      {pending ? "Cancelando..." : "Cancelar"}
    </Button>
  );
}

export function ChargeRowActions({ chargeId }: { chargeId: string }) {
  const [payState, payAction] = useActionState(markChargePaid, initialState);
  const [cancelState, cancelAction] = useActionState(cancelCharge, initialState);

  const errorMessage =
    (payState.status === "error" ? payState.message : undefined) ??
    (cancelState.status === "error" ? cancelState.message : undefined);

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <form action={payAction}>
          <input type="hidden" name="chargeId" value={chargeId} />
          <PayButton />
        </form>
        <form action={cancelAction}>
          <input type="hidden" name="chargeId" value={chargeId} />
          <CancelButton />
        </form>
      </div>
      {errorMessage ? (
        <p role="alert" className="text-xs text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
