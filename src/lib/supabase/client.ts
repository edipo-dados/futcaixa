import { createBrowserClient } from "@supabase/ssr";

import { getPublicSupabaseConfig } from "@/lib/supabase/env";

/**
 * Cliente Supabase para uso em Client Components (navegador).
 *
 * Usa `createBrowserClient` do `@supabase/ssr`, que gerencia a sessão do
 * usuário via cookies compartilhados com o servidor. Deve ser chamado apenas
 * no cliente; usa somente a chave pública (anon).
 */
export function createClient() {
  const { url, anonKey } = getPublicSupabaseConfig();
  return createBrowserClient(url, anonKey);
}
