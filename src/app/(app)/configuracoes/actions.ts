"use server";

import { revalidatePath } from "next/cache";

import { getMembershipSession } from "@/lib/auth/membership";
import { createClient } from "@/lib/supabase/server";
import {
  settingsSchema,
  type SettingsActionState,
  type SettingsFormValues,
  type SettingsRow,
} from "@/lib/validation/settings";

/**
 * Configurações no modelo MULTI-TENANT (tarefa 21.1).
 *
 * `settings` deixou de ser singleton (id=1) e passou a ter uma linha por
 * futebol (`club_id` UNIQUE, Req 16.4). Toda leitura e escrita é escopada ao
 * clube ATIVO da sessão (via `getMembershipSession`). A linha de settings é
 * criada atomicamente na criação do clube (RPC `create_club`), então ela
 * sempre existe para um clube ativo — o fluxo de escrita usa `update ... where
 * club_id`, nunca reintroduzindo o singleton.
 *
 * Autorização: apenas o PRESIDENTE do clube ativo edita (Req 16.3); tesoureiro
 * e jogador leem os dados (ex.: Pix) mas não editam. A RLS no Postgres é a
 * autoridade final (presidente CRUD do próprio clube; demais SELECT); as
 * checagens aqui são defesa em profundidade + mensagens claras na UX.
 */

/**
 * Carrega a linha de configurações do futebol informado (ou do clube ATIVO da
 * sessão, quando `clubId` é omitido).
 *
 * O filtro explícito por `club_id` substitui o antigo `.eq('id', 1)` do
 * singleton. A RLS garante que o usuário só enxergue settings de clubes aos
 * quais pertence; o filtro no app evita confiar apenas na política e deixa a
 * intenção explícita. Retorna `null` quando não há clube ativo ou linha.
 */
export async function loadSettings(
  clubId?: string,
): Promise<SettingsRow | null> {
  let targetClubId = clubId;

  if (!targetClubId) {
    const session = await getMembershipSession();
    targetClubId = session?.activeClub?.clubId;
  }

  if (!targetClubId) {
    return null;
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("settings")
    .select("*")
    .eq("club_id", targetClubId)
    .maybeSingle<SettingsRow>();

  if (error || !data) return null;
  return data;
}

/**
 * Server Action: salva as configurações do futebol ativo (Req 10.1, 10.2,
 * 10.3, 16.1, 16.2, 16.3).
 *
 * Apenas o PRESIDENTE do clube ativo pode executar (checagem de papel no
 * servidor + RLS). O formulário envia valores como strings (moeda pt-BR) que o
 * schema Zod transforma em centavos antes de salvar. A persistência é um
 * `update` filtrado por `club_id` (a linha já existe desde a criação do clube).
 */
export async function saveSettings(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  // ── Autorização: presidente do clube ativo (Req 16.3) ───────────────
  const session = await getMembershipSession();
  const clubId = session?.activeClub?.clubId;

  if (!clubId) {
    return {
      status: "error",
      message: "Selecione um futebol ativo para editar as configurações.",
    };
  }

  if (session?.role !== "presidente") {
    return {
      status: "error",
      message:
        "Apenas o presidente do futebol pode alterar as configurações.",
    };
  }

  // ── Extração dos campos do FormData ─────────────────────────────────
  const raw: Record<string, unknown> = {
    clubName: formData.get("clubName"),
    logoPath: formData.get("logoPath") || null,
    pixKey: formData.get("pixKey"),
    pixReceiverName: formData.get("pixReceiverName"),
    pixCity: formData.get("pixCity"),
    defaultMonthlyCents: formData.get("defaultMonthlyCents"),
    defaultDropInCents: formData.get("defaultDropInCents"),
    dueDay: formData.get("dueDay"),
    generationDay: formData.get("generationDay"),
    initialBalanceCents: formData.get("initialBalanceCents"),
  };

  // ── Validação Zod (servidor — nunca confiar só no front) ────────────
  const parsed = settingsSchema.safeParse(raw);

  if (!parsed.success) {
    const fieldErrors: Partial<Record<keyof SettingsFormValues, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof SettingsFormValues | undefined;
      if (key && !fieldErrors[key]) {
        fieldErrors[key] = issue.message;
      }
    }
    return { status: "error", message: "Corrija os campos inválidos.", fieldErrors };
  }

  const data = parsed.data;

  // ── Persistência (escopada ao clube ativo) ──────────────────────────
  const supabase = await createClient();

  const { error } = await supabase
    .from("settings")
    .update({
      club_name: data.clubName,
      logo_path: data.logoPath ?? null,
      pix_key: data.pixKey,
      pix_receiver_name: data.pixReceiverName,
      pix_city: data.pixCity,
      default_monthly_cents: data.defaultMonthlyCents,
      default_drop_in_cents: data.defaultDropInCents,
      due_day: data.dueDay,
      generation_day: data.generationDay,
      initial_balance_cents: data.initialBalanceCents,
    })
    .eq("club_id", clubId);

  if (error) {
    return {
      status: "error",
      message: `Erro ao salvar: ${error.message}`,
    };
  }

  revalidatePath("/configuracoes");

  return { status: "success", message: "Configurações salvas com sucesso." };
}

/**
 * Server Action: faz upload do logo do futebol ativo para o bucket público
 * `logos` do Supabase Storage. Retorna o caminho do arquivo no Storage.
 *
 * Multi-tenant (tarefa 21.1): o bucket `logos` é escopado por clube (migration
 * 20250101000025), com o caminho `logos/<club_id>/<arquivo>`. A policy de
 * Storage resolve o clube pelo primeiro segmento do path e exige papel de
 * gestor; aqui injetamos o `club_id` do clube ativo e restringimos a edição ao
 * presidente (Req 16.3). A leitura do logo é pública (branding).
 */
export async function uploadLogo(
  formData: FormData,
): Promise<{ path: string | null; error: string | null }> {
  const session = await getMembershipSession();
  const clubId = session?.activeClub?.clubId;

  if (!clubId) {
    return {
      path: null,
      error: "Selecione um futebol ativo para alterar o logo.",
    };
  }

  if (session?.role !== "presidente") {
    return {
      path: null,
      error: "Apenas o presidente do futebol pode alterar o logo.",
    };
  }

  const file = formData.get("logo") as File | null;
  if (!file || file.size === 0) {
    return { path: null, error: "Nenhum arquivo selecionado." };
  }

  // Validação de tipo (imagem apenas).
  const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
  if (!allowedTypes.includes(file.type)) {
    return { path: null, error: "Formato não suportado. Use PNG, JPEG, WebP ou SVG." };
  }

  // Limite de 2MB.
  const MAX_SIZE = 2 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    return { path: null, error: "O arquivo excede o limite de 2 MB." };
  }

  const ext = file.name.split(".").pop() ?? "png";
  // Caminho escopado por clube: logos/<club_id>/logo.<ext> (migration 2.25).
  const filePath = `${clubId}/logo.${ext}`;

  const supabase = await createClient();

  const { error } = await supabase.storage
    .from("logos")
    .upload(filePath, file, { upsert: true, contentType: file.type });

  if (error) {
    return { path: null, error: `Erro no upload: ${error.message}` };
  }

  // Atualiza o logo_path na linha de settings do clube ativo.
  await supabase
    .from("settings")
    .update({ logo_path: filePath })
    .eq("club_id", clubId);

  revalidatePath("/configuracoes");

  return { path: filePath, error: null };
}
