/**
 * CRC16-CCITT (variante CCITT-FALSE) usado no cálculo do campo `63` (CRC)
 * do payload Pix BR Code / EMV do Banco Central (Requisito 6.3).
 *
 * Parâmetros do algoritmo:
 * - polinômio: 0x1021
 * - valor inicial: 0xFFFF
 * - sem reflexão de entrada/saída e sem XOR final (CRC-16/CCITT-FALSE).
 *
 * O CRC é calculado sobre TODO o payload, incluindo o identificador e o
 * tamanho do próprio campo CRC ("6304"), que já devem estar presentes na
 * string recebida.
 */

/** Polinômio gerador do CRC16-CCITT. */
const POLINOMIO = 0x1021;

/** Valor inicial do registrador (variante CCITT-FALSE). */
const VALOR_INICIAL = 0xffff;

/**
 * Calcula o CRC16-CCITT (CCITT-FALSE) do payload informado.
 *
 * A string é codificada como bytes UTF-8 antes do processamento. Os payloads
 * Pix já são ASCII após a normalização de nome/cidade, mas usar UTF-8 garante
 * um resultado correto mesmo que algum caractere multibyte escape.
 *
 * @param payload Payload Pix completo, incluindo o sufixo "6304".
 * @returns CRC em 4 caracteres hexadecimais maiúsculos (zero à esquerda).
 */
export function crc16ccitt(payload: string): string {
  // Codifica a string em bytes UTF-8 para processar byte a byte.
  const bytes = new TextEncoder().encode(payload);

  let crc = VALOR_INICIAL;

  for (const byte of bytes) {
    // Combina o byte atual na parte alta do registrador.
    crc ^= byte << 8;

    // Processa os 8 bits do byte.
    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x8000) !== 0) {
        crc = (crc << 1) ^ POLINOMIO;
      } else {
        crc = crc << 1;
      }

      // Mantém o registrador em 16 bits.
      crc &= 0xffff;
    }
  }

  // Formata em 4 hex maiúsculos com zero à esquerda quando necessário.
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
