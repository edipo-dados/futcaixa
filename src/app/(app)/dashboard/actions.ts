"use server";

import { getMembershipSession } from "@/lib/auth/membership";
import { BUCKET } from "@/lib/storage/proofs";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Server Actions do Dashboard.
 *
 * Tarefa 11.5 (Req 8.7): visualização dos comprovantes das "últimas despesas"
 * de transparência. Diferente dos comprovantes de pagamento de cobrança (que
 * só o dono ou um gestor pode ver), estes são comprovantes de despesas a nível
 * de CAIXA (Quadra, Goleiro, Bolas...) e, por transparência, devem poder ser
 * vistos por QUALQUER usuário autenticado — inclusive `jogador`.
 */

const PROOF_URL_TTL_SECONDS = 60;

/**
 * Gera uma URL assinada de curta duração para visualizar o comprovante de uma
 * despesa de transparência (Req 8.7 + 3.7/11.2).
 *
 * RACIOCÍNIO DE SEGURANÇA
 * -----------------------
 * As policies de Storage (migration 2.8) só liberam a leitura direta do bucket
 * privado `proofs` ao DONO da pasta (jogador) ou a gestores. Um `jogador` não
 * conseguiria, com a própria sessão, assinar o comprovante de uma despesa de
 * caixa (a pasta `transactions/...` não é dele). Para cumprir a transparência
 * (Req 8.7) sem afrouxar as policies de pagamento, esta action assina a URL com
 * o cliente de SERVICE ROLE (contorna a RLS do Storage) — o que é seguro
 * SOMENTE porque restringimos o que pode ser assinado:
 *
 *   VALIDAÇÃO: o `path` precisa corresponder a um `proof_path` presente na
 *   view `v_recent_expenses` DO FUTEBOL ATIVO (despesas de caixa não
 *   excluídas). Assim, apenas caminhos que pertencem de fato a uma despesa de
 *   transparência do clube ativo são assináveis — nunca um caminho arbitrário
 *   do bucket (ex.: a pasta `<player_id>/<charge_id>/...` de um comprovante de
 *   pagamento individual) nem o comprovante de uma despesa de OUTRO futebol.
 *
 * MULTI-TENANT (tarefa 21.8): a view `v_recent_expenses` roda como DEFINER e
 * projeta `club_id`. Como ela não aplica a RLS por tenant, a validação filtra
 * explicitamente por `club_id` do clube ativo (`.eq('club_id', clubId)`), de
 * modo que um membro do clube A não consiga assinar o comprovante de uma
 * despesa do clube B. O resultado é: transparência para o grupo do futebol
 * ativo, sem expor identidade individual nem cruzar futebóis.
 */
export async function getExpenseProofUrl(
  path: string,
): Promise<{ url: string } | { error: string }> {
  // Exige sessão válida com futebol ativo: a transparência é para membros do
  // clube ativo.
  const session = await getMembershipSession();
  if (!session) {
    return { error: "Sessão expirada. Faça login novamente." };
  }
  if (session.hasNoClub || !session.activeClub) {
    return { error: "Selecione um futebol ativo." };
  }

  if (typeof path !== "string" || path.trim() === "") {
    return { error: "Comprovante não encontrado." };
  }

  // Validação de escopo: o caminho precisa pertencer a uma despesa de
  // transparência (v_recent_expenses) DO FUTEBOL ATIVO. Isso impede assinar
  // caminhos arbitrários do bucket e cruzar futebóis.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_recent_expenses")
    .select("id")
    .eq("club_id", session.activeClub.clubId)
    .eq("proof_path", path)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (error || !data) {
    return { error: "Comprovante não encontrado." };
  }

  // Caminho validado: assina com a service role, contornando a RLS do Storage
  // apenas para este comprovante de despesa de caixa (transparência).
  try {
    const service = createServiceRoleClient();
    const { data: signed, error: signError } = await service.storage
      .from(BUCKET)
      .createSignedUrl(path, PROOF_URL_TTL_SECONDS);

    if (signError || !signed?.signedUrl) {
      return { error: "Falha ao abrir o comprovante." };
    }

    return { url: signed.signedUrl };
  } catch {
    return { error: "Falha ao abrir o comprovante." };
  }
}
