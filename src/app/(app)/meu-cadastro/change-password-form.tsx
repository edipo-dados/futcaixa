"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type ChangePasswordState } from "@/lib/validation/account";

import { changeOwnPassword } from "./actions";

/**
 * Formulário de troca de senha (Client Component) da aba "Meu cadastro".
 *
 * Qualquer usuário logado pode definir uma nova senha para si — útil para quem
 * recebeu uma senha temporária do presidente e quer trocá-la. A validação é
 * feita no servidor (`changeOwnPassword` + `changePasswordSchema`); aqui só
 * refletimos os erros por campo e o estado de envio. Mobile-first e acessível
 * (aria-*, mensagens em pt-BR).
 */

const initialState: ChangePasswordState = { status: "idle" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Salvando..." : "Trocar senha"}
    </Button>
  );
}

export function ChangePasswordForm() {
  const [state, formAction] = useActionState(changeOwnPassword, initialState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {/* Mensagem de sucesso. */}
      {state.status === "success" && state.message ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm"
        >
          <CheckCircle2
            className="mt-0.5 size-4 shrink-0 text-primary"
            aria-hidden="true"
          />
          <p>{state.message}</p>
        </div>
      ) : null}

      {/* Mensagem de erro geral (falha ao trocar a senha). */}
      {state.status === "error" && state.message ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="password">Nova senha</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="Mínimo de 6 caracteres"
          required
          aria-invalid={Boolean(state.fieldErrors?.password) || undefined}
          aria-describedby={
            state.fieldErrors?.password ? "password-error" : undefined
          }
        />
        {state.fieldErrors?.password ? (
          <p id="password-error" className="text-sm text-destructive">
            {state.fieldErrors.password}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm">Confirmar nova senha</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          placeholder="Repita a nova senha"
          required
          aria-invalid={Boolean(state.fieldErrors?.confirm) || undefined}
          aria-describedby={
            state.fieldErrors?.confirm ? "confirm-error" : undefined
          }
        />
        {state.fieldErrors?.confirm ? (
          <p id="confirm-error" className="text-sm text-destructive">
            {state.fieldErrors.confirm}
          </p>
        ) : null}
      </div>

      <SubmitButton />
    </form>
  );
}
