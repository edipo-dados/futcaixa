import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock, Crown, Trophy } from "lucide-react";

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

import { SolicitarPresidenteForm } from "../../(onboarding)/sem-futebol/solicitar-presidente-form";

export const metadata: Metadata = {
  title: "Ser presidente — FutCaixa",
  description:
    "Solicite o papel de presidente para criar e administrar seu próprio futebol.",
};

// O estado da solicitação muda conforme o usuário age; nunca cachear.
export const dynamic = "force-dynamic";

/**
 * Página "Ser presidente" (área autenticada).
 *
 * Diferente de `/sem-futebol` (onboarding de quem não tem clube), esta página é
 * acessível a QUALQUER usuário autenticado — inclusive quem já é jogador de um
 * futebol — para pedir o papel de presidente de plataforma. Reutiliza a mesma
 * Server Action (`solicitarPresidencia`) e o mesmo formulário do onboarding.
 *
 * Estados (de `profiles.president_status`):
 *   - `none`     → CTA "Solicitar ser presidente";
 *   - `pendente` → aviso "aguardando aprovação do administrador";
 *   - `aprovado` → CTA "Criar futebol".
 *
 * A promoção para `aprovado` é exclusiva do system_admin; aqui o usuário apenas
 * abre/consulta o próprio pedido (a RLS garante o escopo ao próprio perfil).
 */
export default async function SerPresidentePage() {
  const session = await getMembershipSession();
  if (!session) {
    redirect("/login");
  }

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("president_status")
    .eq("id", session.userId)
    .maybeSingle<{ president_status: PresidentStatus }>();

  const presidentStatus: PresidentStatus = profile?.president_status ?? "none";

  return (
    <div className="container max-w-2xl py-8">
      <div className="mb-6 space-y-1">
        <h1 className="text-2xl font-bold">Ser presidente</h1>
        <p className="text-muted-foreground">
          Quer criar e administrar seu próprio futebol? Solicite o papel de
          presidente. Após a aprovação do administrador da plataforma, você
          poderá criar um futebol — sem deixar de participar dos futebóis em que
          já joga.
        </p>
      </div>

      {presidentStatus === "aprovado" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="size-5 text-primary" aria-hidden="true" />
              Presidência aprovada
            </CardTitle>
            <CardDescription>
              Sua solicitação foi aprovada. Crie um futebol para começar a gerir
              o caixa.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full sm:w-auto">
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
              pelo administrador da plataforma. Você será avisado quando for
              aprovada.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Crown className="size-5 text-primary" aria-hidden="true" />
              Quero criar um futebol
            </CardTitle>
            <CardDescription>
              Solicite o papel de presidente. Após a aprovação do administrador
              da plataforma, você poderá criar e administrar seus próprios
              futebóis.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SolicitarPresidenteForm />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
