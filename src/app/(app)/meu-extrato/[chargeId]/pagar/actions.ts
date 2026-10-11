"use server";

import { revalidatePath } from "next/cache";

import { getMembershipSession, hasClubRole } from "@/lib/auth/membership";
import { createClient } from "@/lib/supabase/server";
import { uploadProof } from "@/lib/storage/proofs";
import {
  type ProofSubmitActionState,
  type ProofChargeRow,
  safeProofFileName,
  validateProofFile,
} from "@/lib/validation/proof";

/**
 * Server Action de envio de comprovante de pagamento (tarefa 9.5, Req 6.5).
 *
 * MULTI-TENANT (tarefa 21.8): a cobrança é carregada escopada ao futebol ATIVO
 * (`.eq('club_id', clubId)`) e a titularidade é checada contra o `player_id`
 * do próprio usuário NO CLUBE ATIVO (`session.playerId`, equivalente a
 * `my_player_id(club_id)`). Papéis vêm das memberships (`presidente`/
 * `tesoureiro`), não mais de `profiles`. Nenhuma operação cruza futebóis.
 *
 * Fluxo (QUANDO o jogador anexa um comprovante — imagem ou PDF):
 *  1. Autenticação: precisa haver sessão com futebol ativo.
 *  2. Carrega a cobrança do CLUBE ATIVO pelo cliente ligado à sessão. A RLS
 *     garante que um `jogador` só enxerga as próprias cobranças;
 *     presidente/tesoureiro veem as do clube. Além da RLS, revalidamos aqui que
 *     a cobrança pertence ao jogador atual (defesa em profundidade) OU que o
 *     usuário é presidente/tesoureiro do clube ativo.
 *  3. Valida o arquivo: tipo (JPG, PNG, WebP ou PDF) e tamanho (≤ 5 MB). SE o
 *     arquivo for inválido, retorna erro amigável e NÃO altera o status da
 *     cobrança (uma falha de upload não pode mudar o estado — Req 6.5).
 *  4. Monta o caminho `<club_id>/<charge_id>/<arquivo>` — o primeiro segmento
 *     precisa ser o `club_id` para a policy de RLS do Storage multi-tenant
 *     autorizar o upload do jogador dono (migration 20250101000024). Faz o
 *     upload via `uploadProof`.
 *  5. Insere a linha em `payment_proofs` (status `em_analise`, `uploaded_by`).
 *  6. Atualiza o status da cobrança para `em_analise` — apenas quando o status
 *     atual é `pendente` ou já `em_analise`; nunca mexe em `paga`/`cancelada`.
 *
 * Todas as mutações usam o cliente de sessão (`createClient`), de modo que a
 * RLS do Storage e das tabelas, além dos triggers de auditoria (Req 6.6/11.3),
 * sejam aplicados.
 *
 * A aprovação/rejeição do comprovante por admin/tesoureiro é a tarefa 9.6 e NÃO
 * é tratada aqui.
 */

/** Status da cobrança que ainda permitem receber um comprovante. */
const SUBMITTABLE_STATUSES = new Set<ProofChargeRow["status"]>([
  "pendente",
  "em_analise",
]);

/** Lê e valida o id da cobrança vindo do FormData. */
function readChargeId(formData: FormData): string | null {
  const id = formData.get("chargeId");
  if (typeof id !== "string" || id.trim() === "") return null;
  return id.trim();
}

/**
 * Carrega a cobrança (não excluída) do CLUBE ATIVO necessária para o envio do
 * comprovante. O filtro por `club_id` impede carregar/submeter comprovante para
 * cobrança de outro futebol.
 */
async function loadCharge(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clubId: string,
  chargeId: string,
): Promise<ProofChargeRow | null> {
  const { data, error } = await supabase
    .from("charges")
    .select("id, player_id, status")
    .eq("club_id", clubId)
    .eq("id", chargeId)
    .is("deleted_at", null)
    .maybeSingle<ProofChargeRow>();

  if (error || !data) return null;
  return data;
}

export async function submitProof(
  _prevState: ProofSubmitActionState,
  formData: FormData,
): Promise<ProofSubmitActionState> {
  // 1. Autenticação.
  const session = await getMembershipSession();
  if (!session) {
    return {
      status: "error",
      message: "Sessão expirada. Faça login novamente.",
    };
  }
  if (session.hasNoClub || !session.activeClub) {
    return {
      status: "error",
      message: "Selecione um futebol ativo para enviar o comprovante.",
    };
  }
  const clubId = session.activeClub.clubId;

  const chargeId = readChargeId(formData);
  if (!chargeId) {
    return { status: "error", message: "Cobrança não identificada." };
  }

  const supabase = await createClient();

  // 2. Carrega a cobrança do CLUBE ATIVO (a RLS já filtra o que cada papel
  //    enxerga; o filtro por club_id impede cruzar futebóis).
  const charge = await loadCharge(supabase, clubId, chargeId);
  if (!charge) {
    return { status: "error", message: "Cobrança não encontrada." };
  }

  // Defesa em profundidade: o jogador só envia comprovante da própria cobrança
  // (titularidade pelo player_id do clube ativo); presidente/tesoureiro podem
  // enviar por qualquer cobrança do clube.
  const isManager = hasClubRole(session, "presidente", "tesoureiro");
  if (!isManager && charge.player_id !== session.playerId) {
    return {
      status: "error",
      message: "Você não pode enviar comprovante para esta cobrança.",
    };
  }

  // Estados terminais não recebem comprovante.
  if (!SUBMITTABLE_STATUSES.has(charge.status)) {
    return {
      status: "error",
      message:
        charge.status === "paga"
          ? "Esta cobrança já está paga."
          : "Esta cobrança foi cancelada e não aceita comprovante.",
    };
  }

  // 3. Valida o arquivo ANTES de qualquer efeito colateral. Um arquivo inválido
  //    não pode mudar o status da cobrança (Req 6.5).
  const file = formData.get("proof");
  const validation = validateProofFile(file);
  if (!validation.ok) {
    return { status: "error", message: validation.error };
  }
  const proof = validation.file;

  // 4. Caminho: primeiro segmento = club_id (exigência da RLS do Storage
  //    multi-tenant, migration 20250101000024): `<club_id>/<charge_id>/...`. A
  //    policy autoriza o upload do jogador dono da cobrança no clube ativo.
  const path = `${clubId}/${charge.id}/${safeProofFileName(proof.name)}`;

  let filePath: string;
  try {
    filePath = await uploadProof(path, proof, proof.type || undefined);
  } catch (err) {
    // Falha de upload: NÃO altera o status da cobrança (Req 6.5).
    return {
      status: "error",
      message:
        err instanceof Error ? err.message : "Falha ao enviar o comprovante.",
    };
  }

  // 5. Registra o comprovante (status default 'em_analise').
  const { error: insertError } = await supabase.from("payment_proofs").insert({
    charge_id: charge.id,
    file_path: filePath,
    uploaded_by: session.userId,
    status: "em_analise",
  });

  if (insertError) {
    return {
      status: "error",
      message: `Falha ao registrar o comprovante: ${insertError.message}`,
    };
  }

  // 6. Move a cobrança para `em_analise` (somente de pendente/em_analise). O
  //    WHERE em `status in (...)` protege contra corrida com paga/cancelada.
  const { error: updateError } = await supabase
    .from("charges")
    .update({ status: "em_analise" })
    .eq("id", charge.id)
    .in("status", ["pendente", "em_analise"])
    .is("deleted_at", null);

  if (updateError) {
    return {
      status: "error",
      message: `Comprovante enviado, mas falhou ao atualizar o status: ${updateError.message}`,
    };
  }

  revalidatePath(`/meu-extrato/${charge.id}/pagar`);
  revalidatePath("/meu-extrato");
  return {
    status: "success",
    message: "Comprovante enviado. Aguardando análise.",
  };
}
