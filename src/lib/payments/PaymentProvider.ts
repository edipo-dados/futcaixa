/**
 * Camada de pagamento plugável (Requisito 6.8).
 *
 * A interface `PaymentProvider` isola as regras de cobrança da implementação
 * concreta de pagamento. Hoje a única implementação é `StaticPixProvider`
 * (Pix estático / BR Code), mas um futuro PSP (ex.: Mercado Pago, Asaas) com
 * Pix dinâmico e confirmação por webhook poderá ser plugado sem reescrever as
 * regras de cobrança, bastando implementar esta mesma interface.
 *
 * Por isso as regras de cobrança devem depender SOMENTE desta interface, nunca
 * de uma implementação concreta.
 */

/**
 * Dados de uma cobrança a ser convertida em um meio de pagamento.
 *
 * Não inclui o contexto do recebedor (chave Pix, nome, cidade): esse contexto
 * pertence ao provider, que é construído com a `PixConfig`. Assim a assinatura
 * de `createStaticCharge` fica focada apenas na cobrança em si.
 */
export interface PaymentCharge {
  /** Valor da cobrança em centavos (inteiro). */
  amountCents: number;
  /** Identificador único da cobrança (txid). */
  txid: string;
  /** Descrição exibida/embutida no pagamento. */
  description: string;
}

/**
 * Resultado de um pagamento gerado pelo provider.
 *
 * No Pix estático, `payload` e `qrcodeData` são a mesma string: o "copia e
 * cola" também é o conteúdo usado para renderizar o QR Code. Em um PSP com Pix
 * dinâmico esses valores poderiam divergir (ex.: payload da location vs. dados
 * do QR), por isso são campos separados.
 */
export interface PaymentResult {
  /** String "copia e cola" do Pix. */
  payload: string;
  /** Conteúdo usado para renderizar o QR Code (mesmo payload no Pix estático). */
  qrcodeData: string;
}

/**
 * Contrato da camada de pagamento.
 *
 * A implementação atual (`StaticPixProvider`) apenas monta o BR Code e NÃO
 * confirma o pagamento automaticamente — a confirmação é manual (comprovante →
 * aprovação por admin/tesoureiro).
 *
 * Um futuro PSP implementaria esta interface e adicionaria capacidades de Pix
 * dinâmico, por exemplo:
 *  - `createDynamicCharge(charge): Promise<...>` — cria a cobrança no PSP; e
 *  - `handleWebhook(event): Promise<...>` — confirma o pagamento via callback.
 * Essas extensões não exigiriam mudança nas regras de cobrança, que dependem
 * somente de `createStaticCharge`.
 */
export interface PaymentProvider {
  /**
   * Cria uma cobrança estática (Pix copia e cola / QR Code) a partir dos dados
   * da cobrança. O contexto do recebedor vem do provider.
   */
  createStaticCharge(charge: PaymentCharge): PaymentResult;
}
