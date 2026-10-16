"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { captureRequestMeta, recordAccessEvent } from "@/lib/auth/access-log";
import { createClient } from "@/lib/supabase/server";
import {
  loginSchema,
  signUpSchema,
  type LoginState,
} from "@/lib/validation/auth";

/**
 * Destino padrão pós-autenticação quando não há `next` válido.
 */
const DEFAULT_REDIRECT = "/dashboard";

/**
 * Resolve o destino pós-login a partir do campo `next` do formulário.
 *
 * Só aceitamos caminhos internos (que começam com uma única `/`), evitando
 * open redirect para hosts externos (ex.: `//evil.com` ou `https://...`). Isso
 * permite preservar o retorno a uma página de convite (`/convite/<codigo>`)
 * após o cadastro/login (Req 4.2).
 */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  if (next.startsWith("/") && !next.startsWith("//")) {
    return next;
  }
  return DEFAULT_REDIRECT;
}

/**
 * Autenticação por e-mail + senha (cadastro aberto).
 *
 * O FutCaixa não usa mais magic link/OTP: qualquer pessoa pode criar uma conta
 * com nome + e-mail + senha e entrar na hora. Novos usuários recebem o papel
 * `jogador` automaticamente via trigger no banco (ver migration
 * 20250101000012). Admins podem promover depois.
 *
 * O cliente de servidor (`createClient`) é ligado aos cookies, então a sessão
 * criada por `signInWithPassword`/`signUp` persiste automaticamente.
 */

/**
 * Entrar com e-mail + senha (Requisito 1.1).
 *
 * Valida o formulário, autentica no Supabase Auth e, em caso de sucesso,
 * redireciona para o painel. Em caso de credenciais inválidas, retorna uma
 * mensagem amigável — com cadastro aberto, a enumeração de usuários deixa de
 * ser uma preocupação relevante.
 */
export async function signInWithPassword(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const fieldErrors: LoginState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === "email" || key === "password") {
        fieldErrors[key] ??= issue.message;
      }
    }
    return { status: "error", intent: "signin", fieldErrors };
  }

  const { email, password } = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // Credenciais inválidas NÃO são auditadas (RF3.3): não registramos
    // tentativas falhas nem credenciais.
    return {
      status: "error",
      intent: "signin",
      message: "E-mail ou senha inválidos.",
    };
  }

  // Auditoria de LOGIN (ramo de sucesso): ator == alvo (o próprio usuário),
  // sem clube. O `await` é obrigatório porque o `redirect` abaixo interrompe o
  // fluxo; `recordAccessEvent` nunca lança, então não quebra o login.
  const id = data.user?.id;
  if (id) {
    const { ip, userAgent } = await captureRequestMeta();
    await recordAccessEvent({
      eventType: "login",
      actorUserId: id,
      targetUserId: id,
      clubId: null,
      ip,
      userAgent,
    });
  }

  // `redirect` lança internamente para interromper a execução; por isso fica
  // fora de qualquer try/catch, após a chamada de autenticação. Preserva o
  // `next` (ex.: retorno a um convite) quando for um caminho interno seguro.
  redirect(safeNext(formData.get("next")));
}

/**
 * Criar conta com nome + e-mail + senha (Requisito 1.1).
 *
 * Cria o usuário no Supabase Auth passando `full_name` nos metadados. O perfil
 * (`profiles`) com papel `jogador` é criado pelo trigger `handle_new_user`.
 *
 * Dois cenários após `signUp`:
 * 1. Confirmação de e-mail DESLIGADA no projeto → vem uma sessão → o usuário
 *    já está logado → redirecionamos para o painel. Ainda garantimos o
 *    `full_name` no perfil via upsert (o trigger já insere, mas reforçamos).
 * 2. Confirmação de e-mail LIGADA → não vem sessão → retornamos um aviso
 *    pedindo que confirme o e-mail (ou que o admin desative a confirmação).
 */
export async function signUp(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const fieldErrors: LoginState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === "fullName" || key === "email" || key === "password") {
        fieldErrors[key] ??= issue.message;
      }
    }
    return { status: "error", intent: "signup", fieldErrors };
  }

  const { fullName, email, password } = parsed.data;
  const supabase = await createClient();

  // URL base do app a partir dos headers da requisição (robusto em dev e
  // produção); fallback para NEXT_PUBLIC_APP_URL e, por fim, localhost.
  const hdrs = await headers();
  const origin =
    hdrs.get("origin") ??
    (hdrs.get("x-forwarded-proto") && hdrs.get("x-forwarded-host")
      ? `${hdrs.get("x-forwarded-proto")}://${hdrs.get("x-forwarded-host")}`
      : null) ??
    (hdrs.get("host") ? `https://${hdrs.get("host")}` : null) ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";

  // Preserva o `next` (ex.: retorno a um convite) no link de confirmação.
  const nextPath = safeNext(formData.get("next"));
  const emailRedirectTo = `${origin}/callback?next=${encodeURIComponent(nextPath)}`;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      // Link do e-mail de confirmação volta ao app via /callback (que faz
      // verifyOtp e cria a sessão).
      emailRedirectTo,
    },
  });

  if (error) {
    // E-mail já cadastrado: sugere entrar em vez de criar conta.
    const alreadyRegistered =
      error.status === 422 ||
      /already registered|already exists|user already/i.test(error.message);

    return {
      status: "error",
      intent: "signup",
      message: alreadyRegistered
        ? "Este e-mail já está cadastrado. Tente entrar com sua senha."
        : "Não foi possível criar a conta. Tente novamente.",
    };
  }

  // Cenário 1: sessão criada (confirmação de e-mail desligada) → já logado.
  if (data.session && data.user) {
    // Reforça o full_name no perfil criado pelo trigger. Não é crítico se
    // falhar (o trigger já cuidou do perfil), então ignoramos o erro.
    await supabase
      .from("profiles")
      .update({ full_name: fullName })
      .eq("id", data.user.id);

    // Preserva o `next` (ex.: retorno a um convite) quando interno e seguro.
    redirect(safeNext(formData.get("next")));
  }

  // Cenário 2: sem sessão (confirmação de e-mail ligada) → pede confirmação.
  return {
    status: "success",
    intent: "signup",
    message:
      "Conta criada! Enviamos um link de confirmação para o seu e-mail. Abra o link para ativar a conta e entrar. Verifique também a caixa de spam.",
  };
}
