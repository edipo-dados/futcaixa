import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Helpers de Storage para o bucket privado de comprovantes de pagamento.
 *
 * O bucket `proofs` é privado (migration 20250101000008_storage_proofs.sql):
 * os arquivos NUNCA são servidos por URL pública. A leitura na UI acontece por
 * meio de uma URL assinada de curta duração, gerada no servidor.
 *
 * Convenção de caminho (path) dos objetos — ESCOPADA POR CLUBE (multi-tenant):
 *   `<club_id>/<charge_id>/<arquivo>`                  (comprovante de cobrança)
 *   `<club_id>/transactions/<...>/<arquivo>`           (comprovante de lançamento)
 *
 * O PRIMEIRO segmento é SEMPRE o `club_id` (migration 20250101000024): as
 * policies de RLS do Storage resolvem a autorização pelo primeiro segmento
 * (= club_id) via `club_role` — presidente/tesoureiro do clube podem gravar/ler
 * em qualquer caminho do clube; o jogador dono só sob a pasta da própria
 * cobrança. Os call sites (ex.: Lançamentos, tarefa 21.4) são responsáveis por
 * montar o path começando pelo `club_id` do clube ativo.
 *
 * Este módulo é SOMENTE servidor (`server-only`) e expõe helpers GENÉRICOS por
 * caminho (não assume uma convenção específica). O upload usa o cliente ligado
 * à sessão do usuário, de modo que as policies de RLS são aplicadas.
 */

/** Nome do bucket privado de comprovantes. */
export const BUCKET = "proofs";

/**
 * Gera uma URL assinada de curta duração para visualizar um comprovante.
 *
 * A URL assinada é criada no servidor e permite o acesso temporário ao objeto
 * privado sem torná-lo público. É o único caminho de leitura usado pela UI.
 *
 * @param path Caminho do objeto no bucket (ex.: `<club_id>/<charge_id>/comprovante.pdf`).
 * @param expiresInSeconds Validade da URL em segundos (padrão: 60).
 * @returns A URL assinada para acesso ao arquivo.
 * @throws Error quando a geração da URL falha ou nenhuma URL é retornada.
 */
export async function createProofSignedUrl(
  path: string,
  expiresInSeconds = 60,
): Promise<string> {
  const supabase = await createClient();

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error) {
    throw new Error(
      `Falha ao gerar URL assinada do comprovante: ${error.message}`,
    );
  }

  if (!data?.signedUrl) {
    throw new Error("URL assinada do comprovante não foi retornada.");
  }

  return data.signedUrl;
}

/**
 * Faz o upload de um comprovante para o bucket privado.
 *
 * Usa o cliente Supabase ligado à sessão do usuário, portanto as policies de
 * RLS do Storage são aplicadas: o primeiro segmento do caminho precisa ser o
 * `club_id`; presidente/tesoureiro do clube podem enviar em qualquer caminho do
 * clube, enquanto o jogador dono só sob a pasta da própria cobrança.
 *
 * @param path Caminho de destino no bucket (ex.: `<club_id>/<charge_id>/comprovante.pdf`).
 * @param file Conteúdo do arquivo (imagem ou PDF).
 * @param contentType Tipo MIME do arquivo (opcional; ex.: `application/pdf`).
 * @returns O caminho do objeto armazenado, para persistir em `payment_proofs.file_path`.
 * @throws Error quando o upload falha.
 */
export async function uploadProof(
  path: string,
  file: File | Blob,
  contentType?: string,
): Promise<string> {
  const supabase = await createClient();

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      // Evita sobrescrever um comprovante já enviado (preserva a evidência).
      upsert: false,
      ...(contentType ? { contentType } : {}),
    });

  if (error) {
    throw new Error(`Falha ao enviar o comprovante: ${error.message}`);
  }

  return data.path;
}
