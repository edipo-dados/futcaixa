import { describe, expect, it } from "vitest";

import type { PixConfig } from "@/lib/payments/pix-config";
import type { PaymentCharge } from "@/lib/payments/PaymentProvider";
import {
  createPixProvider,
  StaticPixProvider,
} from "@/lib/payments/StaticPixProvider";

/**
 * Testes da camada de pagamento Pix estático (Requisito 6.8).
 *
 * Verificam que `StaticPixProvider` monta um BR Code válido a partir da
 * `PixConfig` + dados da cobrança, que `payload === qrcodeData` (Pix estático)
 * e que cobranças diferentes geram payloads diferentes.
 */

const config: PixConfig = {
  pixKey: "futcaixa@exemplo.com",
  receiverName: "FUTEBOL DO BAIRRO",
  city: "SAO PAULO",
};

const charge: PaymentCharge = {
  amountCents: 2500,
  txid: "MENS202506ABC",
  description: "Mensalidade",
};

describe("StaticPixProvider.createStaticCharge", () => {
  it("retorna payload igual a qrcodeData (Pix estático)", () => {
    const provider = new StaticPixProvider(config);

    const result = provider.createStaticCharge(charge);

    expect(result.payload).toBe(result.qrcodeData);
  });

  it("gera um BR Code válido: começa com 000201 e termina com 6304 + CRC", () => {
    const provider = new StaticPixProvider(config);

    const { payload } = provider.createStaticCharge(charge);

    // Payload Format Indicator (campo 00) no início.
    expect(payload.startsWith("000201")).toBe(true);
    // Campo CRC (63) no fim: "63" + "04" (tamanho) + 4 dígitos hex.
    expect(payload).toMatch(/6304[0-9A-F]{4}$/);
  });

  it("embute a chave Pix, o txid e o valor formatado no payload", () => {
    const provider = new StaticPixProvider(config);

    const { payload } = provider.createStaticCharge(charge);

    // Chave Pix (campo 26 → subcampo 01).
    expect(payload).toContain("futcaixa@exemplo.com");
    // txid normalizado (campo 62 → subcampo 05): maiúsculas, sem símbolos.
    expect(payload).toContain("MENS202506ABC");
    // Valor em reais com duas casas (campo 54): 2500 centavos → "25.00".
    expect(payload).toContain("5405" + "25.00");
  });

  it("gera payloads diferentes para cobranças diferentes", () => {
    const provider = new StaticPixProvider(config);

    const primeira = provider.createStaticCharge(charge);
    const segunda = provider.createStaticCharge({
      amountCents: 5000,
      txid: "AVULSO202506XYZ",
      description: "Vaquinha",
    });

    expect(primeira.payload).not.toBe(segunda.payload);
  });

  it("createPixProvider retorna um provider equivalente ao StaticPixProvider", () => {
    const direto = new StaticPixProvider(config).createStaticCharge(charge);
    const viaFactory = createPixProvider(config).createStaticCharge(charge);

    expect(viaFactory.payload).toBe(direto.payload);
    expect(viaFactory.qrcodeData).toBe(direto.qrcodeData);
  });
});
