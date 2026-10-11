/**
 * Leitura e validação centralizada das variáveis de ambiente do Supabase.
 *
 * As variáveis `NEXT_PUBLIC_*` são expostas ao cliente; a service role
 * (`SUPABASE_SERVICE_ROLE_KEY`) é SOMENTE do servidor e nunca deve ser
 * importada em código que roda no navegador.
 */

function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Variável de ambiente ausente: ${name}. Confira o arquivo .env.example e defina-a no seu .env.local.`,
    );
  }
  return value;
}

/** Configuração pública (segura para o cliente): URL + chave anônima. */
export function getPublicSupabaseConfig() {
  return {
    url: requireEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    anonKey: requireEnv(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  };
}

/**
 * Configuração privilegiada (service role) — SOMENTE servidor.
 * Usada por rotas de cron e operações administrativas que precisam contornar
 * a RLS. Nunca exponha essa chave ao cliente.
 */
export function getServiceRoleConfig() {
  return {
    url: requireEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    serviceRoleKey: requireEnv(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
  };
}
