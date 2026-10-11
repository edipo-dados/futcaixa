// Construtor de texto do resultado do sorteio para compartilhar no WhatsApp
// (Requisito 9.9). Função pura e determinística: dada a mesma entrada, produz
// sempre a mesma string, sem depender de data/hora, aleatoriedade ou ambiente.
// Fica isolada aqui para ser facilmente testável e reutilizável (copiar texto,
// montar link wa.me, etc.).

import type { DraftResult } from "@/lib/sorteio/draft";

/** Opções de formatação do texto do resultado. */
export interface BuildDraftResultTextOptions {
  /** Título/cabeçalho da mensagem. Padrão: "⚽ Times sorteados". */
  title?: string;
  /**
   * Se deve incluir o nível de cada jogador ao lado do nome. Padrão: false
   * (a lista pública costuma ser compartilhada sem expor os níveis).
   */
  includeLevels?: boolean;
}

/** Título padrão da mensagem. */
const DEFAULT_TITLE = "⚽ Times sorteados";

/**
 * Monta um texto amigável para WhatsApp a partir do resultado do sorteio.
 *
 * Estrutura (pt-BR):
 *
 *   ⚽ Times sorteados
 *
 *   🔵 Azul
 *   • Fulano
 *   • Beltrano
 *
 *   🔴 Vermelho
 *   • Ciclano
 *
 * Cada time vira um bloco com um cabeçalho (emoji da cor + nome da cor) e um
 * item com marcador "•" por jogador. Os blocos são separados por uma linha em
 * branco. A função é pura: não acessa `navigator`, `Date` nem aleatoriedade.
 *
 * @param result Resultado do sorteio (um item por time, na ordem das cores).
 * @param opts Opções de formatação (título e exibição de níveis).
 * @returns String pronta para copiar/compartilhar.
 */
export function buildDraftResultText(
  result: DraftResult,
  opts: BuildDraftResultTextOptions = {},
): string {
  const title = opts.title?.trim() ? opts.title.trim() : DEFAULT_TITLE;
  const includeLevels = opts.includeLevels ?? false;

  const blocks = result.map((team) => {
    const emoji = colorEmoji(team.color);
    const header = emoji ? `${emoji} ${team.color}` : team.color;

    if (team.players.length === 0) {
      return `${header}\n(sem jogadores)`;
    }

    const lines = team.players.map((player) => {
      const suffix = includeLevels ? ` (nível ${player.level})` : "";
      return `• ${player.name}${suffix}`;
    });

    return `${header}\n${lines.join("\n")}`;
  });

  // Cabeçalho + blocos de time, separados por linha em branco.
  return [title, ...blocks].join("\n\n");
}

/**
 * Mapeia nomes de cor comuns (pt-BR) para um emoji de círculo colorido. Retorna
 * string vazia quando não há emoji correspondente (ex.: rótulos genéricos como
 * "Time 1"), caso em que o texto usa apenas o nome.
 */
function colorEmoji(color: string): string {
  const key = color
    .trim()
    .toLowerCase()
    // Remove acentos para casar "roxo"/"laranja" etc. de forma robusta.
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const map: Record<string, string> = {
    azul: "🔵",
    vermelho: "🔴",
    amarelo: "🟡",
    verde: "🟢",
    preto: "⚫",
    branco: "⚪",
    laranja: "🟠",
    roxo: "🟣",
  };

  return map[key] ?? "";
}
