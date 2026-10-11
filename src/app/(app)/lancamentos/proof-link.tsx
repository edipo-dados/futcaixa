"use client";

import { useState } from "react";
import { Paperclip } from "lucide-react";

import { getProofUrl } from "./actions";

/**
 * Link de visualização do comprovante de um lançamento (Req 3.7).
 *
 * O comprovante vive em um bucket privado; a leitura acontece por URL assinada
 * de curta duração gerada no servidor (`getProofUrl`). Ao clicar, o componente
 * solicita a URL e abre o arquivo em uma nova aba. Nenhuma URL pública é usada.
 */
export function ProofLink({ path }: { path: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openProof() {
    setLoading(true);
    setError(null);
    const result = await getProofUrl(path);
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
        {loading ? "Abrindo..." : "Comprovante"}
      </button>
      {error && <span className="ml-2 text-xs text-destructive">{error}</span>}
    </span>
  );
}
