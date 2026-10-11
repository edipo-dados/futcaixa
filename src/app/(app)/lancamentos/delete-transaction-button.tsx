"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { TransactionDeleteActionState } from "@/lib/validation/transaction";

import { softDeleteTransaction } from "./actions";

/**
 * Botão de exclusão de lançamento (soft delete — Req 3.8).
 *
 * Usa um `<form>` + Server Action (`softDeleteTransaction`), que marca
 * `deleted_at` em vez de remover a linha. Pede confirmação antes de enviar,
 * já que a exclusão não é feita de forma otimista.
 */

const initialState: TransactionDeleteActionState = { status: "idle" };

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant="outline"
      disabled={pending}
      aria-label="Excluir lançamento"
      className="text-destructive hover:text-destructive"
      onClick={(e) => {
        if (
          !confirm("Excluir este lançamento? Ele deixará de ser contabilizado.")
        ) {
          e.preventDefault();
        }
      }}
    >
      <Trash2 className="size-4" aria-hidden="true" />
      {pending ? "Excluindo..." : "Excluir"}
    </Button>
  );
}

export function DeleteTransactionButton({
  transactionId,
}: {
  transactionId: string;
}) {
  const [, formAction] = useActionState(softDeleteTransaction, initialState);
  return (
    <form action={formAction} className="shrink-0">
      <input type="hidden" name="id" value={transactionId} />
      <DeleteButton />
    </form>
  );
}
