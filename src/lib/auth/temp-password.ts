import "server-only";

import { randomInt } from "node:crypto";

/**
 * Geração de senha temporária para o reset de senha de um jogador (§3.5).
 *
 * O presidente dispara o reset; o servidor gera uma senha temporária aleatória
 * (via Admin API) e a mostra UMA vez ao presidente, que a repassa ao jogador.
 * O jogador entra com ela e troca por uma senha própria no portal.
 *
 * Decisões de segurança/usabilidade:
 *   - `randomInt` do módulo `node:crypto` fornece aleatoriedade
 *     criptograficamente segura e sem viés de módulo.
 *   - O alfabeto exclui caracteres ambíguos (0/O, 1/l/I) porque a senha é
 *     repassada manualmente e precisa ser fácil de transcrever.
 *   - Garantimos ao menos 1 maiúscula, 1 minúscula e 1 dígito para satisfazer
 *     políticas comuns de complexidade.
 *   - A senha NÃO é logada nem persistida por este módulo.
 */

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sem I nem O
const LOWER = "abcdefghijkmnopqrstuvwxyz"; // sem l
const DIGITS = "23456789"; // sem 0 nem 1
const ALL = UPPER + LOWER + DIGITS;

const PASSWORD_LENGTH = 12;

/** Sorteia um caractere do conjunto informado usando randomInt (sem viés). */
function pick(chars: string): string {
  return chars[randomInt(chars.length)];
}

/**
 * Gera uma senha temporária de 12 caracteres, sem ambíguos, com ao menos uma
 * maiúscula, uma minúscula e um dígito. Os caracteres são embaralhados com
 * Fisher-Yates para que as classes garantidas não fiquem sempre nas mesmas
 * posições.
 */
export function generateTempPassword(): string {
  const chars: string[] = [pick(UPPER), pick(LOWER), pick(DIGITS)];

  for (let i = chars.length; i < PASSWORD_LENGTH; i += 1) {
    chars.push(pick(ALL));
  }

  // Fisher-Yates com randomInt.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}
