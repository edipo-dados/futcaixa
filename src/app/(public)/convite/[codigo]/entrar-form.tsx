"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { type JoinClubState } from "@/lib/validation/invite";

import { entrarNoFutebol } from "./actions";

const initialState: JoinClubState = { status: "idle" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Entrando..." : "Entrar neste futebol"}
    </Button>
  );
}

/**
 * Botão "Entrar neste futebol" para o usuário AUTENTICADO (tarefa 20.2).
 *
 * Envia o `clubId` resolvido do convite para a Server Action `entrarNoFutebol`.
 * Após o envio:
 *   - `pending` → mostra o aviso "aguardando aprovação do presidente" (Req 4.4)
 *     e esconde o botão (o pedido já foi registrado);
 *   - `error`   → mostra a mensagem e mantém o botão para nova tentativa.
 *
 * O estado inicial da membership pode já ser `pendente` (o usuário reabriu o
 * convite): nesse caso o componente recebe `initialPending` e já renderiza o
 * aviso sem exigir um clique.
 */
export function EntrarForm({
  clubId,
  initialPending,
}: {
  clubId: string;
  initialPending: boolean;
}) {
  const [state, formAction] = useActionState(entrarNoFutebol, initialState);

  const showPending = initialPending || state.status === "pending";

  if (showPending) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
        <Clock
          className="mt-0.5 size-4 shrink-0 text-primary"
          aria-hidden="true"
        />
        <p>
          Seu pedido foi registrado. Aguardando a aprovação do presidente para
          liberar o acesso ao futebol.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="clubId" value={clubId} />
      {state.status === "error" && state.message ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
