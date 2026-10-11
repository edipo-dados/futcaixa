"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

import {
  aprovarPresidente,
  recusarPresidente,
  type RevisaoPresidenteState,
} from "./actions";

const initialState: RevisaoPresidenteState = { status: "idle" };

/**
 * Botões de revisão de uma solicitação de presidência (tarefa 19.2).
 *
 * Seguem o padrão de `(onboarding)/sem-futebol/solicitar-presidente-form.tsx`:
 * dois formulários minúsculos (useFormState/useFormStatus), cada um com um
 * `userId` oculto. Em sucesso a Server Action revalida `/admin/solicitacoes`,
 * então o Server Component pai re-renderiza a lista já sem a linha aprovada/
 * recusada; o erro raro aparece inline.
 */

/** Botão de submit que reflete o estado "pending" do seu próprio formulário. */
function SubmitButton({
  label,
  pendingLabel,
  variant,
}: {
  label: string;
  pendingLabel: string;
  variant?: "default" | "outline";
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant={variant}
      disabled={pending}
      aria-disabled={pending}
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function RevisarPresidenteForm({ userId }: { userId: string }) {
  const [aprovarState, aprovarAction] = useActionState(
    aprovarPresidente,
    initialState,
  );
  const [recusarState, recusarAction] = useActionState(
    recusarPresidente,
    initialState,
  );

  const errorMessage =
    aprovarState.status === "error"
      ? aprovarState.message
      : recusarState.status === "error"
        ? recusarState.message
        : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={aprovarAction}>
          <input type="hidden" name="userId" value={userId} />
          <SubmitButton label="Aprovar" pendingLabel="Aprovando..." />
        </form>
        <form action={recusarAction}>
          <input type="hidden" name="userId" value={userId} />
          <SubmitButton
            label="Recusar"
            pendingLabel="Recusando..."
            variant="outline"
          />
        </form>
      </div>
      {errorMessage ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
