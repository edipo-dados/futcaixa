"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { CLUB_ROLES, ROLE_LABELS, type ClubRole } from "@/lib/clubs/roles";

import { roleActionInitialState } from "./role-action-state";
import { alterarPapelFormAction } from "./role-actions";

/**
 * Formulário mínimo de troca de papel de um membro ATIVO (tarefa 20.4).
 *
 * Mobile-first: um `<select>` nativo (bom em telas pequenas) com os três
 * papéis + um botão "Salvar". Usa Server Action (`alterarPapelFormAction`) via
 * `useFormState`, exibindo mensagem de sucesso/erro — incluindo a guarda do
 * último presidente ("O clube precisa de ao menos um presidente.").
 *
 * Requisitos: 5.1, 5.5, 5.6.
 */

interface AlterarPapelFormProps {
  /** `memberships.id` do membro a ter o papel alterado. */
  membershipId: string;
  /** Papel atual (pré-selecionado no select). */
  currentRole: ClubRole;
  /** Nome do membro, só para rotular acessivelmente o controle. */
  memberName: string;
}

function SaveButton({ changed }: { changed: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending || !changed}>
      {pending ? "Salvando..." : "Salvar"}
    </Button>
  );
}

export function AlterarPapelForm({
  membershipId,
  currentRole,
  memberName,
}: AlterarPapelFormProps) {
  const [state, formAction] = useActionState(
    alterarPapelFormAction,
    roleActionInitialState,
  );

  const selectId = `role-${membershipId}`;

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="membershipId" value={membershipId} />
      <div className="flex items-center gap-2">
        <label htmlFor={selectId} className="sr-only">
          Papel de {memberName}
        </label>
        <Select
          id={selectId}
          name="role"
          defaultValue={currentRole}
          className="w-40"
          aria-label={`Papel de ${memberName}`}
        >
          {CLUB_ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </Select>
        {/* `changed` fica sempre habilitado: o controle não observa o valor do
            select nativo não-controlado; o servidor é a autoridade e ignora
            trocas sem efeito. Mantemos o botão ativo para não bloquear a ação. */}
        <SaveButton changed />
      </div>

      {state.status !== "idle" ? (
        <p
          className={
            state.status === "success"
              ? "text-xs text-green-700 dark:text-green-300"
              : "text-xs text-red-600 dark:text-red-400"
          }
          role="status"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
