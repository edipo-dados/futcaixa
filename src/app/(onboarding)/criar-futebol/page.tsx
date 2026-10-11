import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Trophy } from "lucide-react";

import { getMembershipSession } from "@/lib/auth/membership";
import { createClient } from "@/lib/supabase/server";
import { type PresidentStatus } from "@/lib/validation/president";

import { CreateClubForm } from "./create-club-form";

export const metadata: Metadata = {
  title: "Criar futebol — FutCaixa",
  description:
    "Crie seu futebol informando os dados do clube, Pix e os valores padrão de cobrança.",
};

/**
 * Tela de criação de futebol (Requisito 3 — "Criar futebol").
 *
 * Pertence ao grupo `(onboarding)` porque é acessada por um usuário "sem
 * futebol" com presidência aprovada: ele ainda não tem clube ativo, então NÃO
 * pode cair no layout de `(app)` (que monta a Sidebar e assume um clube ativo).
 * O middleware trata `/criar-futebol` como rota de onboarding permitida ao
 * usuário sem clube (ver `ONBOARDING_EXTRA_PREFIXES` em `src/middleware.ts`).
 *
 * Guards (defesa em profundidade — a autoridade real é a RPC `create_club` +
 * RLS):
 *   - sem sessão            → `/login`;
 *   - já tem clube ativo    → `/dashboard` (não está "sem futebol"; evita criar
 *                             um segundo clube sem querer);
 *   - presidência != aprovado → `/sem-futebol` (só presidente aprovado cria,
 *                               Req 3; a própria RPC também recusa, mas o guard
 *                               dá uma UX melhor que o erro pós-submit).
 *
 * O `president_status` não é exposto por `getMembershipSession`, então o lemos
 * direto de `profiles` (a RLS garante que o usuário só vê o próprio).
 */
export default async function CriarFutebolPage() {
  const session = await getMembershipSession();

  // Sem sessão → login (o middleware já cobre; a página é robusta por conta).
  if (!session) {
    redirect("/login");
  }

  // Já tem futebol ativo → não está "sem futebol": vai para o dashboard. Mantemos
  // simples (um futebol por criação); criar outro clube é fluxo à parte.
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

  // Só presidente aprovado cria futebol (Req 3). Demais estados voltam ao
  // onboarding, que mostra o CTA/estado correto (solicitar / aguardando).
  if (presidentStatus !== "aprovado") {
    redirect("/sem-futebol");
  }

  return (
    <main className="container flex min-h-dvh items-start justify-center py-8">
      <div className="w-full max-w-2xl space-y-6">
        <header className="space-y-2 text-center">
          <div className="flex justify-center">
            <span
              className="flex size-12 items-center justify-center rounded-full bg-primary/10"
              aria-hidden="true"
            >
              <Trophy className="size-6 text-primary" />
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Criar futebol
          </h1>
          <p className="text-sm text-muted-foreground">
            Informe os dados do seu futebol e os valores padrão de cobrança. Você
            poderá ajustar tudo depois em Configurações.
          </p>
        </header>

        <CreateClubForm />
      </div>
    </main>
  );
}
