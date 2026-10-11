import { describe, expect, it } from "vitest";

import {
  ALLOWED_PROOF_TYPES,
  PROOF_MAX_BYTES,
  safeProofFileName,
  validateProofFile,
} from "./proof";

/**
 * Testes da validação de comprovante de pagamento (tarefa 9.5, Req 6.5).
 *
 * Cobre o núcleo funcional: aceitação de imagem/PDF, rejeição por tipo e por
 * tamanho (≤ 5 MB), ausência de arquivo e a normalização do nome do arquivo
 * para um caminho seguro no Storage. A integração com o banco/Storage vive na
 * Server Action e não é coberta aqui.
 */

/** Cria um `File` falso com tamanho controlado sem alocar os bytes reais. */
function fakeFile(name: string, type: string, size: number): File {
  const file = new File(["x"], name, { type });
  // Sobrescreve `size` para simular arquivos grandes sem gastar memória.
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("validateProofFile", () => {
  it("aceita cada tipo permitido (imagem e PDF)", () => {
    for (const type of ALLOWED_PROOF_TYPES) {
      const file = fakeFile("comprovante", type, 1024);
      const result = validateProofFile(file);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.file).toBe(file);
      }
    }
  });

  it("rejeita quando nenhum arquivo é anexado", () => {
    const result = validateProofFile(null);
    expect(result).toEqual({
      ok: false,
      error: "Anexe um comprovante (imagem ou PDF).",
    });
  });

  it("rejeita um arquivo vazio (size 0)", () => {
    const empty = fakeFile("vazio.pdf", "application/pdf", 0);
    const result = validateProofFile(empty);
    expect(result.ok).toBe(false);
  });

  it("rejeita valores que não são File", () => {
    expect(validateProofFile("nao-e-arquivo").ok).toBe(false);
    expect(validateProofFile(undefined).ok).toBe(false);
    expect(validateProofFile(123).ok).toBe(false);
  });

  it("rejeita um tipo não permitido", () => {
    const file = fakeFile("planilha.csv", "text/csv", 1024);
    const result = validateProofFile(file);
    expect(result).toEqual({
      ok: false,
      error: "O comprovante deve ser uma imagem (JPG, PNG, WebP) ou PDF.",
    });
  });

  it("aceita exatamente no limite de tamanho (5 MB)", () => {
    const file = fakeFile("limite.png", "image/png", PROOF_MAX_BYTES);
    expect(validateProofFile(file).ok).toBe(true);
  });

  it("rejeita acima do limite de tamanho", () => {
    const file = fakeFile("grande.png", "image/png", PROOF_MAX_BYTES + 1);
    const result = validateProofFile(file);
    expect(result).toEqual({
      ok: false,
      error: "O comprovante deve ter no máximo 5 MB.",
    });
  });
});

describe("safeProofFileName", () => {
  it("mantém nomes já seguros", () => {
    expect(safeProofFileName("comprovante.pdf")).toBe("comprovante.pdf");
  });

  it("substitui espaços e caracteres especiais por _", () => {
    expect(safeProofFileName("Comprovante Pix.pdf")).toBe(
      "Comprovante_Pix.pdf",
    );
  });

  it("normaliza acentos para um caminho seguro (sem caracteres fora de [\\w.-])", () => {
    // NFKD separa o diacrítico da letra base; o combinante vira `_`. O
    // resultado é seguro para o Storage (só `[\w.-]`), que é o objetivo.
    const result = safeProofFileName("recibo-ação.png");
    expect(result).toMatch(/^[\w.\-]+$/);
    expect(result.startsWith("recibo-ac")).toBe(true);
    expect(result.endsWith(".png")).toBe(true);
  });

  it("colapsa underscores repetidos e apara as bordas", () => {
    expect(safeProofFileName("  a   b  .jpg")).toBe("a_b_.jpg");
  });

  it("usa um nome padrão quando o resultado ficaria vazio", () => {
    expect(safeProofFileName("@@@")).toBe("comprovante");
    expect(safeProofFileName("")).toBe("comprovante");
  });
});
