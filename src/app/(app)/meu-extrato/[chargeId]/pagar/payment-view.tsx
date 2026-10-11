"use client";

import { useState } from "react";
import { Check, Copy, QrCode } from "lucide-react";
import QRCode from "react-qr-code";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDate } from "@/lib/date";
import { fromCents } from "@/lib/money";

import { ProofUpload } from "./proof-upload";

/**
 * Tela de pagamento Pix (Client Component — tarefa 9.4 + 9.5).
 *
 * Renderiza o QR Code Pix estático a partir do payload "copia e cola" (BR Code
 * / EMV) montado no servidor pelo `StaticPixProvider` e oferece o botão "Pix
 * copia e cola" que copia o mesmo payload para a área de transferência.
 *
 * O QR usa `react-qr-code` (SVG puro, sem canvas), que renderiza o mesmo
 * conteúdo do "copia e cola" — no Pix estático o payload e os dados do QR são
 * idênticos (Req 6.1, 6.4).
 *
 * Abaixo do QR, a seção de envio de comprovante (`ProofUpload`, tarefa 9.5)
 * permite ao jogador anexar a imagem/PDF do pagamento, movendo a cobrança para
 * `em_analise` (Req 6.5).
 */

export interface PaymentViewProps {
  /** Id da cobrança (usado no envio do comprovante). */
  chargeId: string;
  /** Payload "copia e cola" / conteúdo do QR Code (mesma string no Pix estático). */
  payload: string;
  /** Valor da cobrança em centavos. */
  amountCents: number;
  /** Descrição da cobrança. */
  description: string;
  /** Vencimento (`YYYY-MM-DD`). */
  dueDate: string;
}

export function PaymentView({
  chargeId,
  payload,
  amountCents,
  description,
  dueDate,
}: PaymentViewProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard indisponível (ex.: contexto não seguro). O payload continua
      // visível/selecionável abaixo, então o usuário pode copiar manualmente.
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <QrCode className="size-5" aria-hidden="true" />
            Pague com Pix
          </CardTitle>
          <CardDescription>
            Aponte a câmera do seu banco para o QR Code ou use o Pix copia e
            cola.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Resumo da cobrança */}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Valor</dt>
            <dd className="text-right font-semibold tabular-nums">
              {fromCents(amountCents)}
            </dd>
            <dt className="text-muted-foreground">Descrição</dt>
            <dd className="text-right">{description}</dd>
            <dt className="text-muted-foreground">Vencimento</dt>
            <dd className="text-right tabular-nums">{formatDate(dueDate)}</dd>
          </dl>

          {/* QR Code (SVG) */}
          <div className="flex justify-center">
            <div className="rounded-lg bg-white p-4">
              <QRCode
                value={payload}
                size={220}
                className="h-auto w-full max-w-[220px]"
                aria-label="QR Code Pix para pagamento"
              />
            </div>
          </div>

          {/* Pix copia e cola */}
          <div className="space-y-2">
            <Button
              type="button"
              onClick={handleCopy}
              className="w-full"
              aria-label="Copiar código Pix copia e cola"
            >
              {copied ? (
                <>
                  <Check className="size-4" aria-hidden="true" />
                  Código copiado!
                </>
              ) : (
                <>
                  <Copy className="size-4" aria-hidden="true" />
                  Pix copia e cola
                </>
              )}
            </Button>
            <p
              className="break-all rounded-md border bg-muted/40 p-3 text-center font-mono text-xs text-muted-foreground"
              aria-live="polite"
            >
              {payload}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Envio do comprovante → status `em_analise` (tarefa 9.5, Req 6.5). */}
      <ProofUpload chargeId={chargeId} />
    </div>
  );
}
