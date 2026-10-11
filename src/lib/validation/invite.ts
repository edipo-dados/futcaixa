import { z } from "zod";

/**
 * Validação do fluxo de convite (tarefa 20.2).
 *
 * A página pública `/convite/<codigo>` resolve o código no futebol e, para um
 * usuário autenticado, oferece um botão "Entrar neste futebol" que dispara uma
 * Server Action. Essa action recebe o `clubId` resolvido e cria/reaproveita a
 * membership `jogador`/`pendente` (Req 4.3).
 *
 * O `clubId` chega de um campo de formulário (hidden input) renderizado a
 * partir do que a RPC `resolve_invite` devolveu. Mesmo sendo de origem
 * confiável, validamos o formato (UUID) por defesa em profundidade — a RLS no
 * banco continua sendo a fronteira real de autorização.
 */

/** Schema do payload da ação de entrar no futebol: apenas o `clubId` (UUID). */
export const joinClubSchema = z.object({
  clubId: z
    .string({ required_error: "Futebol inválido." })
    .uuid("Futebol inválido."),
});

export type JoinClubInput = z.infer<typeof joinClubSchema>;

/**
 * Estado retornado pela Server Action de entrada no futebol, consumido pela UI
 * do convite.
 *
 * - `idle`: nada enviado ainda.
 * - `pending`: a membership ficou (ou já estava) `pendente` — a tela mostra
 *   "aguardando aprovação do presidente" (Req 4.4).
 * - `error`: falha de validação, de sessão ou de persistência; `message`
 *   descreve o problema em pt-BR.
 *
 * Observação: o caso "membership já ativa" NÃO é um estado desta UI — a página
 * redireciona o membro ativo direto para o painel antes de renderizar o botão.
 */
export interface JoinClubState {
  status: "idle" | "pending" | "error";
  message?: string;
}
