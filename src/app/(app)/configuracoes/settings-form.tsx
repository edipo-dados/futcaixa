"use client";

import { useRef, useState } from "react";
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
import type {
  SettingsActionState,
  SettingsFormValues,
} from "@/lib/validation/settings";

import { saveSettings, uploadLogo } from "./actions";

// ─── Tipos ────────────────────────────────────────────────────────────────

interface SettingsFormProps {
  defaultValues: SettingsFormValues;
  /**
   * Habilita a edição. Apenas o presidente do futebol ativo pode salvar
   * (Req 16.3); tesoureiro/jogador visualizam em modo somente leitura.
   * Padrão `true` para compatibilidade.
   */
  canEdit?: boolean;
}

const initialState: SettingsActionState = { status: "idle" };

// ─── Componentes auxiliares ───────────────────────────────────────────────

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Salvando..." : "Salvar configurações"}
    </Button>
  );
}

function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return <p className="text-sm text-destructive">{error}</p>;
}

// ─── Formulário ───────────────────────────────────────────────────────────

/**
 * Formulário de Configurações (Client Component).
 *
 * Exibe os campos organizados em seções (Dados do Clube, Pix, Valores,
 * Dias, Saldo Inicial). Usa `useFormState` para feedback via Server Action.
 * O upload de logo é tratado separadamente (endpoint próprio).
 *
 * Multi-tenant (tarefa 21.1): quando `canEdit` é false (tesoureiro/jogador),
 * os campos ficam somente leitura e as ações de salvar/enviar logo somem; a
 * edição é restrita ao presidente (reforçada também nas Server Actions + RLS).
 *
 * Requisitos: 10.1, 10.2, 10.3, 16.3 (edição só do presidente, enforced na
 * action + RLS).
 */
export function SettingsForm({
  defaultValues,
  canEdit = true,
}: SettingsFormProps) {
  const [state, formAction] = useActionState(saveSettings, initialState);
  const fieldErrors = state.fieldErrors ?? {};

  // ── Logo upload (separado do form principal) ─────────────────────────
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoPath, setLogoPath] = useState<string | null>(
    defaultValues.logoPath,
  );
  const logoInputRef = useRef<HTMLInputElement>(null);

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setLogoUploading(true);
    setLogoError(null);

    const fd = new FormData();
    fd.append("logo", file);

    const result = await uploadLogo(fd);

    setLogoUploading(false);
    if (result.error) {
      setLogoError(result.error);
    } else {
      setLogoPath(result.path);
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Feedback geral ──────────────────────────────────────────── */}
      {state.status === "success" && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
        >
          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
          {state.message}
        </div>
      )}
      {state.status === "error" && state.message && !state.fieldErrors && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {state.message}
        </div>
      )}

      <form action={formAction} className="space-y-6" noValidate>
        {/* Campo oculto para logoPath */}
        <input type="hidden" name="logoPath" value={logoPath ?? ""} />

        {/* ── Dados do Clube (Req 10.1) ──────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Dados do clube</CardTitle>
            <CardDescription>
              Nome e identidade visual do futebol.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="clubName">Nome do futebol</Label>
              <Input
                id="clubName"
                name="clubName"
                defaultValue={defaultValues.clubName}
                placeholder="Ex.: Pelada do Sábado"
                maxLength={100}
                required
                disabled={!canEdit}
                aria-invalid={!!fieldErrors.clubName || undefined}
                aria-describedby={
                  fieldErrors.clubName ? "clubName-error" : undefined
                }
              />
              <FieldError error={fieldErrors.clubName} />
            </div>

            {/* Logo upload — apenas o presidente envia (Req 16.3). */}
            <div className="space-y-2">
              <Label htmlFor="logo">Logo</Label>
              <div className="flex items-center gap-3">
                {logoPath && (
                  <span className="text-xs text-muted-foreground truncate max-w-48">
                    {logoPath}
                  </span>
                )}
                {canEdit && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={logoUploading}
                      onClick={() => logoInputRef.current?.click()}
                    >
                      <Upload className="size-4" aria-hidden="true" />
                      {logoUploading ? "Enviando..." : "Enviar logo"}
                    </Button>
                    <input
                      ref={logoInputRef}
                      id="logo"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      className="sr-only"
                      onChange={handleLogoUpload}
                    />
                  </>
                )}
                {!canEdit && !logoPath && (
                  <span className="text-xs text-muted-foreground">
                    Nenhum logo definido.
                  </span>
                )}
              </div>
              {logoError && (
                <p className="text-sm text-destructive">{logoError}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Dados Pix (Req 10.1) ───────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Dados do Pix</CardTitle>
            <CardDescription>
              Chave, nome do recebedor e cidade para gerar o QR Code.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pixKey">Chave Pix</Label>
              <Input
                id="pixKey"
                name="pixKey"
                defaultValue={defaultValues.pixKey}
                placeholder="CPF, celular, e-mail ou chave aleatória"
                maxLength={77}
                disabled={!canEdit}
                aria-invalid={!!fieldErrors.pixKey || undefined}
                aria-describedby={
                  fieldErrors.pixKey ? "pixKey-error" : undefined
                }
              />
              <FieldError error={fieldErrors.pixKey} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pixReceiverName">Nome do recebedor</Label>
                <Input
                  id="pixReceiverName"
                  name="pixReceiverName"
                  defaultValue={defaultValues.pixReceiverName}
                  placeholder="Até 25 caracteres"
                  maxLength={25}
                  disabled={!canEdit}
                  aria-invalid={!!fieldErrors.pixReceiverName || undefined}
                  aria-describedby={
                    fieldErrors.pixReceiverName
                      ? "pixReceiverName-error"
                      : undefined
                  }
                />
                <FieldError error={fieldErrors.pixReceiverName} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pixCity">Cidade</Label>
                <Input
                  id="pixCity"
                  name="pixCity"
                  defaultValue={defaultValues.pixCity}
                  placeholder="Até 15 caracteres"
                  maxLength={15}
                  disabled={!canEdit}
                  aria-invalid={!!fieldErrors.pixCity || undefined}
                  aria-describedby={
                    fieldErrors.pixCity ? "pixCity-error" : undefined
                  }
                />
                <FieldError error={fieldErrors.pixCity} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Valores padrão (Req 10.2) ──────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Valores padrão</CardTitle>
            <CardDescription>
              Mensalidade e avulso padrão aplicados quando o jogador não tem
              valor personalizado.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="defaultMonthlyCents">
                  Mensalidade padrão (R$)
                </Label>
                <Input
                  id="defaultMonthlyCents"
                  name="defaultMonthlyCents"
                  inputMode="decimal"
                  defaultValue={defaultValues.defaultMonthlyCents}
                  placeholder="0,00"
                  disabled={!canEdit}
                  aria-invalid={
                    !!fieldErrors.defaultMonthlyCents || undefined
                  }
                  aria-describedby={
                    fieldErrors.defaultMonthlyCents
                      ? "defaultMonthlyCents-error"
                      : undefined
                  }
                />
                <FieldError error={fieldErrors.defaultMonthlyCents} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="defaultDropInCents">
                  Avulso padrão (R$)
                </Label>
                <Input
                  id="defaultDropInCents"
                  name="defaultDropInCents"
                  inputMode="decimal"
                  defaultValue={defaultValues.defaultDropInCents}
                  placeholder="0,00"
                  disabled={!canEdit}
                  aria-invalid={
                    !!fieldErrors.defaultDropInCents || undefined
                  }
                  aria-describedby={
                    fieldErrors.defaultDropInCents
                      ? "defaultDropInCents-error"
                      : undefined
                  }
                />
                <FieldError error={fieldErrors.defaultDropInCents} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Dias de vencimento e geração (Req 10.2) ────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Datas de cobrança</CardTitle>
            <CardDescription>
              Dia do mês para gerar e vencer as mensalidades (1 a 28).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="generationDay">Dia de geração</Label>
                <Input
                  id="generationDay"
                  name="generationDay"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={28}
                  defaultValue={defaultValues.generationDay}
                  disabled={!canEdit}
                  aria-invalid={!!fieldErrors.generationDay || undefined}
                  aria-describedby={
                    fieldErrors.generationDay
                      ? "generationDay-error"
                      : undefined
                  }
                />
                <FieldError error={fieldErrors.generationDay} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dueDay">Dia de vencimento</Label>
                <Input
                  id="dueDay"
                  name="dueDay"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={28}
                  defaultValue={defaultValues.dueDay}
                  disabled={!canEdit}
                  aria-invalid={!!fieldErrors.dueDay || undefined}
                  aria-describedby={
                    fieldErrors.dueDay ? "dueDay-error" : undefined
                  }
                />
                <FieldError error={fieldErrors.dueDay} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Saldo inicial (Req 10.3) ───────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Saldo inicial</CardTitle>
            <CardDescription>
              Saldo inicial do caixa, considerado no cálculo dos dashboards.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="initialBalanceCents">
                Saldo inicial (R$)
              </Label>
              <Input
                id="initialBalanceCents"
                name="initialBalanceCents"
                inputMode="decimal"
                defaultValue={defaultValues.initialBalanceCents}
                placeholder="0,00"
                disabled={!canEdit}
                aria-invalid={
                  !!fieldErrors.initialBalanceCents || undefined
                }
                aria-describedby={
                  fieldErrors.initialBalanceCents
                    ? "initialBalanceCents-error"
                    : undefined
                }
              />
              <FieldError error={fieldErrors.initialBalanceCents} />
            </div>
          </CardContent>
        </Card>

        {/* ── Botão de salvar (só o presidente edita, Req 16.3) ──────── */}
        {canEdit && (
          <div className="flex justify-end">
            <SubmitButton />
          </div>
        )}
      </form>
    </div>
  );
}
