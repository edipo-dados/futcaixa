"use client";

import { useId, useTransition } from "react";

import { setActiveClub } from "@/app/(app)/trocar-futebol/actions";
import type { ActiveMembership } from "@/lib/auth/membership";
import { Select } from "@/components/ui/select";

/**
 * Seletor de troca de futebol da sidebar (tarefa 23.2 — Requisitos 7.3/7.4).
 *
 * Renderizado SOMENTE quando o usuário tem mais de uma membership ativa (com um
 * único futebol a sidebar mostra o nome sem seletor — Req 7.4). Ao escolher
 * outro clube, chama a Server Action {@link setActiveClub}, que valida a
 * membership ativa, grava o cookie `fc_active_club` e redireciona para o
 * dashboard já no contexto do novo clube.
 *
 * Acessível e mobile-first: usa o `<select>` nativo (abre o seletor do
 * sistema no celular) com `<label>` associado por `htmlFor`. Durante a troca o
 * controle fica desabilitado (via `useTransition`) para evitar seleções
 * concorrentes enquanto o servidor re-resolve a sessão.
 */
interface ClubSwitcherProps {
  /** Memberships ativas do usuário (já ordenadas por nome do clube). */
  memberships: ActiveMembership[];
  /** `clubId` do clube atualmente ativo (opção selecionada). */
  activeClubId: string;
}

export function ClubSwitcher({
  memberships,
  activeClubId,
}: ClubSwitcherProps) {
  const selectId = useId();
  const [isPending, startTransition] = useTransition();

  const onChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextClubId = event.target.value;
    if (nextClubId === activeClubId) {
      return;
    }
    startTransition(() => {
      void setActiveClub(nextClubId);
    });
  };

  return (
    <div className="px-2">
      <label
        htmlFor={selectId}
        className="mb-1 block text-xs font-medium text-muted-foreground"
      >
        Futebol ativo
      </label>
      <Select
        id={selectId}
        value={activeClubId}
        onChange={onChange}
        disabled={isPending}
        aria-label="Trocar de futebol"
      >
        {memberships.map((membership) => (
          <option key={membership.clubId} value={membership.clubId}>
            {membership.clubName}
          </option>
        ))}
      </Select>
    </div>
  );
}
