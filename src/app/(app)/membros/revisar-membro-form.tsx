"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  APPROVAL_PLAYER_TYPES,
  type ApprovalPlayerType,
} from "@/lib/clubs/approveMember";

import {
  aprovarMembro,
  recusarMembro,
  type MembroActionState,
} from "./actions";
import type { UnlinkedPlayer } from "./page";

/**
 * Botões de revisão de um membro pendente (tarefa 20.3 + ajuste de vínculo).
 *
 * APROVAR tem dois modos:
 *   - "Criar novo jogador" (padrão): a RPC cria um `players` a partir do perfil
 *     do usuário, com o tipo escolhido (mensalista/avulso).
 *   - "Vincular a jogador existente": quando o presidente já cadastrou o
 *     jogador manualmente em /jogadores, ele escolhe esse jogador no select e a
 *     aprovação vincula a membership a ele (sem duplicar). O tipo escolhido
 *     também é aplicado ao jogador existente.
 *
 * Em ambos os casos, aprovar como `mensalista` já gera a mensalidade do mês
 * corrente (status pendente) — tratado na RPC `approve_member`.
 *
 * RECUSAR muda `status` para `recusado`. Em sucesso, a Server Action revalida
 * `/membros` e o Server Component pai re-renderiza a lista sem a linha resolvida.
 */

const initialState: MembroActionState = { status: "idle" };

/** Rótulos pt-BR dos tipos aprováveis. */
const TYPE_LABELS: Record<ApprovalPlayerType, string> = {
  mensalista: "Mensalista",
  avulso: "Avulso",
};

/** Botão de submit que reflete o estado "pending" do seu próprio formulário. */
function SubmitButton({
  label,
  pendingLabel,
  variant,
}: {
  label: string;
  pendingLabel: string;
  variant?: "default" | "outline";
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant={variant}
      disabled={pending}
      aria-disabled={pending}
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}

/** Rótulo de exibição de um jogador (nome + apelido quando houver). */
function playerLabel(p: UnlinkedPlayer): string {
  const nick = p.nickname?.trim();
  return nick && nick.length > 0 ? `${p.name} (${nick})` : p.name;
}

export function RevisarMembroForm({
  membershipId,
  unlinkedPlayers,
}: {
  membershipId: string;
  /** Jogadores do clube ainda não vinculados, para a opção de vincular. */
  unlinkedPlayers: UnlinkedPlayer[];
}) {
  const [aprovarState, aprovarAction] = useActionState(
    aprovarMembro,
    initialState,
  );
  const [recusarState, recusarAction] = useActionState(
    recusarMembro,
    initialState,
  );
  const [tipo, setTipo] = useState<ApprovalPlayerType>("mensalista");
  // "" = criar novo jogador; caso contrário, id do jogador a vincular.
  const [playerId, setPlayerId] = useState<string>("");

  const selectId = `tipo-${membershipId}`;
  const playerSelectId = `player-${membershipId}`;
  const hasPlayers = unlinkedPlayers.length > 0;

  const errorMessage =
    aprovarState.status === "error"
      ? aprovarState.message
      : recusarState.status === "error"
        ? recusarState.message
        : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <form action={aprovarAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="membershipId" value={membershipId} />
          <input type="hidden" name="tipo" value={tipo} />
          <input type="hidden" name="playerId" value={playerId} />

          {hasPlayers ? (
            <div className="space-y-1">
              <Label htmlFor={playerSelectId} className="text-xs">
                Jogador
              </Label>
              <Select
                id={playerSelectId}
                value={playerId}
                onChange={(e) => setPlayerId(e.target.value)}
                className="h-9 w-48"
                aria-label="Vincular a jogador existente ou criar novo"
              >
                <option value="">Criar novo jogador</option>
                {unlinkedPlayers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {playerLabel(p)}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          <div className="space-y-1">
            <Label htmlFor={selectId} className="text-xs">
              Tipo
            </Label>
            <Select
              id={selectId}
              value={tipo}
              onChange={(e) => setTipo(e.target.value as ApprovalPlayerType)}
              className="h-9 w-36"
              aria-label="Tipo do jogador"
            >
              {APPROVAL_PLAYER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
          <SubmitButton label="Aprovar" pendingLabel="Aprovando..." />
        </form>

        <form action={recusarAction}>
          <input type="hidden" name="membershipId" value={membershipId} />
          <SubmitButton
            label="Recusar"
            pendingLabel="Recusando..."
            variant="outline"
          />
        </form>
      </div>
      {errorMessage ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
