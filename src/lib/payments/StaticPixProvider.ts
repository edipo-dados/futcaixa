/**
 * Implementação atual da camada de pagamento: Pix estático (Requisito 6.8).
 *
 * `StaticPixProvider` monta o BR Code / EMV ("copia e cola") a partir da
 * `PixConfig` do clube (chave, recebedor, cidade) e dos dados da cobrança.
 *
 * IMPORTANTE: este provider NÃO confirma o pagamento automaticamente. O Pix
 * estático não tem webhook/retorno do banco, então a confirmação é manual: o
 * jogador anexa o comprovante e um admin/tesoureiro aprova (status
 * `em_analise` → `paga`). A substituição por um PSP com Pix dinâmico + webhook
 * é feita trocando a implementação de `PaymentProvider`, sem mexer nas regras
 * de cobrança.
 */

import { buildPixPayload } from "@/lib/payments/pix/brcode";
import type { PixConfig } from "@/lib/payments/pix-config";
import type {
  PaymentCharge,
  PaymentProvider,
  PaymentResult,
} from "@/lib/payments/PaymentProvider";

/**
 * Provider de Pix estático construído com o contexto do recebedor (`PixConfig`).
 *
 * O recebedor é fixado no construtor para que `createStaticCharge` receba
 * apenas os dados da cobrança, conforme a assinatura da interface
 * `PaymentProvider`.
 */
export class StaticPixProvider implements PaymentProvider {
  private readonly config: PixConfig;

  /**
   * @param config Configuração validada de Pix (chave, recebedor, cidade).
   *   Use `validatePixConfig` para obter uma `PixConfig` garantidamente válida
   *   antes de instanciar o provider.
   */
  constructor(config: PixConfig) {
    this.config = config;
  }

  /**
   * Monta o BR Code / EMV estático da cobrança.
   *
   * Combina o contexto do recebedor (do provider) com os dados da cobrança e
   * retorna o payload "copia e cola". Como é Pix estático, `qrcodeData` é o
   * mesmo payload — a string também alimenta a renderização do QR Code.
   *
   * @param charge Valor (centavos), txid e descrição da cobrança.
   * @returns `{ payload, qrcodeData }` com a mesma string em ambos.
   */
  createStaticCharge(charge: PaymentCharge): PaymentResult {
    const payload = buildPixPayload({
      pixKey: this.config.pixKey,
      receiverName: this.config.receiverName,
      city: this.config.city,
      amountCents: charge.amountCents,
      txid: charge.txid,
      description: charge.description,
    });

    return { payload, qrcodeData: payload };
  }
}

/**
 * Fábrica da implementação atual de `PaymentProvider`.
 *
 * Centraliza qual provider é usado hoje (Pix estático). Trocar para um PSP no
 * futuro significa alterar apenas esta função, mantendo as regras de cobrança
 * dependentes somente da interface `PaymentProvider`.
 *
 * @param config Configuração de Pix do clube.
 * @returns Uma instância de `PaymentProvider` (atualmente `StaticPixProvider`).
 */
export function createPixProvider(config: PixConfig): PaymentProvider {
  return new StaticPixProvider(config);
}
