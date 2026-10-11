"use server";

import { redirect } from "next/navigation";

import { createClub } from "@/lib/clubs/createClub";
import { type CreateClubFormValues } from "@/lib/validation/club";

/**
 * Estado da Server Action `criarFutebol`, consumido pela UI (useFormState).
 *
 * - `idle`  : nada enviado ainda.
 * - `error` : a criação falhou — `message` traz o motivo em pt-BR e
 *   `fieldErrors` (quando houver) aponta os campos inválidos.
 *
 * Não existe um estado `success` aqui: em caso de sucesso a action redireciona
 * para `/dashboard` (o novo clube vira o ativo) e esta função não retorna.
 */
export interface CreateClubActionState {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
}

/** Lê um campo de texto do FormData como string (vazio quando ausente). */
function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * Lê um campo de dia (1..28) do FormData como number. O schema espera `number`
 * em `dueDay`/`generationDay` (z.coerce.number). Convertendo aqui, deixamos a
 * validação de intervalo/inteiro para o Zod (`createClubSchema`), que devolve
 * um `fieldError` legível quando o valor é inválido. Campo vazio vira NaN, que
 * o schema rejeita com a mensagem apropriada.
 */
function day(formData: FormData, key: string): number {
  const raw = text(formData, key).trim();
  return raw === "" ? Number.NaN : Number(raw);
}

/**
 * Server Action: cria um futebol (Requisito 3).
 *
 * Monta `CreateClubFormValues` a partir do FormData (valores monetários e dias
 * seguem o formato aceito pelo schema — strings pt-BR / números em string) e
 * delega para `createClub`, que valida com Zod e chama a RPC atômica
 * `create_club`. O logo é omitido nesta tela (pode ser definido depois em
 * Configurações).
 *
 * Em sucesso, redireciona para `/dashboard`: com uma única membership ativa, o
 * `membership.ts` resolve automaticamente o clube recém-criado como ativo, e o
 * middleware já libera o dashboard (o usuário deixa de estar "sem futebol").
 * Em falha, devolve o estado de erro para a UI exibir mensagem/fieldErrors.
 */
export async function criarFutebol(
  _prevState: CreateClubActionState,
  formData: FormData,
): Promise<CreateClubActionState> {
  const values: CreateClubFormValues = {
    name: text(formData, "name"),
    pixKey: text(formData, "pixKey"),
    pixReceiverName: text(formData, "pixReceiverName"),
    pixCity: text(formData, "pixCity"),
    defaultMonthlyCents: text(formData, "defaultMonthlyCents"),
    defaultDropInCents: text(formData, "defaultDropInCents"),
    dueDay: day(formData, "dueDay"),
    generationDay: day(formData, "generationDay"),
    initialBalanceCents: text(formData, "initialBalanceCents"),
  };

  const result = await createClub(values);

  if (!result.ok) {
    return {
      status: "error",
      message: result.message,
      fieldErrors: result.fieldErrors,
    };
  }

  // Sucesso: o novo clube é o único (e, portanto, o ativo). Vai para o dashboard.
  // `redirect` lança internamente (NEXT_REDIRECT); nada após esta linha executa.
  redirect("/dashboard");
}
