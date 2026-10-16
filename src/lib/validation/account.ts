import { z } from "zod";

import { PASSWORD_MIN_LENGTH } from "@/lib/validation/auth";

/**
 * Validação da aba "Meu cadastro": troca de senha pelo próprio jogador.
 *
 * O jogador que recebeu uma senha temporária (ou que simplesmente quer trocar)
 * define uma nova senha e a confirma. A política de tamanho reaproveita
 * `PASSWORD_MIN_LENGTH` do schema de autenticação para manter consistência.
 */

export const changePasswordSchema = z
  .object({
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `A senha deve ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`),
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    path: ["confirm"],
    message: "As senhas não conferem.",
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * Estado retornado pela Server Action de troca de senha, consumido pela UI
 * (padrão useActionState).
 */
export interface ChangePasswordState {
  status: "idle" | "success" | "error";
  /** Mensagem geral exibida ao usuário (erro ou confirmação). */
  message?: string;
  /** Erros por campo do formulário de troca de senha. */
  fieldErrors?: Partial<Record<"password" | "confirm", string>>;
}
