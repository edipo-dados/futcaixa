"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { type SolicitarPresidenciaState } from "@/lib/validation/president";

import { solicitarPresidencia } from "./actions";

const initialState: SolicitarPresidenciaState = { status: "idle" };

/**
 * Formulário (um único botão) para solicitar o papel de presidente.
 *
 * Em sucesso, a Server Action revalida `/sem-futebol`, de modo que o Server
 * Component pai re-renderiza já no estado `pendente` ("aguardando aprovação").
 * Mantemos a mensagem de erro inline para o caso raro de falha.
 */
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Enviando solicitação..." : "Solicitar ser presidente"}
    </Button>
  );
}

export function SolicitarPresidenteForm() {
  const [state, formAction] = useActionState(solicitarPresidencia, initialState);

  return (
    <form action={formAction} className="space-y-3">
      {state.status === "error" && state.message ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
