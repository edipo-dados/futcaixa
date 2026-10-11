"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  ChevronDown,
  ChevronUp,
  Pencil,
  Power,
  PowerOff,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type CategoryActionState,
  type CategoryRow as CategoryRowData,
} from "@/lib/validation/category";

import {
  deleteCategory,
  moveCategory,
  renameCategory,
  setCategoryActive,
} from "./actions";

/**
 * Item de categoria (Client Component).
 *
 * Reúne as ações sobre uma categoria (Req 3.3, 3.4, 3.5):
 *  - renomear (edição inline);
 *  - reordenar (mover para cima/baixo — swap de `sort_order`);
 *  - ativar/desativar;
 *  - excluir (apenas categorias não-sistema e sem uso; caso contrário a action
 *    recusa e orienta a desativar).
 *
 * Mobile-first: layout compacto, botões com área de toque adequada e rótulos
 * acessíveis via `aria-label`.
 */

const initialState: CategoryActionState = { status: "idle" };

interface CategoryRowProps {
  category: CategoryRowData;
  /** `true` quando é o primeiro item do grupo (desabilita "subir"). */
  isFirst: boolean;
  /** `true` quando é o último item do grupo (desabilita "descer"). */
  isLast: boolean;
}

// ─── Botões com estado de envio ─────────────────────────────────────────────

function IconSubmit({
  label,
  disabled,
  variant = "ghost",
  children,
}: {
  label: string;
  disabled?: boolean;
  variant?: "ghost" | "outline" | "default" | "destructive";
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="icon"
      variant={variant}
      disabled={pending || disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </Button>
  );
}

// ─── Formulário de renomear (inline) ────────────────────────────────────────

function RenameForm({
  category,
  onDone,
}: {
  category: CategoryRowData;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState(renameCategory, initialState);

  // Fecha a edição ao concluir com sucesso (fora da fase de render).
  useEffect(() => {
    if (state.status === "success") {
      onDone();
    }
  }, [state, onDone]);

  return (
    <form action={formAction} className="flex flex-1 items-center gap-2">
      <input type="hidden" name="id" value={category.id} />
      <Input
        name="name"
        defaultValue={category.name}
        maxLength={60}
        aria-label="Novo nome da categoria"
        autoFocus
        className="h-9"
      />
      <RenameSubmit />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Cancelar edição"
        onClick={onDone}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
      {state.status === "error" && state.message ? (
        <span className="sr-only" role="alert">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

function RenameSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Salvando..." : "Salvar"}
    </Button>
  );
}

// ─── Item principal ─────────────────────────────────────────────────────────

export function CategoryRow({ category, isFirst, isLast }: CategoryRowProps) {
  const [editing, setEditing] = useState(false);

  const [, moveAction] = useActionState(moveCategory, initialState);
  const [, toggleAction] = useActionState(setCategoryActive, initialState);
  const [deleteState, deleteAction] = useActionState(
    deleteCategory,
    initialState,
  );

  const isInactive = !category.is_active;

  return (
    <li className="rounded-md border bg-card p-3">
      <div className="flex items-center gap-2">
        {/* ── Reordenar ──────────────────────────────────────────────── */}
        <div className="flex flex-col">
          <form action={moveAction}>
            <input type="hidden" name="id" value={category.id} />
            <input type="hidden" name="direction" value="up" />
            <IconSubmit label="Mover para cima" disabled={isFirst}>
              <ChevronUp className="size-4" aria-hidden="true" />
            </IconSubmit>
          </form>
          <form action={moveAction}>
            <input type="hidden" name="id" value={category.id} />
            <input type="hidden" name="direction" value="down" />
            <IconSubmit label="Mover para baixo" disabled={isLast}>
              <ChevronDown className="size-4" aria-hidden="true" />
            </IconSubmit>
          </form>
        </div>

        {/* ── Nome / edição inline ───────────────────────────────────── */}
        {editing ? (
          <RenameForm category={category} onDone={() => setEditing(false)} />
        ) : (
          <div className="min-w-0 flex-1">
            <p
              className={`flex flex-wrap items-center gap-2 truncate font-medium ${
                isInactive ? "text-muted-foreground" : ""
              }`}
            >
              {category.name}
              {category.is_system ? (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-200">
                  Padrão
                </span>
              ) : null}
              {isInactive ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  Inativa
                </span>
              ) : null}
            </p>
          </div>
        )}

        {/* ── Ações ──────────────────────────────────────────────────── */}
        {!editing ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Renomear categoria"
              title="Renomear"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-4" aria-hidden="true" />
            </Button>

            {/* Ativar / desativar */}
            <form action={toggleAction}>
              <input type="hidden" name="id" value={category.id} />
              <input
                type="hidden"
                name="isActive"
                value={isInactive ? "true" : "false"}
              />
              <IconSubmit
                label={isInactive ? "Ativar categoria" : "Desativar categoria"}
              >
                {isInactive ? (
                  <Power className="size-4" aria-hidden="true" />
                ) : (
                  <PowerOff className="size-4" aria-hidden="true" />
                )}
              </IconSubmit>
            </form>

            {/* Excluir (apenas não-sistema; a action recusa se estiver em uso) */}
            {!category.is_system ? (
              <form action={deleteAction}>
                <input type="hidden" name="id" value={category.id} />
                <IconSubmit label="Excluir categoria" variant="ghost">
                  <Trash2
                    className="size-4 text-destructive"
                    aria-hidden="true"
                  />
                </IconSubmit>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Mensagem de erro (ex.: tentativa de excluir categoria em uso). */}
      {deleteState.status === "error" && deleteState.message ? (
        <p
          role="alert"
          className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {deleteState.message}
        </p>
      ) : null}
    </li>
  );
}
