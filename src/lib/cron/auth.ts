import "server-only";

/**
 * Validação do segredo dos crons (`CRON_SECRET`).
 *
 * Os Route Handlers de cron (`/api/cron/*`) são endpoints públicos quanto à
 * rede, portanto precisam de uma proteção própria. A Vercel Cron envia o
 * cabeçalho `Authorization: Bearer <CRON_SECRET>` em cada disparo; aqui
 * comparamos esse valor com `process.env.CRON_SECRET`.
 *
 * Reutilizável por ambos os crons (gerar-recorrentes e gerar-mensalidades).
 */

/**
 * Verifica se a requisição carrega o `CRON_SECRET` esperado no cabeçalho
 * `Authorization` (formato `Bearer <segredo>`).
 *
 * Lança erro se `CRON_SECRET` não estiver configurado no ambiente — nunca
 * tratamos "sem segredo configurado" como autorizado, para não deixar o cron
 * aberto por engano.
 *
 * @returns `true` quando o segredo confere; `false` caso contrário.
 */
export function validateCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length === 0) {
    throw new Error(
      "CRON_SECRET não configurado. Defina a variável de ambiente para proteger os endpoints de cron.",
    );
  }

  const header = request.headers.get("authorization");
  if (!header) {
    return false;
  }

  // Aceita tanto "Bearer <segredo>" (padrão Vercel Cron) quanto o segredo cru.
  const expectedBearer = `Bearer ${secret}`;
  return header === expectedBearer || header === secret;
}
