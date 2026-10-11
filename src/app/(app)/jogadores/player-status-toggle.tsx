"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Power, PowerOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PlayerStatus, PlayerStatusActionState } from "@/lib/validation/player";

import { setPlayerStatus } from "./actions";

/**
 * Botão de inativar/reativar jogador (Req 2.6, 2.8).
 *
 * Usa um `<form>` + Server Action (`setPlayerStatus`). O status atual determina
 * a ação enviada: um jogador `ativo` recebe o botão "Inativar" (envia
 * `inativo`) e vice-versa. Mobile-first: botão compacto, com rótulo textual ao
 * lado do ícone a partir de telas pequenas.
 *
 * Inativar NÃO exclui o jogador nem apaga histórico — apenas o retira da
 * geração automática de mensalidades.
 */

const initialState: PlayerStatusActionState = { status: "idle" };

interface PlayerStatusToggleProps {
  playerId: string;
  currentStatus: PlayerStatus;
}

function ToggleButton({ currentStatus }: { currentStatus: PlayerStatus }) {
  const { pending } = useFormStatus();
  const willInactivate = currentStatus === "ativo";
  const label = willInactivate ? "Inativar" : "Reativar";

  return (
    <Button
      type="submit"
      size="sm"
      variant={willInactivate ? "outline" : "default"}
      disabled={pending}
      aria-label={`${label} jogador`}
    >
      {willInactivate ? (
        <PowerOff className="size-4" aria-hidden="true" />
      ) : (
        <Power className="size-4" aria-hidden="true" />
      )}
      {pending ? "Salvando..." : label}
    </Button>
  );
}

export function PlayerStatusToggle({
  playerId,
  currentStatus,
}: PlayerStatusToggleProps) {
  const [, formAction] = useActionState(setPlayerStatus, initialState);
  const nextStatus: PlayerStatus =
    currentStatus === "ativo" ? "inativo" : "ativo";

  return (
    <form action={formAction} className="shrink-0">
      <input type="hidden" name="id" value={playerId} />
      <input type="hidden" name="status" value={nextStatus} />
      <ToggleButton currentStatus={currentStatus} />
    </form>
  );
}
