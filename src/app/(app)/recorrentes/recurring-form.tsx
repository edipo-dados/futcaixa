"use client";

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
  DAY_OF_MONTH_MAX,
  DAY_OF_MONTH_MIN,
  type RecurringActionState,
  type RecurringFormValues,
} from "@/lib/validation/recurring";

import { createRecurring, updateRecurring } from "./actions";

/**
 * Formulário de Despesa Recorrente (Client Component) — criar e editar.
 *
 * Mobile-first: campos empilhados no celular e em grade a partir de `sm`.
 * As categorias oferecidas são apenas as ATIVAS de DESPESA (carregadas no
 * servidor). O campo `last_generated_period` NÃO aparece aqui — é gerido pelo
 * cron (tarefa 7.2).
 *
 * Requisitos: 4.1 (valor, categoria, descrição, dia), 4.4 (ativa/inativa).
 * Autorização admin/tesoureiro é garantida na Server Action + RLS.
 */

/** Categoria ativa de despesa oferecida no select. */
export interface CategoryOption {
  id: string;
  name: string;
}

interface RecurringFormProps {
  mode: "create" | "edit";
  defaultValues: RecurringFormValues;
  categories: CategoryOption[];
  recurringId?: string;
}

const initialState: RecurringActionState = { status: "idle" };

// ─── Componentes auxiliares ─────────────────────────────────────────────────

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  const label =
    mode === "create" ? "Cadastrar despesa recorrente" : "Salvar alterações";
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

/** Opções do dia do mês (1..28). */
const DAY_OPTIONS = Array.from(
  { length: DAY_OF_MONTH_MAX - DAY_OF_MONTH_MIN + 1 },
  (_, i) => DAY_OF_MONTH_MIN + i,
);

// ─── Formulário ─────────────────────────────────────────────────────────────

export function RecurringForm({
  mode,
  defaultValues,
  categories,
  recurringId,
}: RecurringFormProps) {
  const action = mode === "create" ? createRecurring : updateRecurring;
  const [state, formAction] = useActionState(action, initialState);
  const fieldErrors = state.fieldErrors ?? {};

  const defaultCategory = categories.some(
    (c) => c.id === defaultValues.categoryId,
  )
    ? defaultValues.categoryId
    : "";

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
        {mode === "edit" && recurringId && (
          <input type="hidden" name="id" value={recurringId} />
        )}

        {/* ── Dados da despesa recorrente (Req 4.1) ───────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Despesa recorrente</CardTitle>
            <CardDescription>
              Valor, categoria, descrição e o dia do mês em que será lançada
              automaticamente.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
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
                  aria-describedby={
                    fieldErrors.amountCents ? "amountCents-error" : undefined
                  }
                />
                <FieldError error={fieldErrors.amountCents} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dayOfMonth">Dia do mês</Label>
                <Select
                  id="dayOfMonth"
                  name="dayOfMonth"
                  defaultValue={defaultValues.dayOfMonth}
                  aria-invalid={!!fieldErrors.dayOfMonth || undefined}
                >
                  {DAY_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      Dia {d}
                    </option>
                  ))}
                </Select>
                <FieldError error={fieldErrors.dayOfMonth} />
                <p className="text-xs text-muted-foreground">
                  Entre {DAY_OF_MONTH_MIN} e {DAY_OF_MONTH_MAX} (evita meses mais
                  curtos).
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="categoryId">Categoria</Label>
              <Select
                id="categoryId"
                name="categoryId"
                defaultValue={defaultCategory}
                aria-invalid={!!fieldErrors.categoryId || undefined}
              >
                <option value="">Selecione...</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <FieldError error={fieldErrors.categoryId} />
              {categories.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nenhuma categoria ativa de despesa. Cadastre em{" "}
                  <Link href="/categorias" className="underline">
                    Categorias
                  </Link>
                  .
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descrição</Label>
              <Input
                id="description"
                name="description"
                defaultValue={defaultValues.description}
                placeholder="Ex.: Aluguel mensal da quadra"
                maxLength={200}
                required
                aria-invalid={!!fieldErrors.description || undefined}
                aria-describedby={
                  fieldErrors.description ? "description-error" : undefined
                }
              />
              <FieldError error={fieldErrors.description} />
            </div>
          </CardContent>
        </Card>

        {/* ── Status (Req 4.4) ────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>
              Despesas inativas deixam de gerar novos lançamentos. Os
              lançamentos já gerados são preservados.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-3">
              <input
                id="isActive"
                name="isActive"
                type="checkbox"
                defaultChecked={defaultValues.isActive}
                className="mt-1 size-4 shrink-0 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <div className="space-y-1">
                <Label htmlFor="isActive">Despesa ativa</Label>
                <p className="text-xs text-muted-foreground">
                  Quando marcada, o lançamento é gerado automaticamente no dia
                  configurado.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Ações ───────────────────────────────────────────────────── */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" asChild>
            <Link href="/recorrentes">Cancelar</Link>
          </Button>
          <SubmitButton mode={mode} />
        </div>
      </form>
    </div>
  );
}
