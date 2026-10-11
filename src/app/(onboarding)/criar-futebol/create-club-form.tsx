"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

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

import { criarFutebol, type CreateClubActionState } from "./actions";

const initialState: CreateClubActionState = { status: "idle" };

// ─── Componentes auxiliares ───────────────────────────────────────────────

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full sm:w-auto" disabled={pending}>
      {pending ? "Criando futebol..." : "Criar futebol"}
    </Button>
  );
}

function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={id} className="text-sm text-destructive">
      {error}
    </p>
  );
}

// ─── Formulário ───────────────────────────────────────────────────────────

/**
 * Formulário de criação de futebol (Client Component — Requisito 3).
 *
 * Consome a Server Action `criarFutebol` via `useFormState`. Em sucesso a
 * action redireciona para `/dashboard` (não há estado de sucesso aqui); em
 * falha, exibe a mensagem geral e os erros por campo (`fieldErrors`).
 *
 * Mobile-first e acessível: `Label`/`htmlFor` em todos os campos, `aria-invalid`
 * e `aria-describedby` ligados ao erro de cada campo, e um resumo de erro geral
 * com `role="alert"`. O logo é omitido aqui — pode ser definido depois em
 * Configurações.
 */
export function CreateClubForm() {
  const [state, formAction] = useActionState(criarFutebol, initialState);
  const fieldErrors = state.fieldErrors ?? {};

  return (
    <div className="space-y-6">
      {/* ── Erro geral (sem fieldErrors) ────────────────────────────── */}
      {state.status === "error" && state.message && !state.fieldErrors && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {state.message}
        </div>
      )}

      <form action={formAction} className="space-y-6" noValidate>
        {/* ── Dados do clube (Req 3.1) ───────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Dados do futebol</CardTitle>
            <CardDescription>Como o seu futebol se chama.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="name">Nome do futebol</Label>
              <Input
                id="name"
                name="name"
                placeholder="Ex.: Pelada do Sábado"
                maxLength={100}
                required
                autoFocus
                aria-invalid={!!fieldErrors.name || undefined}
                aria-describedby={fieldErrors.name ? "name-error" : undefined}
              />
              <FieldError id="name-error" error={fieldErrors.name} />
            </div>
          </CardContent>
        </Card>

        {/* ── Dados Pix (Req 3.1) ────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Dados do Pix</CardTitle>
            <CardDescription>
              Chave, nome do recebedor e cidade usados para gerar o QR Code das
              cobranças. Você pode preencher depois.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pixKey">Chave Pix</Label>
              <Input
                id="pixKey"
                name="pixKey"
                placeholder="CPF, celular, e-mail ou chave aleatória"
                maxLength={77}
                aria-invalid={!!fieldErrors.pixKey || undefined}
                aria-describedby={
                  fieldErrors.pixKey ? "pixKey-error" : undefined
                }
              />
              <FieldError id="pixKey-error" error={fieldErrors.pixKey} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pixReceiverName">Nome do recebedor</Label>
                <Input
                  id="pixReceiverName"
                  name="pixReceiverName"
                  placeholder="Até 25 caracteres"
                  maxLength={25}
                  aria-invalid={!!fieldErrors.pixReceiverName || undefined}
                  aria-describedby={
                    fieldErrors.pixReceiverName
                      ? "pixReceiverName-error"
                      : undefined
                  }
                />
                <FieldError
                  id="pixReceiverName-error"
                  error={fieldErrors.pixReceiverName}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pixCity">Cidade</Label>
                <Input
                  id="pixCity"
                  name="pixCity"
                  placeholder="Até 15 caracteres"
                  maxLength={15}
                  aria-invalid={!!fieldErrors.pixCity || undefined}
                  aria-describedby={
                    fieldErrors.pixCity ? "pixCity-error" : undefined
                  }
                />
                <FieldError id="pixCity-error" error={fieldErrors.pixCity} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Valores padrão (Req 3.1) ───────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Valores padrão</CardTitle>
            <CardDescription>
              Mensalidade e avulso aplicados quando o jogador não tem valor
              personalizado.
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
                  defaultValue="0,00"
                  placeholder="0,00"
                  aria-invalid={!!fieldErrors.defaultMonthlyCents || undefined}
                  aria-describedby={
                    fieldErrors.defaultMonthlyCents
                      ? "defaultMonthlyCents-error"
                      : undefined
                  }
                />
                <FieldError
                  id="defaultMonthlyCents-error"
                  error={fieldErrors.defaultMonthlyCents}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="defaultDropInCents">Avulso padrão (R$)</Label>
                <Input
                  id="defaultDropInCents"
                  name="defaultDropInCents"
                  inputMode="decimal"
                  defaultValue="0,00"
                  placeholder="0,00"
                  aria-invalid={!!fieldErrors.defaultDropInCents || undefined}
                  aria-describedby={
                    fieldErrors.defaultDropInCents
                      ? "defaultDropInCents-error"
                      : undefined
                  }
                />
                <FieldError
                  id="defaultDropInCents-error"
                  error={fieldErrors.defaultDropInCents}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Datas de cobrança (Req 3.1) ────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Datas de cobrança</CardTitle>
            <CardDescription>
              Dia do mês para gerar e para vencer as mensalidades (1 a 28).
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
                  defaultValue={1}
                  aria-invalid={!!fieldErrors.generationDay || undefined}
                  aria-describedby={
                    fieldErrors.generationDay
                      ? "generationDay-error"
                      : undefined
                  }
                />
                <FieldError
                  id="generationDay-error"
                  error={fieldErrors.generationDay}
                />
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
                  defaultValue={10}
                  aria-invalid={!!fieldErrors.dueDay || undefined}
                  aria-describedby={
                    fieldErrors.dueDay ? "dueDay-error" : undefined
                  }
                />
                <FieldError id="dueDay-error" error={fieldErrors.dueDay} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Saldo inicial ──────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Saldo inicial</CardTitle>
            <CardDescription>
              Saldo inicial do caixa, considerado nos dashboards.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="initialBalanceCents">Saldo inicial (R$)</Label>
              <Input
                id="initialBalanceCents"
                name="initialBalanceCents"
                inputMode="decimal"
                defaultValue="0,00"
                placeholder="0,00"
                aria-invalid={!!fieldErrors.initialBalanceCents || undefined}
                aria-describedby={
                  fieldErrors.initialBalanceCents
                    ? "initialBalanceCents-error"
                    : undefined
                }
              />
              <FieldError
                id="initialBalanceCents-error"
                error={fieldErrors.initialBalanceCents}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <SubmitButton />
        </div>
      </form>
    </div>
  );
}
