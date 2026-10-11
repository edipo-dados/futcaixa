"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  PLAYER_STATUSES,
  PLAYER_TYPES,
  type PlayerActionState,
  type PlayerFormValues,
} from "@/lib/validation/player";

import { createPlayer, updatePlayer } from "./actions";

// ─── Rótulos pt-BR dos enums ────────────────────────────────────────────────

const TYPE_LABELS: Record<(typeof PLAYER_TYPES)[number], string> = {
  mensalista: "Mensalista",
  avulso: "Avulso",
  convidado: "Convidado",
};

const STATUS_LABELS: Record<(typeof PLAYER_STATUSES)[number], string> = {
  ativo: "Ativo",
  inativo: "Inativo",
};

const SKILL_LABELS: Record<string, string> = {
  "1": "1 — Iniciante",
  "2": "2 — Intermediário",
  "3": "3 — Avançado",
};

// ─── Tipos e estado inicial ─────────────────────────────────────────────────

interface PlayerFormProps {
  /** Modo de operação do formulário. */
  mode: "create" | "edit";
  /** Valores iniciais (vazios para criar, preenchidos para editar). */
  defaultValues: PlayerFormValues;
  /** Id do jogador (obrigatório no modo editar). */
  playerId?: string;
}

const initialState: PlayerActionState = { status: "idle" };

// ─── Componentes auxiliares ─────────────────────────────────────────────────

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  const label = mode === "create" ? "Cadastrar jogador" : "Salvar alterações";
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Salvando..." : label}
    </Button>
  );
}

function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return <p className="text-sm text-destructive">{error}</p>;
}

// ─── Formulário ─────────────────────────────────────────────────────────────

/**
 * Formulário de Jogador (Client Component) — criar e editar.
 *
 * Mobile-first: campos empilhados no celular e em grade a partir de `sm`.
 * O campo "motivo da isenção" só aparece quando "Isento" está marcado
 * (Req 2.2). Os valores personalizados sobrescrevem o padrão (Req 2.3/2.4).
 *
 * Requisitos: 2.1, 2.2, 2.3, 2.4, 2.5, 2.8 (admin-only enforced na action).
 */
export function PlayerForm({ mode, defaultValues, playerId }: PlayerFormProps) {
  const action = mode === "create" ? createPlayer : updatePlayer;
  const [state, formAction] = useActionState(action, initialState);
  const fieldErrors = state.fieldErrors ?? {};

  // Controla a exibição condicional do motivo da isenção (Req 2.2).
  const [isExempt, setIsExempt] = useState(defaultValues.isExempt);

  return (
    <div className="space-y-6">
      {/* ── Feedback geral ─────────────────────────────────────────────── */}
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
        {mode === "edit" && playerId && (
          <input type="hidden" name="id" value={playerId} />
        )}

        {/* ── Dados pessoais (Req 2.1) ────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Dados pessoais</CardTitle>
            <CardDescription>Nome, apelido e contatos.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome</Label>
              <Input
                id="name"
                name="name"
                defaultValue={defaultValues.name}
                placeholder="Nome completo"
                maxLength={120}
                required
                aria-invalid={!!fieldErrors.name || undefined}
                aria-describedby={fieldErrors.name ? "name-error" : undefined}
              />
              <FieldError error={fieldErrors.name} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="nickname">Apelido</Label>
              <Input
                id="nickname"
                name="nickname"
                defaultValue={defaultValues.nickname}
                placeholder="Como é conhecido (opcional)"
                maxLength={60}
                aria-invalid={!!fieldErrors.nickname || undefined}
              />
              <FieldError error={fieldErrors.nickname} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  defaultValue={defaultValues.email}
                  placeholder="exemplo@email.com (opcional)"
                  aria-invalid={!!fieldErrors.email || undefined}
                  aria-describedby={
                    fieldErrors.email ? "email-error" : undefined
                  }
                />
                <FieldError error={fieldErrors.email} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Telefone</Label>
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  defaultValue={defaultValues.phone}
                  placeholder="(11) 90000-0000 (opcional)"
                  aria-invalid={!!fieldErrors.phone || undefined}
                  aria-describedby={
                    fieldErrors.phone ? "phone-error" : undefined
                  }
                />
                <FieldError error={fieldErrors.phone} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Classificação (Req 2.1) ─────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Classificação</CardTitle>
            <CardDescription>
              Tipo, status e nível técnico (usado no sorteio).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="type">Tipo</Label>
                <Select
                  id="type"
                  name="type"
                  defaultValue={defaultValues.type}
                  aria-invalid={!!fieldErrors.type || undefined}
                >
                  {PLAYER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
                <FieldError error={fieldErrors.type} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  id="status"
                  name="status"
                  defaultValue={defaultValues.status}
                  aria-invalid={!!fieldErrors.status || undefined}
                >
                  {PLAYER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
                <FieldError error={fieldErrors.status} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="skillLevel">Nível técnico</Label>
                <Select
                  id="skillLevel"
                  name="skillLevel"
                  defaultValue={defaultValues.skillLevel}
                  aria-invalid={!!fieldErrors.skillLevel || undefined}
                >
                  {["1", "2", "3"].map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {SKILL_LABELS[lvl]}
                    </option>
                  ))}
                </Select>
                <FieldError error={fieldErrors.skillLevel} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Isenção (Req 2.2) ───────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Isenção</CardTitle>
            <CardDescription>
              Jogadores isentos (ex.: goleiro) não entram na geração de
              mensalidades.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="isExempt"
                name="isExempt"
                checked={isExempt}
                onChange={(e) => setIsExempt(e.target.checked)}
              />
              <Label htmlFor="isExempt" className="cursor-pointer">
                Jogador isento de mensalidade
              </Label>
            </div>

            {isExempt && (
              <div className="space-y-2">
                <Label htmlFor="exemptReason">Motivo da isenção</Label>
                <Input
                  id="exemptReason"
                  name="exemptReason"
                  defaultValue={defaultValues.exemptReason}
                  placeholder="Ex.: goleiro"
                  maxLength={200}
                  aria-invalid={!!fieldErrors.exemptReason || undefined}
                  aria-describedby={
                    fieldErrors.exemptReason ? "exemptReason-error" : undefined
                  }
                />
                <FieldError error={fieldErrors.exemptReason} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Valores personalizados (Req 2.3/2.4) ────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Valores personalizados</CardTitle>
            <CardDescription>
              Deixe em branco para usar os valores padrão das Configurações.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="customMonthlyCents">
                  Mensalidade personalizada (R$)
                </Label>
                <Input
                  id="customMonthlyCents"
                  name="customMonthlyCents"
                  inputMode="decimal"
                  defaultValue={defaultValues.customMonthlyCents}
                  placeholder="Padrão das Configurações"
                  aria-invalid={!!fieldErrors.customMonthlyCents || undefined}
                  aria-describedby={
                    fieldErrors.customMonthlyCents
                      ? "customMonthlyCents-error"
                      : undefined
                  }
                />
                <FieldError error={fieldErrors.customMonthlyCents} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="customDropInCents">
                  Avulso personalizado (R$)
                </Label>
                <Input
                  id="customDropInCents"
                  name="customDropInCents"
                  inputMode="decimal"
                  defaultValue={defaultValues.customDropInCents}
                  placeholder="Padrão das Configurações"
                  aria-invalid={!!fieldErrors.customDropInCents || undefined}
                  aria-describedby={
                    fieldErrors.customDropInCents
                      ? "customDropInCents-error"
                      : undefined
                  }
                />
                <FieldError error={fieldErrors.customDropInCents} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Ações ───────────────────────────────────────────────────── */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" asChild>
            <Link href="/jogadores">Cancelar</Link>
          </Button>
          <SubmitButton mode={mode} />
        </div>
      </form>
    </div>
  );
}
