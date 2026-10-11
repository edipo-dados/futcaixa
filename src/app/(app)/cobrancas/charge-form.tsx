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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  CHARGE_KINDS,
  CHARGE_KIND_LABELS,
  type ChargeActionState,
  type ChargeFormValues,
  type ChargeKind,
} from "@/lib/validation/charge";

import { createCharge } from "./actions";

/**
 * Formulário de Cobrança manual (Client Component) — criação.
 *
 * Mobile-first: campos empilhados no celular e em grade a partir de `sm`. O
 * select de jogador oferece apenas os ativos (carregados no servidor). O campo
 * de período (`AAAA-MM`) só aparece quando o tipo é `mensalidade` (Req 5.2); o
 * vencimento vem pré-preenchido a partir de `settings.due_day` (Req 5.8), mas
 * pode ser sobrescrito.
 *
 * Requisitos: 5.3 (jogador, valor, descrição, vencimento), 5.8 (vencimento
 * padrão configurável). Autorização admin/tesoureiro é garantida na Server
 * Action + RLS.
 */

/** Jogador ativo oferecido no select. */
export interface PlayerOption {
  id: string;
  name: string;
  nickname: string | null;
}

interface ChargeFormProps {
  players: PlayerOption[];
  defaultValues: ChargeFormValues;
}

const initialState: ChargeActionState = { status: "idle" };

// ─── Componentes auxiliares ─────────────────────────────────────────────────

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Salvando..." : "Criar cobrança"}
    </Button>
  );
}

function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return <p className="text-sm text-destructive">{error}</p>;
}

// ─── Formulário ─────────────────────────────────────────────────────────────

export function ChargeForm({ players, defaultValues }: ChargeFormProps) {
  const [state, formAction] = useActionState(createCharge, initialState);
  const fieldErrors = state.fieldErrors ?? {};

  // Controla a exibição do campo de período (só para mensalidade, Req 5.2).
  const [kind, setKind] = useState<ChargeKind>(defaultValues.kind);
  const isMensalidade = kind === "mensalidade";

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
        <Card>
          <CardHeader>
            <CardTitle>Nova cobrança</CardTitle>
            <CardDescription>
              Registre uma cobrança avulsa (mensalidade, avulso, multa ou
              vaquinha) para um jogador, com valor e vencimento.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* ── Jogador (Req 5.3) ──────────────────────────────────── */}
            <div className="space-y-2">
              <Label htmlFor="playerId">Jogador</Label>
              <Select
                id="playerId"
                name="playerId"
                defaultValue={defaultValues.playerId}
                aria-invalid={!!fieldErrors.playerId || undefined}
              >
                <option value="">Selecione...</option>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nickname ? `${p.name} (${p.nickname})` : p.name}
                  </option>
                ))}
              </Select>
              <FieldError error={fieldErrors.playerId} />
              {players.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nenhum jogador ativo. Cadastre em{" "}
                  <Link href="/jogadores" className="underline">
                    Jogadores
                  </Link>
                  .
                </p>
              )}
            </div>

            {/* ── Tipo e valor ───────────────────────────────────────── */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="kind">Tipo</Label>
                <Select
                  id="kind"
                  name="kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as ChargeKind)}
                  aria-invalid={!!fieldErrors.kind || undefined}
                >
                  {CHARGE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {CHARGE_KIND_LABELS[k]}
                    </option>
                  ))}
                </Select>
                <FieldError error={fieldErrors.kind} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="amountCents">Valor (R$)</Label>
                <Input
                  id="amountCents"
                  name="amountCents"
                  inputMode="decimal"
                  defaultValue={defaultValues.amountCents}
                  placeholder="0,00"
                  required
                  aria-invalid={!!fieldErrors.amountCents || undefined}
                />
                <FieldError error={fieldErrors.amountCents} />
              </div>
            </div>

            {/* ── Descrição (Req 5.3) ────────────────────────────────── */}
            <div className="space-y-2">
              <Label htmlFor="description">Descrição</Label>
              <Input
                id="description"
                name="description"
                defaultValue={defaultValues.description}
                placeholder="Ex.: Avulso do jogo de sábado"
                maxLength={200}
                required
                aria-invalid={!!fieldErrors.description || undefined}
              />
              <FieldError error={fieldErrors.description} />
            </div>

            {/* ── Vencimento (Req 5.3/5.8) ───────────────────────────── */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="dueDate">Vencimento</Label>
                <Input
                  id="dueDate"
                  name="dueDate"
                  type="date"
                  defaultValue={defaultValues.dueDate}
                  required
                  aria-invalid={!!fieldErrors.dueDate || undefined}
                />
                <FieldError error={fieldErrors.dueDate} />
                <p className="text-xs text-muted-foreground">
                  Sugerido a partir do dia de vencimento das Configurações.
                </p>
              </div>

              {/* ── Período — só para mensalidade (Req 5.2) ─────────── */}
              {isMensalidade && (
                <div className="space-y-2">
                  <Label htmlFor="period">Período (mês de referência)</Label>
                  <Input
                    id="period"
                    name="period"
                    type="month"
                    defaultValue={defaultValues.period}
                    required
                    aria-invalid={!!fieldErrors.period || undefined}
                  />
                  <FieldError error={fieldErrors.period} />
                  <p className="text-xs text-muted-foreground">
                    Uma mensalidade por jogador por mês.
                  </p>
                </div>
              )}
            </div>

            {/* Mantém o período no envio quando o campo não está visível,
                para o schema receber string vazia (tratada como ausente). */}
            {!isMensalidade && <input type="hidden" name="period" value="" />}
          </CardContent>
        </Card>

        {/* ── Ações ───────────────────────────────────────────────────── */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" asChild>
            <Link href="/cobrancas">Cancelar</Link>
          </Button>
          <SubmitButton />
        </div>
      </form>
    </div>
  );
}
