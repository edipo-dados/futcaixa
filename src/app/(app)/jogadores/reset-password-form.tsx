"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Copy, KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import {
  resetPlayerPassword,
  type ResetPasswordState,
} from "./reset-password-actions";

/**
 * Reset de senha de um jogador (Client Component, padrão inline sem Dialog).
 *
 * Seguindo o padrão de `category-row.tsx`/`player-status-toggle.tsx`, a
 * confirmação é revelada por estado (`useState`) e o envio usa `useActionState`
 * + `useFormStatus`. Sem conta vinculada, a ação fica desabilitada. No sucesso,
 * a senha temporária é mostrada UMA vez (ela só existe no estado da action, não
 * é persistida) com um botão para copiar.
 *
 * Mobile-first e acessível (`aria-*`, `role='alert'` para erros).
 */

const initialState: ResetPasswordState = { status: "idle" };

interface ResetPasswordFormProps {
  playerId: string;
  hasAccount: boolean;
}

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="destructive" disabled={pending}>
      {pending ? "Resetando..." : "Confirmar reset"}
    </Button>
  );
}

export function ResetPasswordForm({
  playerId,
  hasAccount,
}: ResetPasswordFormProps) {
  const [state, formAction] = useActionState(resetPlayerPassword, initialState);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Sem conta vinculada: ação indisponível.
  if (!hasAccount) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled
        title="Sem conta vinculada"
        aria-label="Resetar senha (sem conta vinculada)"
        className="shrink-0"
      >
        <KeyRound className="size-4" aria-hidden="true" />
        Resetar senha
      </Button>
    );
  }

  // Sucesso: mostra a senha temporária UMA vez.
  if (state.status === "success" && state.tempPassword) {
    const tempPassword = state.tempPassword;
    return (
      <Card className="w-full">
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Senha temporária gerada</p>
            <p className="text-xs text-muted-foreground">
              Repasse ao jogador. Ela será exibida apenas uma vez e não ficará
              salva aqui.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <code
              className="flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-sm"
              aria-label="Senha temporária"
            >
              {tempPassword}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard
                  .writeText(tempPassword)
                  .then(() => setCopied(true));
              }}
              aria-label="Copiar senha temporária"
            >
              <Copy className="size-4" aria-hidden="true" />
              {copied ? "Copiada" : "Copiar"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Fechado: botão que revela a confirmação.
  if (!open) {
    return (
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setOpen(true)}
          aria-label="Resetar senha"
        >
          <KeyRound className="size-4" aria-hidden="true" />
          Resetar senha
        </Button>
        {state.status === "error" && state.message ? (
          <p role="alert" className="text-xs text-destructive">
            {state.message}
          </p>
        ) : null}
      </div>
    );
  }

  // Aberto: formulário de confirmação inline.
  return (
    <form action={formAction} className="flex shrink-0 flex-col items-end gap-2">
      <input type="hidden" name="playerId" value={playerId} />
      <p className="text-xs text-muted-foreground">
        Isto gera uma nova senha temporária para o jogador. A atual deixa de
        funcionar.
      </p>
      <div className="flex items-center gap-2">
        <ConfirmButton />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          Cancelar
        </Button>
      </div>
      {state.status === "error" && state.message ? (
        <p role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
