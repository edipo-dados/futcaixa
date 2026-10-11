"use client";

import { useEffect, useRef } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  CATEGORY_KIND_LABELS,
  CATEGORY_KINDS,
  type CategoryActionState,
  type CategoryKind,
} from "@/lib/validation/category";

import { createCategory } from "./actions";

/**
 * Formulário de criação de categoria (Client Component — Req 3.3).
 *
 * Compacto e mobile-first: tipo + nome empilhados no celular e em linha a
 * partir de `sm`. Ao criar com sucesso, limpa o campo de nome para facilitar o
 * cadastro em sequência. O `defaultKind` deixa o seletor pré-selecionado no
 * tipo da seção onde o formulário aparece.
 */

const initialState: CategoryActionState = { status: "idle" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      <Plus aria-hidden="true" />
      {pending ? "Criando..." : "Adicionar"}
    </Button>
  );
}

export function CreateCategoryForm({
  defaultKind,
}: {
  defaultKind: CategoryKind;
}) {
  const [state, formAction] = useActionState(createCategory, initialState);
  const nameRef = useRef<HTMLInputElement>(null);

  // Limpa o nome e devolve o foco após criar com sucesso (cadastro em série).
  useEffect(() => {
    if (state.status === "success" && nameRef.current) {
      nameRef.current.value = "";
      nameRef.current.focus();
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="space-y-2 sm:w-40">
          <Label htmlFor={`kind-${defaultKind}`}>Tipo</Label>
          <Select
            id={`kind-${defaultKind}`}
            name="kind"
            defaultValue={defaultKind}
          >
            {CATEGORY_KINDS.map((k) => (
              <option key={k} value={k}>
                {CATEGORY_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex-1 space-y-2">
          <Label htmlFor={`name-${defaultKind}`}>Nome da categoria</Label>
          <Input
            ref={nameRef}
            id={`name-${defaultKind}`}
            name="name"
            placeholder="Ex.: Churrasco"
            maxLength={60}
            required
          />
        </div>

        <SubmitButton />
      </div>

      {state.status === "success" && state.message ? (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300"
        >
          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
          {state.message}
        </p>
      ) : null}
      {state.status === "error" && state.message ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
