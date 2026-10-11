import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Entrar — FutCaixa",
  description: "Entre com e-mail e senha ou crie sua conta no FutCaixa.",
};

/**
 * Página de login/cadastro.
 *
 * Aceita um parâmetro `next` na query (ex.: `?next=/convite/<codigo>`), usado
 * para preservar o retorno a um destino interno após autenticar — em
 * particular, voltar à página de convite (Req 4.2). Só repassamos caminhos
 * internos (começando com `/`); o próprio Server Action revalida isso para
 * evitar open redirect.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  const next =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : undefined;

  return (
    <main className="container flex min-h-dvh items-center justify-center py-8">
      <LoginForm next={next} />
    </main>
  );
}
