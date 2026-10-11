import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Route Handler do callback de autenticação.
 *
 * Trata DOIS formatos de retorno do Supabase Auth:
 *
 *  1. PKCE (`?code=...`) — usado pela troca de código por sessão
 *     (`exchangeCodeForSession`). Ocorre, por exemplo, em provedores OAuth e
 *     em alguns fluxos de link.
 *
 *  2. Confirmação de e-mail / OTP por link (`?token_hash=...&type=signup`) —
 *     é o formato do link enviado no e-mail de confirmação de cadastro (e de
 *     recuperação/convite). Verificamos o token com `verifyOtp`, o que cria a
 *     sessão (grava os cookies via o cliente de servidor).
 *
 * Em ambos os casos, com sucesso, redirecionamos o usuário autenticado para o
 * destino (`next`, interno) — por padrão o painel (Req 1.3). Em erro ou
 * ausência de parâmetros válidos, voltamos ao login com um marcador genérico
 * (sem vazar detalhes).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // Destino pós-login; restrito a caminhos internos (evita open redirect).
  const nextParam = searchParams.get("next");
  const next =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : "/dashboard";

  const supabase = await createClient();

  // 1) Confirmação de e-mail / OTP por link (cadastro, recuperação, convite).
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // 2) Fluxo PKCE (troca de código por sessão).
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Parâmetros ausentes/ inválidos ou falha na verificação: volta ao login.
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
