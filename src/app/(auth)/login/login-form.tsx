"use client";

import { useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type AuthIntent, type LoginState } from "@/lib/validation/auth";

import { signInWithPassword, signUp } from "./actions";

const initialState: LoginState = { status: "idle" };

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [mode, setMode] = useState<AuthIntent>("signin");
  const [signInState, signInAction] = useActionState(
    signInWithPassword,
    initialState,
  );
  const [signUpState, signUpAction] = useActionState(signUp, initialState);

  const state = mode === "signin" ? signInState : signUpState;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">FutCaixa</CardTitle>
        <CardDescription>Entre ou crie sua conta.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Abas: Entrar / Criar conta */}
        <div
          role="tablist"
          aria-label="Entrar ou criar conta"
          className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signin"}
            onClick={() => setMode("signin")}
            className={`rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "signin"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            Entrar
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signup"}
            onClick={() => setMode("signup")}
            className={`rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "signup"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            Criar conta
          </button>
        </div>

        {/* Aviso de sucesso de cadastro quando a confirmação de e-mail está
            ligada (não há sessão; o servidor não redirecionou). */}
        {state.status === "success" && state.message ? (
          <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
            <CheckCircle2
              className="mt-0.5 size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            <p>{state.message}</p>
          </div>
        ) : null}

        {/* Mensagem de erro geral (credenciais inválidas, e-mail já em uso). */}
        {state.status === "error" && state.message ? (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        ) : null}

        {mode === "signin" ? (
          <form action={signInAction} className="space-y-4" noValidate>
            {next ? <input type="hidden" name="next" value={next} /> : null}
            <div className="space-y-2">
              <Label htmlFor="signin-email">E-mail</Label>
              <Input
                id="signin-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="voce@exemplo.com"
                required
                aria-invalid={Boolean(signInState.fieldErrors?.email) || undefined}
                aria-describedby={
                  signInState.fieldErrors?.email ? "signin-email-error" : undefined
                }
              />
              {signInState.fieldErrors?.email ? (
                <p id="signin-email-error" className="text-sm text-destructive">
                  {signInState.fieldErrors.email}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="signin-password">Senha</Label>
              <Input
                id="signin-password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Sua senha"
                required
                aria-invalid={
                  Boolean(signInState.fieldErrors?.password) || undefined
                }
                aria-describedby={
                  signInState.fieldErrors?.password
                    ? "signin-password-error"
                    : undefined
                }
              />
              {signInState.fieldErrors?.password ? (
                <p
                  id="signin-password-error"
                  className="text-sm text-destructive"
                >
                  {signInState.fieldErrors.password}
                </p>
              ) : null}
            </div>
            <SubmitButton label="Entrar" pendingLabel="Entrando..." />
          </form>
        ) : (
          <form action={signUpAction} className="space-y-4" noValidate>
            {next ? <input type="hidden" name="next" value={next} /> : null}
            <div className="space-y-2">
              <Label htmlFor="signup-name">Nome</Label>
              <Input
                id="signup-name"
                name="fullName"
                type="text"
                autoComplete="name"
                autoCapitalize="words"
                placeholder="Seu nome"
                required
                aria-invalid={
                  Boolean(signUpState.fieldErrors?.fullName) || undefined
                }
                aria-describedby={
                  signUpState.fieldErrors?.fullName
                    ? "signup-name-error"
                    : undefined
                }
              />
              {signUpState.fieldErrors?.fullName ? (
                <p id="signup-name-error" className="text-sm text-destructive">
                  {signUpState.fieldErrors.fullName}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-email">E-mail</Label>
              <Input
                id="signup-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="voce@exemplo.com"
                required
                aria-invalid={Boolean(signUpState.fieldErrors?.email) || undefined}
                aria-describedby={
                  signUpState.fieldErrors?.email ? "signup-email-error" : undefined
                }
              />
              {signUpState.fieldErrors?.email ? (
                <p id="signup-email-error" className="text-sm text-destructive">
                  {signUpState.fieldErrors.email}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-password">Senha</Label>
              <Input
                id="signup-password"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="Mínimo de 6 caracteres"
                required
                aria-invalid={
                  Boolean(signUpState.fieldErrors?.password) || undefined
                }
                aria-describedby={
                  signUpState.fieldErrors?.password
                    ? "signup-password-error"
                    : undefined
                }
              />
              {signUpState.fieldErrors?.password ? (
                <p
                  id="signup-password-error"
                  className="text-sm text-destructive"
                >
                  {signUpState.fieldErrors.password}
                </p>
              ) : null}
            </div>
            <SubmitButton label="Criar conta" pendingLabel="Criando..." />
          </form>
        )}
      </CardContent>
    </Card>
  );
}
