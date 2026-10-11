"use client";

import { useState } from "react";
import { Check, Copy, Link2, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { waMeUrl } from "@/lib/whatsapp";

/**
 * Card do link de convite do futebol (presidente).
 *
 * O futebol tem um `invite_code` fixo (gerado na criação do clube). A rota
 * pública `/convite/<codigo>` resolve esse código e permite que o jogador
 * entre como pendente. Esta UI monta a URL completa a partir do `inviteUrl`
 * (origin resolvido no servidor) e oferece ao presidente:
 *   - "Copiar link" → copia a URL para a área de transferência;
 *   - "Compartilhar no WhatsApp" → abre `wa.me` com uma mensagem pronta.
 *
 * Não existe "gerar" propriamente: o link é fixo por clube. O que esta tela faz
 * é expor/compartilhar o link que já existe.
 */
export interface InviteLinkCardProps {
  /** URL pública completa do convite (ex.: https://app/convite/ABC123). */
  inviteUrl: string;
  /** Nome do futebol, usado na mensagem do WhatsApp. */
  clubName: string;
}

export function InviteLinkCard({ inviteUrl, clubName }: InviteLinkCardProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Área de transferência indisponível (ex.: contexto não seguro). O link
      // continua visível no campo para cópia manual.
      setCopied(false);
    }
  }

  function handleShare() {
    const message = `Entre no ${clubName} pelo FutCaixa. Use o link de convite: ${inviteUrl}`;
    window.open(waMeUrl(message), "_blank", "noopener,noreferrer");
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-5 text-primary" aria-hidden="true" />
          Link de convite
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Compartilhe este link com quem você quer convidar. Quem entrar por ele
          vira jogador pendente e aparece aqui para você aprovar.
        </p>

        <Input
          readOnly
          value={inviteUrl}
          aria-label="Link de convite do futebol"
          onFocus={(e) => e.currentTarget.select()}
          className="font-mono text-sm"
        />

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={handleCopy}
            className="w-full sm:w-auto"
            aria-label="Copiar link de convite"
          >
            {copied ? (
              <>
                <Check className="size-4" aria-hidden="true" />
                Link copiado!
              </>
            ) : (
              <>
                <Copy className="size-4" aria-hidden="true" />
                Copiar link
              </>
            )}
          </Button>
          <Button
            type="button"
            onClick={handleShare}
            className="w-full sm:w-auto"
            aria-label="Compartilhar convite no WhatsApp"
          >
            <Share2 className="size-4" aria-hidden="true" />
            Compartilhar no WhatsApp
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
