import { redirect } from "next/navigation";

import { Sidebar } from "@/components/layout/Sidebar";
import { SessionProvider } from "@/components/session/session-provider";
import { getMembershipSession } from "@/lib/auth/membership";
import { createClient } from "@/lib/supabase/server";
import { type PresidentStatus } from "@/lib/validation/president";

/**
 * Layout da área autenticada `(app)` no modelo MULTI-TENANT (tarefa 23.1).
 *
 * Carrega a {@link getMembershipSession} no servidor (clube ativo + papel nele,
 * nunca mais de `profiles.role` — Req 5.3) e, como defesa em profundidade junto
 * ao middleware, redireciona para `/login` quando não há sessão. A sessão é
 * disponibilizada aos Client Components via `SessionProvider` e exibida pela
 * `Sidebar` (navegação lateral filtrada por papel + nome/papel/logout).
 *
 * O estado "sem futebol" NÃO é redirecionado aqui: o middleware já encaminha
 * para `/sem-futebol` as rotas internas, e cada página também se protege. Ainda
 * assim a sidebar sabe renderizar o estado de onboarding caso chegue sem clube.
 *
 * O `profiles.president_status` não é exposto por `getMembershipSession`, então
 * só o buscamos quando faz diferença para a UI: usuário "sem futebol" com
 * presidência `aprovada` → a sidebar mostra o CTA "Criar futebol".
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getMembershipSession();

  if (!session) {
    redirect("/login");
  }

  const presidentApprovedWithoutClub = session.hasNoClub
    ? await isPresidentApproved(session.userId)
    : false;

  return (
    <SessionProvider session={session}>
      <div className="flex min-h-dvh flex-col lg:flex-row">
        <Sidebar presidentApprovedWithoutClub={presidentApprovedWithoutClub} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </SessionProvider>
  );
}

/**
 * Lê `profiles.president_status` do usuário (a RLS garante que ele só vê o
 * próprio) e indica se já está `aprovado`. Usado apenas no estado "sem futebol"
 * para decidir o CTA da sidebar.
 */
async function isPresidentApproved(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("president_status")
    .eq("id", userId)
    .maybeSingle<{ president_status: PresidentStatus }>();
  return data?.president_status === "aprovado";
}
