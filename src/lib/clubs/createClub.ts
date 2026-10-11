import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  createClubSchema,
  toCreateClubRpcArgs,
  type CreateClubFormValues,
} from "@/lib/validation/club";

/**
 * Criação atômica de futebol (tarefa 20.1).
 *
 * Esta é a camada server-only que o app (ex.: a tela de criação de futebol,
 * fora do escopo desta tarefa) consome. Ela:
 *   1) valida os inputs com Zod (`createClubSchema`);
 *   2) chama a RPC Postgres `create_club` (SECURITY DEFINER), que faz TODAS as
 *      inserções numa única transação — `clubs`, membership presidente/ativo,
 *      `settings` do clube, categorias padrão e auditoria — com rollback total
 *      se qualquer etapa falhar (Req 3.6);
 *   3) traduz o resultado para um tipo discriminado tratável pela UI.
 *
 * A atomicidade NÃO é implementada aqui no cliente (várias chamadas separadas
 * poderiam deixar um clube parcial em caso de falha intermediária); ela mora
 * dentro da função Postgres, numa só transação (ver migration
 * 20250101000026_create_club_rpc.sql). O app apenas invoca a RPC e recebe o
 * `club_id`.
 */

/** Resultado da criação de futebol: sucesso com `clubId`, ou erro tratado. */
export type CreateClubResult =
  | { ok: true; clubId: string }
  | {
      ok: false;
      /** Classe do erro, para a UI decidir a mensagem/ação. */
      reason: "validation" | "not_approved" | "unauthenticated" | "unknown";
      /** Mensagem legível (pt-BR) para exibição. */
      message: string;
      /** Erros por campo, quando `reason = 'validation'`. */
      fieldErrors?: Record<string, string>;
    };

/**
 * Códigos de erro (SQLSTATE) emitidos pela RPC `create_club`, mapeados para a
 * classe de erro tratável pela UI. Mantê-los sincronizados com a migration.
 */
const PG_ERROR_REASON: Record<
  string,
  Extract<CreateClubResult, { ok: false }>["reason"]
> = {
  "28000": "unauthenticated", // auth.uid() nulo
  "42501": "not_approved", // president_status != 'aprovado'
};

/**
 * Cria um futebol de forma atômica a partir dos valores informados.
 *
 * @param values Valores do formulário (strings pt-BR para dinheiro/dias são
 *   aceitos e normalizados pelo schema). O logo é opcional.
 * @returns `{ ok: true, clubId }` em caso de sucesso; caso contrário um erro
 *   tratado com `reason`/`message` (e `fieldErrors` para falhas de validação).
 */
export async function createClub(
  values: CreateClubFormValues,
): Promise<CreateClubResult> {
  // 1) Validação de entrada (Zod). Falha aqui não toca o banco.
  const parsed = createClubSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "form";
      if (!fieldErrors[key]) {
        fieldErrors[key] = issue.message;
      }
    }
    return {
      ok: false,
      reason: "validation",
      message: "Verifique os dados do futebol e tente novamente.",
      fieldErrors,
    };
  }

  // 2) Chamada da RPC atômica. A sessão do usuário é propagada pelo cliente
  //    server-side; `auth.uid()` dentro da função reflete o chamador.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "create_club",
    toCreateClubRpcArgs(parsed.data),
  );

  if (error) {
    const reason = (error.code && PG_ERROR_REASON[error.code]) || "unknown";
    return {
      ok: false,
      reason,
      message:
        reason === "not_approved"
          ? "Apenas um presidente aprovado pode criar um futebol."
          : reason === "unauthenticated"
            ? "Sessão expirada. Entre novamente para criar um futebol."
            : "Não foi possível criar o futebol. Tente novamente.",
    };
  }

  // A RPC retorna o uuid do clube criado (scalar). O supabase-js devolve o
  // escalar diretamente em `data`.
  const clubId = typeof data === "string" ? data : null;
  if (!clubId) {
    return {
      ok: false,
      reason: "unknown",
      message: "Não foi possível criar o futebol. Tente novamente.",
    };
  }

  return { ok: true, clubId };
}
