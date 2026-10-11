"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PROOF_ACCEPT_ATTR,
  type ProofSubmitActionState,
  validateProofFile,
} from "@/lib/validation/proof";

import { submitProof } from "./actions";

/**
 * Seção de envio de comprovante (Client Component — tarefa 9.5, Req 6.5).
 *
 * Mobile-first: um input de arquivo (aceita imagem ou PDF) e um botão de envio
 * ligados à Server Action `submitProof`. A validação de tipo/tamanho acontece
 * no cliente (feedback imediato) e, de forma autoritativa, na Server Action.
 *
 * Após o envio bem-sucedido, a cobrança fica `em_analise` (a página é
 * revalidada e passa a refletir o novo status) e exibimos a confirmação
 * "Comprovante enviado. Aguardando análise.".
 */

interface ProofUploadProps {
  /** Id da cobrança que receberá o comprovante. */
  chargeId: string;
}

const initialState: ProofSubmitActionState = { status: "idle" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      <Upload className="size-4" aria-hidden="true" />
      {pending ? "Enviando..." : "Enviar comprovante"}
    </Button>
  );
}

export function ProofUpload({ chargeId }: ProofUploadProps) {
  const [state, formAction] = useActionState(submitProof, initialState);

  // Erro de validação do lado do cliente (feedback imediato antes do envio).
  const [clientError, setClientError] = useState<string | null>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setClientError(null);
      return;
    }
    const result = validateProofFile(file);
    setClientError(result.ok ? null : result.error);
  }

  if (state.status === "success") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-green-700 dark:text-green-300">
            <CheckCircle2 className="size-5" aria-hidden="true" />
            Comprovante enviado
          </CardTitle>
          <CardDescription>{state.message}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Assim que o tesoureiro analisar o comprovante, o status da sua
          cobrança será atualizado.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="size-5" aria-hidden="true" />
          Enviar comprovante
        </CardTitle>
        <CardDescription>
          Depois de pagar, anexe o comprovante (imagem ou PDF) para o tesoureiro
          analisar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="chargeId" value={chargeId} />

          <div className="space-y-2">
            <Label htmlFor="proof">Arquivo do comprovante</Label>
            <Input
              id="proof"
              name="proof"
              type="file"
              accept={PROOF_ACCEPT_ATTR}
              onChange={handleFileChange}
              aria-invalid={!!clientError || undefined}
              aria-describedby="proof-hint"
            />
            <p id="proof-hint" className="text-xs text-muted-foreground">
              Formatos aceitos: JPG, PNG, WebP ou PDF. Tamanho máximo: 5 MB.
            </p>
            {clientError && (
              <p className="text-sm text-destructive" role="alert">
                {clientError}
              </p>
            )}
          </div>

          {/* Erro vindo da Server Action (ex.: falha de upload/validação). */}
          {state.status === "error" && state.message && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {state.message}
            </div>
          )}

          <SubmitButton />
        </form>
      </CardContent>
    </Card>
  );
}
