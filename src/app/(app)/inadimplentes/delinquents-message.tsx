"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { DelinquentRow } from "@/lib/delinquency";
import { buildDelinquencyMessage, waMeUrl } from "@/lib/whatsapp";

/**
 * Ações de cobrança por WhatsApp (Client Component — tarefa 10.2).
 *
 * Recebe as linhas agregadas de inadimplentes (serializáveis) junto com o nome
 * do clube, a chave Pix e o link do sistema. Monta a mensagem no cliente, com
 * o builder puro `buildDelinquencyMessage`, e oferece:
 *  - "Copiar mensagem" → copia o texto para a área de transferência (Req 7.2);
 *  - "Compartilhar no WhatsApp" → abre `wa.me` com o texto pré-preenchido,
 *    sem usar nenhuma API do WhatsApp (Req 7.3);
 *  - um toggle "Ocultar valores individuais" (Req 7.4).
 *
 * Mobile-first e em pt-BR.
 */

export interface DelinquentsMessageProps {
  rows: readonly DelinquentRow[];
  clubName: string;
  pixKey: string;
  appUrl: string;
}

export function DelinquentsMessage({
  rows,
  clubName,
  pixKey,
  appUrl,
}: DelinquentsMessageProps) {
  const [hideValues, setHideValues] = useState(false);
  const [copied, setCopied] = useState(false);

  // Recalcula a mensagem sempre que o toggle muda. O builder é puro.
  const message = useMemo(
    () =>
      buildDelinquencyMessage({
        clubName,
        rows,
        pixKey,
        appUrl,
        hideValues,
      }),
    [clubName, rows, pixKey, appUrl, hideValues],
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Área de transferência indisponível (ex.: contexto não seguro). A
      // prévia da mensagem continua visível para cópia manual.
      setCopied(false);
    }
  }

  function handleShare() {
    window.open(waMeUrl(message), "_blank", "noopener,noreferrer");
  }

  return (
    <section className="mb-6 rounded-md border bg-card p-4">
      <h2 className="text-sm font-semibold">Cobrar pelo WhatsApp</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Gere uma mensagem pronta com os jogadores em atraso, a chave Pix e o
        link do sistema.
      </p>

      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox
          checked={hideValues}
          onChange={(e) => setHideValues(e.target.checked)}
        />
        Ocultar valores individuais
      </label>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          onClick={handleCopy}
          className="w-full sm:w-auto"
          aria-label="Copiar mensagem de cobrança"
        >
          {copied ? (
            <>
              <Check className="size-4" aria-hidden="true" />
              Mensagem copiada!
            </>
          ) : (
            <>
              <Copy className="size-4" aria-hidden="true" />
              Copiar mensagem
            </>
          )}
        </Button>
        <Button
          type="button"
          onClick={handleShare}
          className="w-full sm:w-auto"
          aria-label="Compartilhar no WhatsApp"
        >
          <Share2 className="size-4" aria-hidden="true" />
          Compartilhar no WhatsApp
        </Button>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Pré-visualizar mensagem
        </summary>
        <pre
          className="mt-2 whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground"
          aria-live="polite"
        >
          {message}
        </pre>
      </details>
    </section>
  );
}
