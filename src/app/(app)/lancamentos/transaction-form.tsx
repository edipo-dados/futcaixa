"use client";

import { useMemo, useState } from "react";
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
  TRANSACTION_KINDS,
  TRANSACTION_KIND_LABELS,
  type TransactionActionState,
  type TransactionFormValues,
  type TransactionKind,
} from "@/lib/validation/transaction";

import { createTransaction, updateTransaction } from "./actions";

/**
 * Formulário de Lançamento (Client Component) — criar e editar.
 *
 * Mobile-first: campos empilhados no celular e em grade a partir de `sm`.
 * As categorias são filtradas no cliente pelo tipo (receita/despesa)
 * selecionado — apenas categorias ATIVAS são oferecidas (as desativadas saem
 * de novos lançamentos, Req 3.4). O jogador vinculado é opcional (Req 3.1), e
 * o comprovante (imagem/PDF) também (Req 3.7).
 *
 * Requisitos: 3.1, 3.7, 3.10, 3.11 (manager-only enforced na action).
 */

// ─── Tipos auxiliares ───────────────────────────────────────────────────────

/** Categoria ativa oferecida no select (filtrada por tipo no cliente). */
export interface CategoryOption {
  id: string;
  kind: TransactionKind;
  name: string;
}

/** Jogador ativo oferecido no select de vínculo (opcional). */
export interface PlayerOption {
  id: string;
  name: string;
  nickname: string | null;
}

interface TransactionFormProps {
  mode: "create" | "edit";
  defaultValues: TransactionFormValues;
  categories: CategoryOption[];
  players: PlayerOption[];
  transactionId?: string;
  /** Indica se o lançamento em edição já possui comprovante. */
  hasExistingProof?: boolean;
}

const initialState: TransactionActionState = { status: "idle" };

const ACCEPTED_PROOF = "image/jpeg,image/png,image/webp,application/pdf";

// ─── Componentes auxiliares ─────────────────────────────────────────────────

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  const label =
    mode === "create" ? "Registrar lançamento" : "Salvar alterações";
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

export function TransactionForm({
  mode,
  defaultValues,
  categories,
  players,
  transactionId,
  hasExistingProof = false,
}: TransactionFormProps) {
  const action = mode === "create" ? createTransaction : updateTransaction;
  const [state, formAction] = useActionState(action, initialState);
  const fieldErrors = state.fieldErrors ?? {};

  // Tipo controlado para filtrar as categorias pelo kind (Req 3.1).
  const [kind, setKind] = useState<TransactionKind>(defaultValues.kind);

  const visibleCategories = useMemo(
    () => categories.filter((c) => c.kind === kind),
    [categories, kind],
  );

  // Se a categoria selecionada não pertence ao tipo atual, limpa a seleção.
  const defaultCategoryForKind = visibleCategories.some(
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

      <form
        action={formAction}
        className="space-y-6"
        encType="multipart/form-data"
        noValidate
      >
        {mode === "edit" && transactionId && (
          <input type="hidden" name="id" value={transactionId} />
        )}

        {/* ── Dados do lançamento (Req 3.1) ───────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Lançamento</CardTitle>
            <CardDescription>
              Tipo, valor, data, categoria e descrição.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="kind">Tipo</Label>
                <Select
                  id="kind"
                  name="kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as TransactionKind)}
                  aria-invalid={!!fieldErrors.kind || undefined}
                >
                  {TRANSACTION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {TRANSACTION_KIND_LABELS[k]}
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
                  aria-describedby={
                    fieldErrors.amountCents ? "amountCents-error" : undefined
                  }
                />
                <FieldError error={fieldErrors.amountCents} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="occurredOn">Data</Label>
                <Input
                  id="occurredOn"
                  name="occurredOn"
                  type="date"
                  defaultValue={defaultValues.occurredOn}
                  required
                  aria-invalid={!!fieldErrors.occurredOn || undefined}
                />
                <FieldError error={fieldErrors.occurredOn} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="categoryId">Categoria</Label>
                <Select
                  id="categoryId"
                  name="categoryId"
                  defaultValue={defaultCategoryForKind}
                  // key força o remount ao trocar o tipo, resetando a seleção
                  // para as categorias do novo tipo.
                  key={kind}
                  aria-invalid={!!fieldErrors.categoryId || undefined}
                >
                  <option value="">Selecione...</option>
                  {visibleCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <FieldError error={fieldErrors.categoryId} />
                {visibleCategories.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma categoria ativa de{" "}
                    {TRANSACTION_KIND_LABELS[kind].toLowerCase()}. Cadastre em{" "}
                    <Link href="/categorias" className="underline">
                      Categorias
                    </Link>
                    .
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descrição</Label>
              <Input
                id="description"
                name="description"
                defaultValue={defaultValues.description}
                placeholder="Ex.: Aluguel da quadra, goleiro contratado..."
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

        {/* ── Vínculos e comprovante (Req 3.1, 3.7) ───────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Vínculos e comprovante</CardTitle>
            <CardDescription>
              Jogador relacionado (opcional) e comprovante (opcional).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="playerId">Jogador vinculado</Label>
              <Select
                id="playerId"
                name="playerId"
                defaultValue={defaultValues.playerId}
                aria-invalid={!!fieldErrors.playerId || undefined}
              >
                <option value="">Nenhum</option>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nickname ? `${p.name} (${p.nickname})` : p.name}
                  </option>
                ))}
              </Select>
              <FieldError error={fieldErrors.playerId} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="proof">Comprovante (imagem ou PDF)</Label>
              <Input
                id="proof"
                name="proof"
                type="file"
                accept={ACCEPTED_PROOF}
              />
              {mode === "edit" && hasExistingProof && (
                <p className="text-sm text-muted-foreground">
                  Já existe um comprovante anexado. Enviar um novo arquivo
                  substituirá o atual.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Formatos aceitos: JPG, PNG, WebP ou PDF. Máximo 5 MB. O arquivo
                fica em um bucket privado e só é acessível por link temporário.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ── Ações ───────────────────────────────────────────────────── */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" asChild>
            <Link href="/lancamentos">Cancelar</Link>
          </Button>
          <SubmitButton mode={mode} />
        </div>
      </form>
    </div>
  );
}
