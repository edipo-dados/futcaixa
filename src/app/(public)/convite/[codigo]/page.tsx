import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Ticket, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { resolveInvite } from "@/lib/clubs/invite";
import { getCurrentUser } from "@/lib/auth/membership";
import { createClient } from "@/lib/supabase/server";

import { EntrarForm } from "./entrar-form";

export const metadata: Metadata = {
  title: "Convite — FutCaixa",
  description: "Entre em um futebol pelo link de convite do presidente.",
};

/**
 * Página pública de convite `/convite/<codigo>` (tarefa 20.2 — Req 4.1–4.4).
 *
 * É acessível SEM login (o middleware trata `/convite` como rota pública). O
 * fluxo:
 *   1. resolve o `<codigo>` → nome do futebol via RPC `resolve_invite`
 *      (SECURITY DEFINER, sem exigir sessão). Código inválido ou clube
 *      arquivado → mensagem amigável (Req 4.1);
 *   2. visitante SEM conta → CTA para entrar/criar conta, preservando o retorno
 *      ao convite via `?next=/convite/<codigo>` (Req 4.2);
 *   3. usuário autenticado:
 *        - já é membro ATIVO deste clube → redireciona ao painel;
 *        - caso contrário → botão "Entrar neste futebol" que cria/reaproveita a
 *          membership `jogador`/`pendente` e exibe "aguardando aprovação"
 *          (Req 4.3, 4.4).
 *
 * SEGURANÇA: nada aqui concede acesso aos dados do clube. A membership nasce
 * `pendente`; a RLS no Postgres mantém os dados bloqueados até a aprovação do
 * presidente.
 */
export default async function ConvitePage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;
  const invite = await resolveInvite(codigo);

  // Convite inválido (código inexistente ou clube arquivado) ou erro de banco:
  // mesma tela amigável, sem vazar detalhes.
  if (!invite.ok) {
    return (
      <main className="container flex min-h-dvh items-center justify-center py-8">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="flex items-center justify-center gap-2">
              <Ticket className="size-5 text-muted-foreground" aria-hidden="true" />
              Convite inválido
            </CardTitle>
            <CardDescription>
              {invite.reason === "error"
                ? "Não foi possível validar o convite agora. Tente novamente em instantes."
                : "Este link de convite não é válido ou o futebol não está mais disponível. Peça um novo link ao presidente."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full">
              <Link href="/login">Ir para o início</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const { clubId, clubName } = invite;
  const nextPath = `/convite/${encodeURIComponent(codigo)}`;

  const user = await getCurrentUser();

  // Visitante sem conta: CTA para entrar/criar conta preservando o retorno ao
  // convite. O login/cadastro honram `?next=` (caminho interno seguro).
  if (!user) {
    return (
      <main className="container flex min-h-dvh items-center justify-center py-8">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="flex items-center justify-center gap-2">
              <Trophy className="size-5 text-primary" aria-hidden="true" />
              Convite para {clubName}
            </CardTitle>
            <CardDescription>
              Você foi convidado a entrar neste futebol. Entre na sua conta ou
              crie uma para participar — depois é só aguardar a aprovação do
              presidente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href={`/login?next=${encodeURIComponent(nextPath)}`}>
                Entrar ou criar conta
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  // Usuário autenticado: verifica o vínculo atual com ESTE clube.
  const supabase = await createClient();
  const { data: membership } = await supabase
    .from("memberships")
    .select("status")
    .eq("user_id", user.id)
    .eq("club_id", clubId)
    .maybeSingle<{ status: "pendente" | "ativo" | "recusado" }>();

  // Já é membro ativo → não faz sentido ficar na tela de convite.
  if (membership?.status === "ativo") {
    redirect("/dashboard");
  }

  const initialPending = membership?.status === "pendente";

  return (
    <main className="container flex min-h-dvh items-center justify-center py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2">
            <Trophy className="size-5 text-primary" aria-hidden="true" />
            Entrar em {clubName}
          </CardTitle>
          <CardDescription>
            Ao entrar, você será adicionado como jogador e aguardará a aprovação
            do presidente para acessar os dados do futebol.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EntrarForm clubId={clubId} initialPending={initialPending} />
        </CardContent>
      </Card>
    </main>
  );
}
