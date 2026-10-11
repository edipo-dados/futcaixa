"use client";

import { useState } from "react";
import { Paperclip } from "lucide-react";

import { getExpenseProofUrl } from "./actions";

/**
 * Botão de visualização do comprovante de uma despesa de transparência
 * (tarefa 11.5 — Req 8.7).
 *
 * Segue o mesmo padrão do `lancamentos/proof-link.tsx`: o comprovante vive em
 * um bucket privado e a leitura acontece por URL assinada de curta duração
 * gerada no servidor (`getExpenseProofUrl`). A diferença é que esta action
 * assina com a service role após validar que o caminho pertence a uma despesa
 * de transparência — permitindo que QUALQUER membro autenticado veja o
 * comprovante (não só o dono/gestor). Nenhuma URL pública é usada.
 */
export function ExpenseProofLink({ path }: { path: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openProof() {
    setLoading(true);
    setError(null);
    const result = await getExpenseProofUrl(path);
    setLoading(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  return (
    <span className="inline-flex items-center">
      <button
        type="button"
        onClick={openProof}
        disabled={loading}
        className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      >
        <Paperclip className="size-3.5" aria-hidden="true" />
        {loading ? "Abrindo..." : "Ver comprovante"}
      </button>
      {error && <span className="ml-2 text-xs text-destructive">{error}</span>}
    </span>
  );
}
