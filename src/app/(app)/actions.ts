"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Server Action de logout.
 *
 * Encerra a sessão no Supabase Auth (`signOut`), o que limpa os cookies de
 * sessão, e então redireciona para a tela de login. Como roda numa Server
 * Action (contexto que pode gravar cookies), o `signOut` consegue remover os
 * cookies corretamente — diferente de um Server Component puro.
 */
export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
