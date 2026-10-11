import type { Metadata } from "next";
import { Archive, Trophy } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDate } from "@/lib/date";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Futebóis — FutCaixa",
  description:
    "Listagem de todos os futebóis cadastrados na plataforma (system_admin).",
};

// A listagem reflete o estado atual dos clubes; nunca deve ser cacheada.
export const dynamic = "force-dynamic";

/** Linha de clube (um "futebol" = um tenant). */
interface ClubRow {
  id: string;
  name: string;
  slug: string | null;
  invite_code: string;
  created_at: string;
  deleted_at: string | null;
}

/**
 * Tela do `system_admin`: listar todos os futebóis (tarefa 19.3 —
 * Requisitos 2.3, 6.7).
 *
 * Um SELECT simples em `clubs` retorna TODOS os clubes porque, logado como
 * `system_admin`, a policy `clubs_select` concede bypass de tenant via
 * `is_system_admin()`. A autoridade real está na RLS do Postgres; o
 * layout-guard do grupo `(admin)` já barra quem não é `system_admin` (defesa
 * em profundidade; Req 6.7).
 *
 * Clubes arquivados (soft delete) continuam visíveis aqui, marcados com um
 * selo "Arquivado" (`deleted_at` não nulo), para que o administrador tenha a
 * visão completa da plataforma.
 */
export default async function FuteboisPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("clubs")
    .select("id, name, slug, invite_code, created_at, deleted_at")
    .order("created_at", { ascending: false })
    .returns<ClubRow[]>();

  const clubs = data ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Futebóis</h2>
        <p className="text-sm text-muted-foreground">
          Todos os futebóis cadastrados na plataforma.
        </p>
      </div>

      {clubs.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
            <Trophy className="size-5" aria-hidden="true" />
            <span>Nenhum futebol cadastrado ainda.</span>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clubs.map((club) => {
            const archived = club.deleted_at !== null;
            return (
              <li key={club.id}>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center justify-between gap-2 text-base">
                      <span className="flex items-center gap-2">
                        <Trophy
                          className="size-4 text-primary"
                          aria-hidden="true"
                        />
                        {club.name}
                      </span>
                      {archived ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          <Archive className="size-3" aria-hidden="true" />
                          Arquivado
                        </span>
                      ) : null}
                    </CardTitle>
                    <CardDescription>
                      Criado em {formatDate(club.created_at)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">
                      Código de convite:
                    </span>{" "}
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {club.invite_code}
                    </code>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
