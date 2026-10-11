"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, ExternalLink, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  REJECT_REASON_MAX,
  type ProofReviewActionState,
} from "@/lib/validation/proof-review";

import { approveProof, getProofSignedUrl, rejectProof } from "./actions";

/**
 * Ações de revisão de um comprovante (tarefa 9.6, Req 6.6/6.7).
 *
 * Oferece três ações ao gestor:
 *  - "Ver comprovante": busca uma URL assinada de curta duração (Server Action
 *    `getProofSignedUrl`) e abre o arquivo numa nova aba (bucket privado).
 *  - "Aprovar": confirma, chama `approveProof` (paga + receita — Req 6.6).
 *  - "Rejeitar": revela um campo de motivo (obrigatório) e chama `rejectProof`
 *    (volta a cobrança para pendente, registra o motivo — Req 6.7).
 *
 * Mobile-first: botões empilham em telas pequenas; textos em pt-BR.
 */

const initialState: ProofReviewActionState = { status: "idle" };

function ApproveButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      disabled={pending}
      aria-label="Aprovar comprovante"
      onClick={(e) => {
        if (
          !confirm(
            "Aprovar este comprovante? A cobrança será marcada como paga e a receita lançada.",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <CheckCircle2 className="size-4" aria-hidden="true" />
      {pending ? "Aprovando..." : "Aprovar"}
    </Button>
  );
}

function RejectSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant="destructive"
      disabled={pending}
      aria-label="Confirmar rejeição do comprovante"
    >
      <XCircle className="size-4" aria-hidden="true" />
      {pending ? "Rejeitando..." : "Confirmar rejeição"}
    </Button>
  );
}

function ViewProofButton({ filePath }: { filePath: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleView() {
    setLoading(true);
    setError(null);
    const result = await getProofSignedUrl(filePath);
    setLoading(false);
    if ("url" in result) {
      window.open(result.url, "_blank", "noopener,noreferrer");
    } else {
      setError(result.error);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={handleView}
        disabled={loading}
        aria-label="Ver comprovante"
      >
        <ExternalLink className="size-4" aria-hidden="true" />
        {loading ? "Abrindo..." : "Ver comprovante"}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function ProofReviewActions({
  proofId,
  filePath,
}: {
  proofId: string;
  filePath: string;
}) {
  const [approveState, approveAction] = useActionState(approveProof, initialState);
  const [rejectState, rejectAction] = useActionState(rejectProof, initialState);
  const [showReject, setShowReject] = useState(false);

  const errorMessage =
    (approveState.status === "error" ? approveState.message : undefined) ??
    (rejectState.status === "error" ? rejectState.message : undefined);

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <ViewProofButton filePath={filePath} />

        <form action={approveAction}>
          <input type="hidden" name="proofId" value={proofId} />
          <ApproveButton />
        </form>

        <Button
          type="button"
          size="sm"
          variant="outline"
          className="text-destructive hover:text-destructive"
          aria-expanded={showReject}
          onClick={() => setShowReject((v) => !v)}
        >
          <XCircle className="size-4" aria-hidden="true" />
          Rejeitar
        </Button>
      </div>

      {showReject ? (
        <form action={rejectAction} className="flex flex-col gap-2">
          <input type="hidden" name="proofId" value={proofId} />
          <label htmlFor={`reason-${proofId}`} className="text-sm font-medium">
            Motivo da rejeição
          </label>
          <textarea
            id={`reason-${proofId}`}
            name="reason"
            required
            maxLength={REJECT_REASON_MAX}
            rows={3}
            placeholder="Ex.: valor do comprovante diferente da cobrança."
            className={cn(
              "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            )}
          />
          <div className="flex flex-wrap gap-2">
            <RejectSubmitButton />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setShowReject(false)}
            >
              Cancelar
            </Button>
          </div>
        </form>
      ) : null}

      {errorMessage ? (
        <p role="alert" className="text-xs text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
