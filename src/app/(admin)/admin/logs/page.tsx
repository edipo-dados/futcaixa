import type { Metadata } from "next";
import { LogIn, KeyRound, ScrollText } from "lucide-react";

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
  title: "Logs de acesso — FutCaixa",
  description:
    "Eventos recentes de login e reset de senha da plataforma (system_admin).",
};

// A listagem reflete o estado atual dos logs; nunca deve ser cacheada.
export const dynamic = "force-dynamic";

/** Rótulos traduzidos para cada tipo de evento auditado. */
const EVENT_LABELS: Record<string, string> = {
  login: "Login",
  password_reset: "Reset de senha",
};

/** Linha de `access_logs` com os joins de ator/alvo/clube. */
interface AccessLogRow {
  id: string;
  event_type: string;
  club_id: string | null;
  created_at: string;
  actor: { full_name: string | null } | { full_name: string | null }[] | null;
  target: { full_name: string | null } | { full_name: string | null }[] | null;
  club: { name: string | null } | { name: string | null }[] | null;
}

/**
 * Normaliza um join do PostgREST (que pode vir como objeto único ou array) e
 * devolve o nome, ou `null` quando ausente/vazio.
 */
function nameFromJoin(
  join: { full_name: string | null } | { full_name: string | null }[] | null,
): string | null {
  const row = Array.isArray(join) ? join[0] : join;
  const name = row?.full_name?.trim();
  return name && name.length > 0 ? name : null;
}

/** Normaliza o join do clube (objeto|array) e devolve o nome ou `null`. */
function clubNameFromJoin(
  join: { name: string | null } | { name: string | null }[] | null,
): string | null {
  const row = Array.isArray(join) ? join[0] : join;
  const name = row?.name?.trim();
  return name && name.length > 0 ? name : null;
}

/**
 * Tela do `system_admin`: logs de acesso (FEAT-004 — logs de login e reset de
 * senha).
 *
 * Lê `access_logs` com embedding DESAMBIGUADO das duas FKs para `profiles`
 * (`access_logs_actor_fk` e `access_logs_target_fk`) e do clube, ordenado por
 * data decrescente (100 mais recentes).
 *
 * A proteção de acesso (apenas `system_admin`) é do layout-guard do grupo
 * `(admin)`; a RLS de `access_logs` (policy select-only para `is_system_admin()`)
 * garante que esta leitura só retorna dados ao `system_admin`.
 */
export default async function LogsPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("access_logs")
    .select(
      `id, event_type, club_id, created_at, actor:profiles!access_logs_actor_fk(full_name), target:profiles!access_logs_target_fk(full_name), club:clubs(name)`,
    )
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<AccessLogRow[]>();

  const logs = data ?? [];

  return (
    <div className="space-y-4">
      <section className="space-y-4" aria-labelledby="logs-title">
        <div className="space-y-1">
          <h2 id="logs-title" className="text-xl font-semibold tracking-tight">
            Logs de acesso
          </h2>
          <p className="text-sm text-muted-foreground">
            Eventos recentes de login e reset de senha na plataforma.
          </p>
        </div>

        {logs.length === 0 ? (
          <Card>
            <CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
              <ScrollText className="size-5" aria-hidden="true" />
              <span>Nenhum evento de acesso registrado ainda.</span>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {logs.map((row) => {
              const isReset = row.event_type === "password_reset";
              const label = EVENT_LABELS[row.event_type] ?? row.event_type;
              const actorName = nameFromJoin(row.actor) ?? "Usuário sem nome";
              const targetName = nameFromJoin(row.target);
              const clubName = clubNameFromJoin(row.club);
              // O alvo só é relevante quando difere do ator (ex.: reset feito
              // pelo presidente sobre outro usuário).
              const showTarget =
                targetName !== null && targetName !== actorName;

              return (
                <li key={row.id}>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base">
                        {isReset ? (
                          <KeyRound
                            className="size-4 text-primary"
                            aria-hidden="true"
                          />
                        ) : (
                          <LogIn
                            className="size-4 text-primary"
                            aria-hidden="true"
                          />
                        )}
                        {label}
                      </CardTitle>
                      <CardDescription>
                        {actorName}
                        {showTarget ? ` → ${targetName}` : ""}
                        {clubName ? ` · ${clubName}` : ""}
                        {` · ${formatDate(row.created_at)}`}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
