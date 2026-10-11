/**
 * Gerador de mensagem de cobrança para WhatsApp (Req 7.2, 7.3, 7.4).
 *
 * Este módulo é PURO (sem banco, sem DOM): monta uma string formatada em
 * pt-BR a partir das linhas agregadas de inadimplentes (`DelinquentRow[]`),
 * para ser facilmente testável e reutilizável tanto no cliente quanto em
 * eventuais usos no servidor.
 *
 * Importante: este app NÃO integra a API do WhatsApp. O compartilhamento
 * acontece apenas por link `wa.me` (sem API) e por "copiar para a área de
 * transferência" (Req 7.3).
 */

import { fromCents } from "@/lib/money";

/**
 * Linha de inadimplente usada na montagem da mensagem.
 *
 * É compatível com `DelinquentRow` (`lib/delinquency.ts`), porém declarada
 * aqui de forma mínima para manter o builder desacoplado e serializável
 * (pode ser passado do Server Component para o Client Component).
 */
export interface DelinquencyMessageRow {
  playerName: string;
  playerNickname?: string | null;
  /** Total devido em centavos. */
  totalCents: number;
  /** Quantidade de meses distintos em atraso. */
  monthsOverdue: number;
}

/** Parâmetros para montar a mensagem de cobrança. */
export interface BuildDelinquencyMessageParams {
  /** Nome do clube/futebol (cabeçalho). */
  clubName: string;
  /** Linhas agregadas de inadimplentes. */
  rows: readonly DelinquencyMessageRow[];
  /** Chave Pix para pagamento. */
  pixKey: string;
  /** Link do sistema (ex.: NEXT_PUBLIC_APP_URL). Pode ser vazio. */
  appUrl?: string;
  /**
   * Quando `true`, oculta o valor devido por cada jogador (Req 7.4). Ainda
   * lista nomes e meses em atraso, mas sem expor o montante individual.
   */
  hideValues?: boolean;
}

/** Rótulo do jogador: "Nome (Apelido)" quando houver apelido. */
function playerLabel(row: DelinquencyMessageRow): string {
  const nickname = row.playerNickname?.trim();
  return nickname ? `${row.playerName} (${nickname})` : row.playerName;
}

/** Pluraliza "mês"/"meses" de forma pt-BR. */
function monthsLabel(n: number): string {
  return `${n} ${n === 1 ? "mês" : "meses"} em atraso`;
}

/**
 * Monta a mensagem de cobrança formatada para WhatsApp (pt-BR, com emojis).
 *
 * Estrutura:
 *  - Cabeçalho com o nome do clube.
 *  - Uma linha por jogador em atraso: nome (+ apelido), total devido
 *    (`fromCents`) e meses em atraso. Com `hideValues`, o total é omitido.
 *  - Chave Pix para pagamento.
 *  - Link do sistema (quando informado).
 *
 * A função é determinística e pura: a mesma entrada produz sempre a mesma
 * saída, sem efeitos colaterais.
 */
export function buildDelinquencyMessage({
  clubName,
  rows,
  pixKey,
  appUrl,
  hideValues = false,
}: BuildDelinquencyMessageParams): string {
  const club = clubName.trim() || "Futebol";

  const lines: string[] = [];

  // Cabeçalho.
  lines.push(`⚽ *${club}* — Cobrança de mensalidade`);
  lines.push("");

  if (rows.length === 0) {
    lines.push("✅ Ninguém em atraso no momento. Tudo em dia por aqui!");
  } else {
    lines.push("🔴 *Jogadores em atraso:*");
    for (const row of rows) {
      if (hideValues) {
        // Req 7.4: sem expor o valor devido por jogador.
        lines.push(`• ${playerLabel(row)} — ${monthsLabel(row.monthsOverdue)}`);
      } else {
        lines.push(
          `• ${playerLabel(row)} — *${fromCents(row.totalCents)}* (${monthsLabel(row.monthsOverdue)})`,
        );
      }
    }
  }

  lines.push("");
  lines.push(`💳 *Pix:* ${pixKey}`);
  lines.push("Pague e envie o comprovante, por favor. 🙏");

  const url = appUrl?.trim();
  if (url) {
    lines.push("");
    lines.push(`🔗 Acesse o sistema: ${url}`);
  }

  return lines.join("\n");
}

/**
 * Monta a URL `wa.me` com a mensagem pré-preenchida (Req 7.3).
 *
 * Não usa nenhuma API do WhatsApp: apenas o esquema público de links
 * `https://wa.me/?text=<mensagem codificada>`, que abre o app/WhatsApp Web
 * com o texto pronto para o usuário escolher o destinatário.
 */
export function waMeUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
