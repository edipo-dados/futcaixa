import { describe, expect, it } from "vitest";

import { fromCents } from "@/lib/money";
import {
  buildDelinquencyMessage,
  waMeUrl,
  type DelinquencyMessageRow,
} from "@/lib/whatsapp";

/** Linhas de exemplo reutilizadas nos testes. */
const rows: DelinquencyMessageRow[] = [
  {
    playerName: "Alice",
    playerNickname: "Lili",
    totalCents: 5000,
    monthsOverdue: 2,
  },
  {
    playerName: "Bruno",
    playerNickname: null,
    totalCents: 2500,
    monthsOverdue: 1,
  },
];

const baseParams = {
  clubName: "Pelada da Quinta",
  rows,
  pixKey: "pelada@pix.com",
  appUrl: "https://futcaixa.app",
};

describe("buildDelinquencyMessage", () => {
  it("inclui o nome do clube no cabeçalho", () => {
    const msg = buildDelinquencyMessage(baseParams);
    expect(msg).toContain("Pelada da Quinta");
  });

  it("inclui o nome (e apelido) de cada jogador", () => {
    const msg = buildDelinquencyMessage(baseParams);
    expect(msg).toContain("Alice (Lili)");
    expect(msg).toContain("Bruno");
  });

  it("inclui os valores quando hideValues é false", () => {
    const msg = buildDelinquencyMessage({ ...baseParams, hideValues: false });
    expect(msg).toContain(fromCents(5000));
    expect(msg).toContain(fromCents(2500));
  });

  it("omite os valores individuais quando hideValues é true (Req 7.4)", () => {
    const msg = buildDelinquencyMessage({ ...baseParams, hideValues: true });
    expect(msg).not.toContain(fromCents(5000));
    expect(msg).not.toContain(fromCents(2500));
    // Ainda lista nomes e meses em atraso.
    expect(msg).toContain("Alice (Lili)");
    expect(msg).toContain("2 meses em atraso");
    expect(msg).toContain("Bruno");
    expect(msg).toContain("1 mês em atraso");
  });

  it("inclui a chave Pix e o link do sistema", () => {
    const msg = buildDelinquencyMessage(baseParams);
    expect(msg).toContain("pelada@pix.com");
    expect(msg).toContain("https://futcaixa.app");
  });

  it("omite a linha de link quando appUrl é vazio/ausente", () => {
    const msg = buildDelinquencyMessage({ ...baseParams, appUrl: "" });
    expect(msg).not.toContain("Acesse o sistema");
  });

  it("pluraliza meses corretamente (1 mês vs N meses)", () => {
    const msg = buildDelinquencyMessage({
      clubName: "Clube",
      rows: [
        { playerName: "Um", totalCents: 100, monthsOverdue: 1 },
        { playerName: "Dois", totalCents: 200, monthsOverdue: 3 },
      ],
      pixKey: "k",
    });
    expect(msg).toContain("1 mês em atraso");
    expect(msg).toContain("3 meses em atraso");
  });

  it("é determinística: mesma entrada, mesma saída", () => {
    expect(buildDelinquencyMessage(baseParams)).toBe(
      buildDelinquencyMessage(baseParams),
    );
  });

  it("trata lista vazia com mensagem de 'tudo em dia'", () => {
    const msg = buildDelinquencyMessage({ ...baseParams, rows: [] });
    expect(msg).toContain("Ninguém em atraso");
  });
});

describe("waMeUrl", () => {
  it("monta a URL wa.me com o texto codificado", () => {
    const url = waMeUrl("Olá mundo & cia");
    expect(url).toBe(
      `https://wa.me/?text=${encodeURIComponent("Olá mundo & cia")}`,
    );
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
  });

  it("codifica quebras de linha e caracteres especiais", () => {
    const message = buildDelinquencyMessage(baseParams);
    const url = waMeUrl(message);
    // Decodificar de volta recupera a mensagem original.
    const decoded = decodeURIComponent(url.replace("https://wa.me/?text=", ""));
    expect(decoded).toBe(message);
    // Não contém quebras de linha cruas (devem estar codificadas como %0A).
    expect(url).not.toContain("\n");
    expect(url).toContain("%0A");
  });
});
