import { describe, expect, it } from "vitest";

import {
  isPixConfigured,
  validatePixConfig,
} from "@/lib/payments/pix-config";

/**
 * Testes de validação de pré-requisitos de Pix (Requisito 10.4).
 * Verificam o bloqueio quando chave/recebedor/cidade não estão configurados.
 */

const complete = {
  pix_key: "futcaixa@exemplo.com",
  pix_receiver_name: "FUTEBOL DO BAIRRO",
  pix_city: "SAO PAULO",
};

describe("validatePixConfig", () => {
  it("retorna ok com a config quando todos os campos estão presentes", () => {
    const result = validatePixConfig(complete);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config).toEqual({
        pixKey: "futcaixa@exemplo.com",
        receiverName: "FUTEBOL DO BAIRRO",
        city: "SAO PAULO",
      });
    }
  });

  it("faz trim dos valores ao montar a config", () => {
    const result = validatePixConfig({
      pix_key: "  chave@pix.com  ",
      pix_receiver_name: " Recebedor ",
      pix_city: "  Cidade  ",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config).toEqual({
        pixKey: "chave@pix.com",
        receiverName: "Recebedor",
        city: "Cidade",
      });
    }
  });

  it("bloqueia quando falta a chave Pix", () => {
    const result = validatePixConfig({ ...complete, pix_key: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual(["pix_key"]);
      expect(result.message).toContain("a chave Pix");
    }
  });

  it("bloqueia quando falta o nome do recebedor", () => {
    const result = validatePixConfig({ ...complete, pix_receiver_name: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual(["pix_receiver_name"]);
      expect(result.message).toContain("o nome do recebedor");
    }
  });

  it("bloqueia quando falta a cidade", () => {
    const result = validatePixConfig({ ...complete, pix_city: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual(["pix_city"]);
      expect(result.message).toContain("a cidade");
    }
  });

  it("trata strings vazias ou só com espaços como ausentes", () => {
    const result = validatePixConfig({
      pix_key: "   ",
      pix_receiver_name: "\t",
      pix_city: "\n ",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual([
        "pix_key",
        "pix_receiver_name",
        "pix_city",
      ]);
    }
  });

  it("trata null e undefined como ausentes", () => {
    const result = validatePixConfig({
      pix_key: null,
      pix_receiver_name: undefined,
      pix_city: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual([
        "pix_key",
        "pix_receiver_name",
        "pix_city",
      ]);
    }
  });

  it("trata objeto vazio (nenhum campo informado) como tudo ausente", () => {
    const result = validatePixConfig({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual([
        "pix_key",
        "pix_receiver_name",
        "pix_city",
      ]);
    }
  });

  it("mensagem nomeia os campos faltantes (um campo)", () => {
    const result = validatePixConfig({ ...complete, pix_city: "" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe(
        "Configure a cidade em Configurações antes de gerar cobranças Pix.",
      );
    }
  });

  it("mensagem nomeia os campos faltantes (dois campos, com 'e')", () => {
    const result = validatePixConfig({
      ...complete,
      pix_key: "",
      pix_city: "",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe(
        "Configure a chave Pix e a cidade em Configurações antes de gerar cobranças Pix.",
      );
      expect(result.message).toContain("a chave Pix");
      expect(result.message).toContain("a cidade");
    }
  });

  it("mensagem nomeia os campos faltantes (três campos, lista com vírgula e 'e')", () => {
    const result = validatePixConfig({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe(
        "Configure a chave Pix, o nome do recebedor e a cidade em Configurações antes de gerar cobranças Pix.",
      );
    }
  });
});

describe("isPixConfigured", () => {
  it("retorna true quando tudo está configurado", () => {
    expect(isPixConfigured(complete)).toBe(true);
  });

  it("retorna false quando qualquer campo falta", () => {
    expect(isPixConfigured({ ...complete, pix_key: "" })).toBe(false);
    expect(isPixConfigured({ ...complete, pix_receiver_name: null })).toBe(
      false,
    );
    expect(isPixConfigured({})).toBe(false);
  });
});
