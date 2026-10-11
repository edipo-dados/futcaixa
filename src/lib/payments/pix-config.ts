/**
 * Validação de pré-requisitos de Pix.
 *
 * Antes de gerar qualquer QR Code Pix estático (BR Code / EMV), é preciso que
 * as Configurações do clube tenham chave Pix, nome do recebedor e cidade
 * preenchidos. Sem esses dados o payload Pix fica inválido/incompleto, então
 * esta camada bloqueia a geração e orienta o admin a configurar.
 *
 * Utilitário puro (sem React), reutilizável tanto no servidor (fluxos de
 * cobrança/pagamento) quanto no cliente (tela de pagamento, task 9.4).
 *
 * Requisito coberto:
 *  - 10.4: SE a chave Pix, nome do recebedor ou cidade não estiverem
 *    configurados THEN o sistema SHALL impedir a geração de QR Code Pix e
 *    exibir uma mensagem orientando a configuração.
 */

/** Configuração mínima de Pix validada e pronta para montar o BR Code. */
export type PixConfig = {
  pixKey: string;
  receiverName: string;
  city: string;
};

/**
 * Formato de entrada tolerante: aceita a linha de settings do banco
 * (snake_case), onde os campos podem vir nulos/ausentes antes de o admin
 * preencher as Configurações.
 */
export interface PixSettingsInput {
  pix_key?: string | null;
  pix_receiver_name?: string | null;
  pix_city?: string | null;
}

/** Resultado discriminado da validação dos pré-requisitos de Pix. */
export type PixConfigResult =
  | { ok: true; config: PixConfig }
  | { ok: false; missing: string[]; message: string };

/** Rótulos pt-BR dos campos, usados na mensagem de orientação. */
const FIELD_LABELS = {
  pix_key: "a chave Pix",
  pix_receiver_name: "o nome do recebedor",
  pix_city: "a cidade",
} as const;

/**
 * Normaliza um valor possivelmente nulo/indefinido para string trimada.
 * Strings vazias ou só com espaços em branco são tratadas como ausentes.
 */
function normalize(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Monta a mensagem de orientação em pt-BR nomeando os campos faltantes.
 *
 * Exemplos:
 *  - 1 campo:  "Configure a chave Pix em Configurações antes de gerar
 *               cobranças Pix."
 *  - 2 campos: "Configure a chave Pix e a cidade em Configurações ..."
 *  - 3 campos: "Configure a chave Pix, o nome do recebedor e a cidade ..."
 */
function buildMessage(missingLabels: string[]): string {
  let fields: string;
  if (missingLabels.length === 1) {
    fields = missingLabels[0];
  } else {
    const head = missingLabels.slice(0, -1).join(", ");
    const tail = missingLabels[missingLabels.length - 1];
    fields = `${head} e ${tail}`;
  }
  return `Configure ${fields} em Configurações antes de gerar cobranças Pix.`;
}

/**
 * Valida os pré-requisitos de Pix a partir da linha de settings.
 *
 * @returns `{ ok: true, config }` quando chave, recebedor e cidade estão
 *   todos preenchidos (após trim); caso contrário `{ ok: false, missing,
 *   message }` listando os campos faltantes (nomes de coluna) e uma mensagem
 *   pt-BR de orientação.
 */
export function validatePixConfig(settings: PixSettingsInput): PixConfigResult {
  const pixKey = normalize(settings.pix_key);
  const receiverName = normalize(settings.pix_receiver_name);
  const city = normalize(settings.pix_city);

  const missing: string[] = [];
  const missingLabels: string[] = [];

  if (pixKey === "") {
    missing.push("pix_key");
    missingLabels.push(FIELD_LABELS.pix_key);
  }
  if (receiverName === "") {
    missing.push("pix_receiver_name");
    missingLabels.push(FIELD_LABELS.pix_receiver_name);
  }
  if (city === "") {
    missing.push("pix_city");
    missingLabels.push(FIELD_LABELS.pix_city);
  }

  if (missing.length > 0) {
    return { ok: false, missing, message: buildMessage(missingLabels) };
  }

  return { ok: true, config: { pixKey, receiverName, city } };
}

/**
 * Atalho booleano: `true` quando todos os pré-requisitos de Pix estão
 * configurados. Útil para habilitar/desabilitar botões na UI.
 */
export function isPixConfigured(settings: PixSettingsInput): boolean {
  return validatePixConfig(settings).ok;
}
