"use client";

import * as React from "react";
import {
  Trash2,
  UserPlus,
  Shuffle,
  AlertCircle,
  Copy,
  Check,
} from "lucide-react";

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
import { drawTeams, type DraftResult, type Player } from "@/lib/sorteio/draft";
import { buildDraftResultText } from "@/lib/sorteio/result-text";

/**
 * UI pública do sorteio de times (Requisitos 9.1, 9.2, 9.3).
 *
 * Esta aba é 100% pública (ver `src/middleware.ts`): funciona para qualquer
 * pessoa, logada ou não. Por ser pública e anônima, NÃO é possível carregar
 * jogadores cadastrados do banco de forma confiável — a RLS do Postgres bloqueia
 * leituras anônimas de `players`. Por isso o modo primário (e sempre disponível)
 * é a digitação de NOMES LIVRES com nível 1..3. A seleção de jogadores
 * cadastrados fica como melhoria futura (best-effort, apenas quando houver
 * sessão), sem jamais travar o fluxo público.
 *
 * A tarefa 12.2 cobre: montar a lista, configurar quantos jogadores por time, e
 * executar o sorteio exibindo o resultado. A tarefa 12.3 adiciona as ações
 * "sortear de novo" (Req 9.8) e "copiar resultado" em texto para WhatsApp
 * (Req 9.9), além da persistência do estado em localStorage para não perder a
 * lista ao recarregar a página (Req 9.10) — tudo 100% no cliente.
 */

/** Nível técnico aceito pelo algoritmo. */
type Level = 1 | 2 | 3;

/** Item da lista em edição (com id estável para a UI de edição/remoção). */
interface PlayerEntry {
  id: string;
  name: string;
  level: Level;
}

/** Mínimo de jogadores por time aceito na UI. */
const MIN_PLAYERS_PER_TEAM = 2;
/** Valor inicial de jogadores por time. */
const DEFAULT_PLAYERS_PER_TEAM = 6;

/**
 * Gera os rótulos dos times automaticamente: ["Time 1", "Time 2", ...]. São
 * passados ao algoritmo como o array `colors` (agora meros identificadores).
 */
function makeTeamLabels(nTeams: number): string[] {
  return Array.from({ length: nTeams }, (_, i) => `Time ${i + 1}`);
}

/** Rótulo amigável para cada nível. */
const LEVEL_LABELS: Record<Level, string> = {
  1: "Nível 1 (iniciante)",
  2: "Nível 2 (intermediário)",
  3: "Nível 3 (avançado)",
};

/** Gera um id simples e estável para itens da lista (uso apenas na UI). */
function makeId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Chave de persistência do estado do sorteio no localStorage (Req 9.10). */
const STORAGE_KEY = "futcaixa:sorteio";

/**
 * Formato do estado persistido em localStorage. Guardamos apenas dados simples
 * e serializáveis (lista de jogadores, jogadores por time e, por conveniência,
 * o último resultado) para reconstruir a tela ao recarregar.
 */
interface PersistedState {
  players: PlayerEntry[];
  playersPerTeam: number;
  result: DraftResult | null;
}

/** Valida que um valor desconhecido é um nível aceito (1..3). */
function isLevel(value: unknown): value is Level {
  return value === 1 || value === 2 || value === 3;
}

/**
 * Lê e valida o estado persistido no localStorage. Retorna `null` quando não há
 * nada salvo, quando roda no servidor (sem `window`) ou quando o conteúdo é
 * inválido/corrompido — nesses casos a tela começa do zero sem quebrar.
 */
function loadPersistedState(): PersistedState | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;

    const data = parsed as Record<string, unknown>;

    const players: PlayerEntry[] = Array.isArray(data.players)
      ? data.players
          .filter(
            (p): p is Record<string, unknown> =>
              typeof p === "object" && p !== null,
          )
          .map((p) => ({
            id: typeof p.id === "string" ? p.id : makeId(),
            name: typeof p.name === "string" ? p.name : "",
            level: isLevel(p.level) ? p.level : 2,
          }))
          .filter((p) => p.name.trim() !== "")
      : [];

    const playersPerTeam =
      typeof data.playersPerTeam === "number" &&
      Number.isInteger(data.playersPerTeam)
        ? Math.max(MIN_PLAYERS_PER_TEAM, data.playersPerTeam)
        : DEFAULT_PLAYERS_PER_TEAM;

    const result = isDraftResult(data.result) ? data.result : null;

    return {
      players,
      playersPerTeam,
      result,
    };
  } catch {
    // JSON inválido ou acesso ao storage bloqueado: ignora e começa limpo.
    return null;
  }
}

/**
 * Fallback de cópia para navegadores sem Clipboard API (ou sem permissão):
 * cria um textarea temporário, seleciona o conteúdo e usa `document.execCommand`.
 */
function copyWithFallback(text: string): void {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

/** Verificação de forma mínima para o resultado persistido. */
function isDraftResult(value: unknown): value is DraftResult {
  return (
    Array.isArray(value) &&
    value.every(
      (team) =>
        typeof team === "object" &&
        team !== null &&
        typeof (team as { color?: unknown }).color === "string" &&
        Array.isArray((team as { players?: unknown }).players),
    )
  );
}

export function SorteioClient() {
  const [players, setPlayers] = React.useState<PlayerEntry[]>([]);
  const [newName, setNewName] = React.useState("");
  const [newLevel, setNewLevel] = React.useState<Level>(2);

  const [playersPerTeam, setPlayersPerTeam] = React.useState(
    DEFAULT_PLAYERS_PER_TEAM,
  );

  const [result, setResult] = React.useState<DraftResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  // Controla a hidratação a partir do localStorage. Começamos com o estado
  // padrão (igual no servidor e no 1º render do cliente) para evitar mismatch
  // de hidratação do React; só depois de montar lemos o localStorage e, se
  // houver estado salvo, aplicamos. `hydrated` evita gravar o estado padrão por
  // cima do que estava salvo antes de termos a chance de carregá-lo.
  const [hydrated, setHydrated] = React.useState(false);

  const nameInputRef = React.useRef<HTMLInputElement>(null);

  // Hidrata o estado a partir do localStorage apenas no cliente, após o 1º
  // render (Req 9.10). Executa uma única vez.
  React.useEffect(() => {
    const saved = loadPersistedState();
    if (saved) {
      setPlayers(saved.players);
      setPlayersPerTeam(saved.playersPerTeam);
      setResult(saved.result);
    }
    setHydrated(true);
  }, []);

  // Persiste o estado relevante no localStorage sempre que ele muda, mas só
  // depois da hidratação para não sobrescrever o que foi salvo (Req 9.10).
  React.useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      const toPersist: PersistedState = {
        players,
        playersPerTeam,
        result,
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersist));
    } catch {
      // Storage indisponível (modo privado/cota): persistência é best-effort.
    }
  }, [hydrated, players, playersPerTeam, result]);

  /** Atualiza quantos jogadores por time, respeitando o mínimo. */
  function handlePlayersPerTeamChange(next: number) {
    const clamped = Number.isFinite(next)
      ? Math.max(MIN_PLAYERS_PER_TEAM, Math.trunc(next))
      : MIN_PLAYERS_PER_TEAM;
    setPlayersPerTeam(clamped);
    setResult(null);
  }

  function handleAddPlayer() {
    const name = newName.trim();
    if (name === "") {
      setError("Digite um nome para adicionar o jogador.");
      return;
    }
    setPlayers((prev) => [...prev, { id: makeId(), name, level: newLevel }]);
    setNewName("");
    setNewLevel(2);
    setError(null);
    setResult(null);
    // Mantém o foco no campo de nome para adicionar vários rapidamente.
    nameInputRef.current?.focus();
  }

  function handleAddOnEnter(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAddPlayer();
    }
  }

  function handleRemovePlayer(id: string) {
    setPlayers((prev) => prev.filter((p) => p.id !== id));
    setResult(null);
  }

  function handleChangeLevel(id: string, level: Level) {
    setPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, level } : p)));
    setResult(null);
  }

  /**
   * Executa o sorteio com a lista/configuração atuais. Sem seed fixa, cada
   * chamada embaralha de novo — é isso que faz "Sortear de novo" (Req 9.8)
   * gerar um arranjo diferente respeitando as mesmas regras de equilíbrio.
   */
  function handleDraw() {
    setError(null);
    setCopied(false);

    // Com total <= jogadores por time dá no máximo 1 time, o que não faz
    // sentido sortear: pede ao menos playersPerTeam + 1 jogadores.
    if (players.length <= playersPerTeam) {
      setError(
        `Adicione ao menos ${playersPerTeam + 1} jogadores para formar mais de um time (${playersPerTeam} por time). Você tem ${players.length}.`,
      );
      return;
    }

    // Número de times: arredonda para cima. Ex.: 15 jogadores, 6 por time =>
    // ceil(15/6) = 3 times (6, 6 e 3). Os rótulos "Time N" são gerados aqui.
    const nTeams = Math.ceil(players.length / playersPerTeam);
    const labels = makeTeamLabels(nTeams);

    const draftPlayers: Player[] = players.map((p) => ({
      name: p.name,
      level: p.level,
    }));

    try {
      const draft = drawTeams(draftPlayers, {
        teams: nTeams,
        colors: labels,
        maxPerTeam: playersPerTeam,
      });
      setResult(draft);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível sortear os times. Verifique a lista e as cores.",
      );
    }
  }

  /**
   * Copia o resultado como texto formatado para WhatsApp (Req 9.9). Usa a
   * Clipboard API quando disponível e cai para um fallback com `execCommand`
   * em navegadores antigos. Mostra feedback "Copiado!" por alguns segundos.
   */
  async function handleCopyResult() {
    if (!result) return;

    const text = buildDraftResultText(result);

    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard?.writeText
      ) {
        await navigator.clipboard.writeText(text);
      } else {
        copyWithFallback(text);
      }
      setCopied(true);
      setError(null);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError(
        "Não foi possível copiar automaticamente. Selecione o texto do resultado e copie manualmente.",
      );
    }
  }

  return (
    <div className="space-y-6">
      {/* Montagem da lista de jogadores (Requisito 9.2) */}
      <Card>
        <CardHeader>
          <CardTitle>Jogadores</CardTitle>
          <CardDescription>
            Digite o nome de cada jogador e escolha o nível (1 a 3). O nível é
            usado para equilibrar os times.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="player-name">Nome</Label>
              <Input
                id="player-name"
                ref={nameInputRef}
                value={newName}
                placeholder="Ex.: Ronaldinho"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={handleAddOnEnter}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5 sm:w-56">
              <Label htmlFor="player-level">Nível</Label>
              <Select
                id="player-level"
                value={newLevel}
                onChange={(e) => setNewLevel(Number(e.target.value) as Level)}
              >
                {([1, 2, 3] as Level[]).map((level) => (
                  <option key={level} value={level}>
                    {LEVEL_LABELS[level]}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              type="button"
              onClick={handleAddPlayer}
              className="sm:w-auto"
            >
              <UserPlus aria-hidden="true" />
              Adicionar
            </Button>
          </div>

          {players.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum jogador na lista ainda. Adicione pelo menos{" "}
              {playersPerTeam + 1} para sortear.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {players.map((player, index) => (
                <li key={player.id} className="flex items-center gap-3 p-3">
                  <span
                    className="w-6 shrink-0 text-sm text-muted-foreground"
                    aria-hidden="true"
                  >
                    {index + 1}.
                  </span>
                  <span className="flex-1 truncate font-medium">
                    {player.name}
                  </span>
                  <Select
                    aria-label={`Nível de ${player.name}`}
                    className="w-28"
                    value={player.level}
                    onChange={(e) =>
                      handleChangeLevel(
                        player.id,
                        Number(e.target.value) as Level,
                      )
                    }
                  >
                    {([1, 2, 3] as Level[]).map((level) => (
                      <option key={level} value={level}>
                        Nível {level}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remover ${player.name}`}
                    onClick={() => handleRemovePlayer(player.id)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {players.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {players.length} {players.length === 1 ? "jogador" : "jogadores"}{" "}
              na lista.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Configuração: quantos jogadores por time (Requisito 9.3) */}
      <Card>
        <CardHeader>
          <CardTitle>Configuração</CardTitle>
          <CardDescription>
            Escolha quantos jogadores por time. O número de times é calculado
            automaticamente: os primeiros ficam completos e o último recebe a
            sobra.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5 sm:max-w-xs">
            <Label htmlFor="players-per-team">Jogadores por time</Label>
            <Input
              id="players-per-team"
              type="number"
              inputMode="numeric"
              min={MIN_PLAYERS_PER_TEAM}
              step={1}
              value={playersPerTeam}
              onChange={(e) =>
                handlePlayersPerTeamChange(Number(e.target.value))
              }
              aria-describedby="players-per-team-hint"
            />
            <p
              id="players-per-team-hint"
              className="text-xs text-muted-foreground"
            >
              Ex.: 6 jogadores por time. Com 15 jogadores, saem 2 times de 6 e 1
              time de 3.
            </p>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <Button type="button" size="lg" className="w-full" onClick={handleDraw}>
        <Shuffle aria-hidden="true" />
        {result ? "Sortear de novo" : "Sortear"}
      </Button>

      {/* Resultado do sorteio */}
      {result && (
        <section className="space-y-4" aria-live="polite">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">Resultado</h2>
            <Button
              type="button"
              variant="outline"
              onClick={handleCopyResult}
              aria-label="Copiar resultado para a área de transferência"
            >
              {copied ? (
                <>
                  <Check aria-hidden="true" />
                  Copiado!
                </>
              ) : (
                <>
                  <Copy aria-hidden="true" />
                  Copiar resultado
                </>
              )}
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {result.map((team) => (
              <Card key={team.color}>
                <CardHeader>
                  <CardTitle className="text-base">{team.color}</CardTitle>
                  <CardDescription>
                    {team.players.length}{" "}
                    {team.players.length === 1 ? "jogador" : "jogadores"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ol className="space-y-1 text-sm">
                    {team.players.map((player, index) => (
                      <li
                        key={`${player.name}-${index}`}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="truncate">{player.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          Nível {player.level}
                        </span>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
