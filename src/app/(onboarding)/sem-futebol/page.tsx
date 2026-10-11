import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock, Crown, Ticket, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getMembershipSession } from "@/lib/auth/membership";
import { createClient } from "@/lib/supabase/server";
import { type PresidentStatus } from "@/lib/validation/president";

import { SolicitarPresidenteForm } from "./solicitar-presidente-form";

export const metadata: Metadata = {
  title: "Começar — FutCaixa",
  description:
    "Você ainda não participa de nenhum futebol. Abra um convite ou solicite ser presidente.",
};

/**
 * Tela de onboarding "sem futebol" (tarefa 19.1 — Requisitos 1.6, 2.1, 2.2).
 *
 * É o destino do middleware para um usuário autenticado SEM nenhuma membership
 * ativa. O que ela mostra depende do `profiles.president_status`:
 *
 *   - `none`     → CTA "Solicitar ser presidente" + como abrir um convite;
 *   - `pendente` → aviso "aguardando aprovação" do administrador;
 *   - `aprovado` → CTA "Criar futebol" (a tela de criação é da tarefa 20.1;
 *                  aqui apenas o estado/link).
 *
 * O estado do pedido não é exposto por `getMembershipSession`, então o lemos
 * diretamente de `profiles` (a RLS garante que o usuário só vê o próprio).
 */
export default async function SemFutebolPage() {
  const session = await getMembershipSession();

  // Sem sessão → login (defesa; o middleware já cobre, mas a página é robusta).
  if (!session) {
    redirect("/login");
  }

  // Se o usuário JÁ tem futebol, não faz sentido ficar no onboarding.
  if (!session.hasNoClub) {
    redirect("/dashboard");
  }

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("president_status")
    .eq("id", session.userId)
    .maybeSingle<{ president_status: PresidentStatus }>();

  const presidentStatus: PresidentStatus = profile?.president_status ?? "none";
  const firstName = session.fullName?.trim().split(/\s+/)[0] ?? null;

  return (
    <main className="container flex min-h-dvh items-center justify-center py-8">
      <div className="w-full max-w-md space-y-6">
        <header className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {firstName ? `Olá, ${firstName}!` : "Bem-vindo ao FutCaixa"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Você ainda não participa de nenhum futebol.
          </p>
        </header>

        {presidentStatus === "aprovado" ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="size-5 text-primary" aria-hidden="true" />
                Pronto para criar seu futebol
              </CardTitle>
              <CardDescription>
                Sua solicitação de presidente foi aprovada. Crie um futebol para
                começar a gerir o caixa.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link href="/criar-futebol">Criar futebol</Link>
              </Button>
            </CardContent>
          </Card>
        ) : presidentStatus === "pendente" ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock
                  className="size-5 text-muted-foreground"
                  aria-hidden="true"
                />
                Aguardando aprovação
              </CardTitle>
              <CardDescription>
                Sua solicitação para ser presidente foi enviada e está em análise
                pelo administrador da plataforma. Você poderá criar um futebol
                assim que for aprovada.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Recebeu um convite de um futebol? Abra o link de convite para
                entrar como jogador enquanto isso.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Crown className="size-5 text-primary" aria-hidden="true" />
                  Quero criar um futebol
                </CardTitle>
                <CardDescription>
                  Solicite o papel de presidente. Após a aprovação do
                  administrador da plataforma, você poderá criar e administrar
                  seus próprios futebóis.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SolicitarPresidenteForm />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Ticket className="size-5 text-primary" aria-hidden="true" />
                  Recebi um convite
                </CardTitle>
                <CardDescription>
                  Para entrar em um futebol existente, abra o link de convite que
                  o presidente compartilhou com você (começa com{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">
                    /convite/
                  </code>
                  ). Você entrará como jogador e aguardará a aprovação dele.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}
