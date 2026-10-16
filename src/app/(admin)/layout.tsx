import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList, ScrollText, Shield, Trophy } from "lucide-react";

import { getMembershipSession } from "@/lib/auth/membership";
import { resolvePlatformAdminGuard } from "@/lib/auth/platform-admin";

/**
 * Layout do grupo de rotas `(admin)` — a área de administração da PLATAFORMA
 * (tarefa 19.2; reutilizado por 19.3).
 *
 * É um Server Component que funciona como layout-guard GENÉRICO: resolve a
 * sessão multi-tenant e, usando a guarda pura `resolvePlatformAdminGuard`,
 * redireciona quem NÃO é `system_admin` (Requisitos 2.5, 17.3) — para
 * `/sem-futebol` quando o usuário não tem futebol, ou `/dashboard` caso tenha.
 * É defesa em profundidade: o middleware já protege `/admin/*`, mas a página
 * também se protege sozinha.
 *
 * O shell é propositalmente genérico (serve a Solicitações e a Futebóis): um
 * cabeçalho simples e links para as duas telas da seção 19. A autoridade real
 * de dados continua na RLS do Postgres (bypass de tenant do `system_admin`).
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getMembershipSession();
  const guard = resolvePlatformAdminGuard(session);

  if (!guard.authorized) {
    redirect(guard.redirectTo);
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b">
        <div className="container flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Shield className="size-5 text-primary" aria-hidden="true" />
            <h1 className="text-lg font-semibold tracking-tight">
              Administração da plataforma
            </h1>
          </div>
          <nav aria-label="Administração da plataforma">
            <ul className="flex items-center gap-1 text-sm">
              <li>
                <Link
                  href="/admin/solicitacoes"
                  className="inline-flex items-center gap-2 rounded-md px-3 py-2 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <ClipboardList className="size-4" aria-hidden="true" />
                  Solicitações
                </Link>
              </li>
              <li>
                <Link
                  href="/admin/futebois"
                  className="inline-flex items-center gap-2 rounded-md px-3 py-2 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Trophy className="size-4" aria-hidden="true" />
                  Futebóis
                </Link>
              </li>
              <li>
                <Link
                  href="/admin/logs"
                  className="inline-flex items-center gap-2 rounded-md px-3 py-2 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <ScrollText className="size-4" aria-hidden="true" />
                  Logs de acesso
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </header>
      <main className="container py-6">{children}</main>
    </div>
  );
}
