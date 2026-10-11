/**
 * Montagem do payload Pix BR Code / EMV estático (Requisitos 6.1 e 6.2).
 *
 * O payload segue o formato TLV (Type-Length-Value) do padrão EMV adotado
 * pelo Banco Central: cada campo é `ID` (2 dígitos) + `tamanho` (2 dígitos,
 * zero à esquerda) + `valor`. Alguns campos (26 e 62) são compostos, ou seja,
 * seu valor é uma concatenação de outros campos TLV aninhados.
 *
 * Campos montados (nesta ordem):
 *  - 00 Payload Format Indicator = "01"
 *  - 26 Merchant Account Information: 00="br.gov.bcb.pix", 01=<chave Pix>,
 *       02=<descrição> (opcional)
 *  - 52 Merchant Category Code = "0000"
 *  - 53 Transaction Currency = "986" (BRL)
 *  - 54 Transaction Amount (ex.: "25.00")
 *  - 58 Country Code = "BR"
 *  - 59 Merchant Name (recebedor), normalizado, até 25 chars
 *  - 60 Merchant City, normalizada, até 15 chars
 *  - 62 Additional Data Field: 05=<txid>
 *  - 63 CRC16 (calculado por último sobre todo o payload incluindo "6304")
 *
 * O resultado é a string "copia e cola", que também alimenta a geração do
 * QR Code.
 */

import { crc16ccitt } from "@/lib/payments/pix/crc16";

/** Parâmetros necessários para montar o BR Code / EMV estático. */
export interface BuildPixParams {
  /** Chave Pix do recebedor (e-mail, telefone, CPF/CNPJ ou chave aleatória). */
  pixKey: string;
  /** Nome do recebedor; será normalizado e truncado para 25 chars. */
  receiverName: string;
  /** Cidade do recebedor; será normalizada e truncada para 15 chars. */
  city: string;
  /** Valor da cobrança em centavos (inteiro). */
  amountCents: number;
  /** Identificador único da cobrança; normalizado e truncado para 25 chars. */
  txid: string;
  /** Descrição opcional incluída no campo 26 (subcampo 02), se couber. */
  description?: string;
}

/** Limite de caracteres do nome do recebedor (campo 59). */
export const RECEIVER_NAME_MAX = 25;

/** Limite de caracteres da cidade (campo 60). */
export const CITY_MAX = 15;

/** Limite de caracteres do txid (campo 62 → subcampo 05). */
export const TXID_MAX = 25;

/**
 * Monta um campo TLV: `id` + tamanho (2 dígitos, zero à esquerda) + `valor`.
 *
 * O tamanho é o número de caracteres de `valor`. Como todos os valores são
 * ASCII após a normalização, o comprimento em caracteres equivale ao número
 * de bytes esperado pelo padrão.
 *
 * @param id Identificador de 2 dígitos do campo (ex.: "00", "26").
 * @param value Valor do campo (pode ser outro TLV, no caso dos compostos).
 * @returns Campo TLV concatenado (ex.: tlv("00", "01") === "000201").
 */
export function tlv(id: string, value: string): string {
  const length = value.length.toString().padStart(2, "0");
  return `${id}${length}${value}`;
}

/**
 * Normaliza um texto para o BR Code: remove acentos (decomposição NFD +
 * descarte dos diacríticos), converte para maiúsculas, mantém apenas os
 * caracteres permitidos (A-Z, 0-9 e espaço) e remove espaços nas pontas.
 *
 * Mantém compatibilidade entre bancos, que costumam rejeitar acentos e
 * símbolos no nome do recebedor e na cidade.
 *
 * @param value Texto de origem (pode conter acentos, minúsculas, símbolos).
 * @returns Texto normalizado em ASCII maiúsculo.
 */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD") // separa letras base dos acentos
    .replace(/[\u0300-\u036f]/g, "") // remove os diacríticos
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "") // mantém apenas letras, dígitos e espaço
    .replace(/\s+/g, " ") // colapsa espaços repetidos
    .trim();
}

/**
 * Trunca um texto para o comprimento máximo informado, removendo espaços nas
 * pontas após o corte (evita terminar em espaço solto).
 *
 * @param value Texto já normalizado.
 * @param max Comprimento máximo permitido.
 * @returns Texto truncado.
 */
export function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return value.slice(0, max).trim();
}

/**
 * Formata o valor (em centavos) no padrão do campo 54: duas casas decimais
 * com ponto como separador decimal e sem separador de milhar.
 *
 * @param amountCents Valor em centavos (inteiro).
 * @returns Valor formatado (ex.: 2500 → "25.00", 99 → "0.99").
 */
export function formatAmount(amountCents: number): string {
  return (amountCents / 100).toFixed(2);
}

/**
 * Monta o payload Pix BR Code / EMV estático completo, com o campo CRC16 (63)
 * calculado por último sobre todo o payload (incluindo "6304").
 *
 * @param params Dados do recebedor, valor, txid e descrição opcional.
 * @returns String "copia e cola" pronta para exibição e geração de QR Code.
 */
export function buildPixPayload(params: BuildPixParams): string {
  const { pixKey, receiverName, city, amountCents, txid, description } = params;

  // Campo 26 (composto): GUI fixo + chave Pix + descrição opcional.
  const merchantAccountParts = [
    tlv("00", "br.gov.bcb.pix"),
    tlv("01", pixKey),
  ];

  if (description) {
    const normalizedDescription = normalizeText(description);
    // Só inclui a descrição se, após normalizar, ainda houver conteúdo.
    if (normalizedDescription.length > 0) {
      merchantAccountParts.push(tlv("02", normalizedDescription));
    }
  }

  const merchantAccountInfo = merchantAccountParts.join("");

  // Nome e cidade normalizados e truncados aos limites do padrão.
  const normalizedName = truncate(normalizeText(receiverName), RECEIVER_NAME_MAX);
  const normalizedCity = truncate(normalizeText(city), CITY_MAX);

  // txid normalizado (apenas ASCII permitido) e truncado a 25 chars.
  const normalizedTxid = truncate(normalizeText(txid), TXID_MAX);

  // Campo 62 (composto): subcampo 05 = txid.
  const additionalData = tlv("05", normalizedTxid);

  // Monta todos os campos na ordem do padrão, exceto o CRC (63).
  const payloadSemCrc =
    tlv("00", "01") +
    tlv("26", merchantAccountInfo) +
    tlv("52", "0000") +
    tlv("53", "986") +
    tlv("54", formatAmount(amountCents)) +
    tlv("58", "BR") +
    tlv("59", normalizedName) +
    tlv("60", normalizedCity) +
    tlv("62", additionalData);

  // O CRC cobre o payload inteiro + o prefixo "6304" do próprio campo CRC.
  const comPrefixoCrc = `${payloadSemCrc}6304`;
  const crc = crc16ccitt(comPrefixoCrc);

  return `${comPrefixoCrc}${crc}`;
}
