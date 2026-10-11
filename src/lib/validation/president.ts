import { z } from "zod";

/**
 * Validação e tipos do fluxo "solicitar ser presidente" (tarefa 19.1).
 *
 * Contexto (Requisitos 2.1, 2.2): um usuário autenticado SEM futebol pode pedir
 * para virar presidente de plataforma. A ação altera `profiles.president_status`
 * para `pendente` e registra uma linha em `president_requests`. Só depois de
 * `aprovado` por um `system_admin` (tarefa 19.2) ele poderá criar um futebol.
 *
 * O formulário em si não tem campos editáveis (é um único botão), mas mantemos
 * um schema por consistência com o restante do projeto e para abrir espaço a
 * uma observação opcional (`note`) no pedido.
 */

/** Estado atual da solicitação de presidência (espelha `profiles.president_status`). */
export type PresidentStatus = "none" | "pendente" | "aprovado";

/**
 * Schema do pedido de presidência. `note` é uma observação opcional que o
 * usuário pode anexar ao pedido (gravada em `president_requests.note`).
 */
export const solicitarPresidenciaSchema = z.object({
  note: z
    .string()
    .trim()
    .max(500, "A observação deve ter no máximo 500 caracteres.")
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
});

export type SolicitarPresidenciaInput = z.infer<
  typeof solicitarPresidenciaSchema
>;

/**
 * Estado retornado pela Server Action `solicitarPresidencia`, consumido pela UI
 * do onboarding.
 *
 * - `idle`: nada enviado ainda.
 * - `success`: pedido registrado (ou já existente) — `president_status` ficou
 *   `pendente`/`aprovado`; a tela recarrega e passa a mostrar o estado novo.
 * - `error`: falha de validação ou de persistência; `message` descreve o
 *   problema em pt-BR.
 */
export interface SolicitarPresidenciaState {
  status: "idle" | "success" | "error";
  message?: string;
}
