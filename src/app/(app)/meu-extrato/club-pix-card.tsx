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
import { fromCents } from "@/lib/money";

/**
 * Card do Pix da mensalidade do futebol (Client Component).
 *
 * Exibido no painel do jogador (`/meu-extrato`), mostra o QR Code Pix estático
 * e o "copia e cola" (BR Code / EMV) com o VALOR DA MENSALIDADE configurado
 * pelo presidente nas Configurações do clube (`settings.default_monthly_cents`).
 * O payload é montado no servidor pelo `StaticPixProvider`; aqui apenas
 * renderizamos o QR (`react-qr-code`, SVG) e oferecemos o botão de copiar — o
 * payload e o conteúdo do QR são a mesma string no Pix estático.
 *
 * Diferente da tela de pagamento de uma cobrança específica, este Pix é fixo:
 * usa sempre o valor padrão de mensalidade do futebol, para o jogador pagar a
 * mensalidade avulsa/adiantada sem depender de uma cobrança existente.
 */
export interface ClubPixCardProps {
  /** Payload "copia e cola" / conteúdo do QR (mesma string no Pix estático). */
  payload: string;
  /** Valor da mensalidade (centavos) configurado pelo presidente. */
  monthlyCents: number;
  /** Nome do futebol, exibido no cabeçalho. */
  clubName: string;
}

export function ClubPixCard({
  payload,
  monthlyCents,
  clubName,
}: ClubPixCardProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard indisponível (ex.: contexto não seguro). O payload continua
      // visível/selecionável abaixo para cópia manual.
      setCopied(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <QrCode className="size-5 text-primary" aria-hidden="true" />
          Pagar mensalidade do {clubName}
        </CardTitle>
        <CardDescription>
          Aponte a câmera do seu banco para o QR Code ou use o Pix copia e cola.
          O valor é a mensalidade definida pelo presidente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Valor da mensalidade */}
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Valor da mensalidade</span>
          <span className="text-xl font-semibold tabular-nums">
            {fromCents(monthlyCents)}
          </span>
        </div>

        {/* QR Code (SVG) */}
        <div className="flex justify-center">
          <div className="rounded-lg bg-white p-4">
            <QRCode
              value={payload}
              size={220}
              className="h-auto w-full max-w-[220px]"
              aria-label="QR Code Pix da mensalidade do futebol"
            />
          </div>
        </div>

        {/* Pix copia e cola */}
        <div className="space-y-2">
          <Button
            type="button"
            onClick={handleCopy}
            className="w-full"
            aria-label="Copiar código Pix copia e cola da mensalidade"
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
  );
}
