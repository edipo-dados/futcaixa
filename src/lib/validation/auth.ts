import { z } from "zod";

/**
 * Validação dos formulários de autenticação por e-mail + senha.
 *
 * O FutCaixa usa login por senha com cadastro aberto: qualquer pessoa pode
 * criar uma conta (papel inicial `jogador`) e entrar imediatamente. Não há
 * envio de e-mail (magic link/OTP) no fluxo padrão.
 */

/** Tamanho mínimo de senha aceito no cadastro e no login. */
export const PASSWORD_MIN_LENGTH = 6;

const emailField = z
  .string({ required_error: "Informe seu e-mail." })
  .trim()
  .min(1, "Informe seu e-mail.")
  .email("Informe um e-mail válido.")
  .transform((value) => value.toLowerCase());

const passwordField = z
  .string({ required_error: "Informe sua senha." })
  .min(PASSWORD_MIN_LENGTH, `A senha deve ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`);

/**
 * Schema de login (entrar): e-mail + senha. A validação de credenciais em si
 * é feita no servidor pelo Supabase Auth (ver `login/actions.ts`).
 */
export const loginSchema = z.object({
  email: emailField,
  password: passwordField,
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Schema de cadastro (criar conta): nome + e-mail + senha. Novos usuários
 * recebem o papel `jogador` automaticamente (via trigger no banco).
 */
export const signUpSchema = z.object({
  fullName: z
    .string({ required_error: "Informe seu nome." })
    .trim()
    .min(2, "Informe seu nome completo."),
  email: emailField,
  password: passwordField,
});

export type SignUpInput = z.infer<typeof signUpSchema>;

/**
 * Intenção associada ao estado do formulário, para a UI saber a qual aba o
 * resultado pertence (entrar ou criar conta).
 */
export type AuthIntent = "signin" | "signup";

/**
 * Estado retornado pelas Server Actions de autenticação, consumido pela UI.
 *
 * - `idle`: nada enviado ainda.
 * - `error`: erro de validação ou de credenciais; `message`/`fieldErrors`
 *   descrevem o problema em pt-BR.
 * - `success`: usado quando o cadastro foi feito mas a sessão NÃO foi criada
 *   (confirmação de e-mail ligada no projeto Supabase). Em caso de sucesso
 *   com sessão, a action redireciona e não há estado a exibir.
 */
export interface LoginState {
  status: "idle" | "error" | "success";
  /** A qual formulário este estado se refere. */
  intent?: AuthIntent;
  /** Mensagem geral exibida ao usuário (erro ou aviso de confirmação). */
  message?: string;
  /** Erros por campo (chave = nome do campo do formulário). */
  fieldErrors?: Partial<Record<"fullName" | "email" | "password", string>>;
}
