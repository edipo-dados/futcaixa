/**
 * Tipo e estado inicial da ação de troca de papel.
 *
 * Mora FORA de `role-actions.ts` porque aquele arquivo é `"use server"` — e um
 * módulo de Server Actions só pode exportar funções async. Exportar daqui o
 * `type` e a constante de estado inicial evita o erro do Next:
 * "A 'use server' file can only export async functions, found object."
 */

/** Estado da ação de troca de papel, consumido pela UI via `useActionState`. */
export type RoleActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

/** Estado inicial da ação (nada enviado ainda). */
export const roleActionInitialState: RoleActionState = { status: "idle" };
