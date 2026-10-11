import "server-only";

import { cookies } from "next/headers";

import { createServerClient } from "@supabase/ssr";

import {
  getPublicSupabaseConfig,
  getServiceRoleConfig,
} from "@/lib/supabase/env";

/**
 * Cliente Supabase para uso no servidor (Server Components, Server Actions,
 * Route Handlers), ligado à sessão do usuário via cookies.
 *
 * No Next.js 15 `cookies()` é assíncrono, portanto esta factory é `async`.
 * O cliente lê e escreve os cookies de sessão para manter o usuário logado.
 * A escrita de cookies em Server Components puros não é permitida; nesses
 * casos a atualização de sessão deve ocorrer no middleware — por isso o
 * `set`/`remove` é protegido com try/catch.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getPublicSupabaseConfig();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Chamado a partir de um Server Component. Pode ser ignorado quando
          // há um middleware atualizando a sessão do usuário.
        }
      },
    },
  });
}

/**
 * Cliente Supabase com a service role — SOMENTE servidor.
 *
 * Contorna a RLS e por isso deve ser usado apenas em contextos confiáveis do
 * servidor (ex.: Route Handlers de cron protegidos por `CRON_SECRET`). Não
 * depende de cookies/sessão e nunca deve ser exposto ao cliente.
 */
export function createServiceRoleClient() {
  const { url, serviceRoleKey } = getServiceRoleConfig();

  return createServerClient(url, serviceRoleKey, {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        // Sem sessão: a service role não persiste cookies.
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
