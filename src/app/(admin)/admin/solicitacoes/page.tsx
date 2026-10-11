import type { Metadata } from "next";
import { CheckCircle2, Inbox, XCircle } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDate } from "@/lib/date";
import { createClient } from "@/lib/supabase/server";

import { RevisarPresidenteForm } from "./revisar-presidente-form";

export const metadata: Metadata = {
  title: "Solicitações de presidente — FutCaixa",
  description:
    "Aprovar ou recusar solicitações de presidência da plataforma (system_admin).",
};

// A listagem reflete o estado atual das solicitações; nunca deve ser cacheada.
export const dynamic = "force-dynamic";

/** Linha de solicitação PENDENTE (perfis com `president_status='pendente'`). */
interface PendingRow {
  id: string;
  full_name: string | null;
}

/** Linha do histórico (solicitações já revisadas em `president_requests`). */
interface HistoryRow {
  id: string;
  user_id: string;
  status: "aprovado" | "recusado";
  reviewed_at: string | null;
  note: string | null;
  profiles: { full_name: string | null } | { full_name: string | null }[] | null;
}

/** Normaliza o join `profiles` (Supabase pode devolver objeto ou array). */
function nameFromJoin(row: HistoryRow): string {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const name = profile?.full_name?.trim();
  return name && name.length > 0 ? name : "Usuário sem nome";
}

/**
 * Tela do `system_admin`: solicitações de presidente (tarefa 19.2 —
 * Requisitos 2.3, 2.4, 2.5, 2.6, 17.3).
 *
 * Duas seções:
 *   - PENDENTES: usuários com `profiles.president_status='pendente'`, cada um
 *     com os botões Aprovar/Recusar (Server Actions);
 *   - HISTÓRICO: linhas de `president_requests` já revisadas (aprovado/recusado),
 *     com quem foi revisado e quando — a trilha da revisão.
 *
 * A proteção de acesso (apenas `system_admin`) é do layout-guard do grupo
 * `(admin)`; a RLS garante que estas leituras só retornam dados ao `system_admin`
 * (Req 17.3).
 */
export default async function SolicitacoesPage() {
  const supabase = await createClient();

  const [pendingResult, historyResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("president_status", "pendente")
      .order("full_name", { ascending: true })
      .returns<PendingRow[]>(),
    supabase
      .from("president_requests")
      .select("id, user_id, status, reviewed_at, note, profiles(full_name)")
      .in("status", ["aprovado", "recusado"])
      .order("reviewed_at", { ascending: false })
      .returns<HistoryRow[]>(),
  ]);

  const pending = pendingResult.data ?? [];
  const history = historyResult.data ?? [];

  return (
    <div className="space-y-8">
      <section className="space-y-4" aria-labelledby="pendentes-title">
        <div className="space-y-1">
          <h2 id="pendentes-title" className="text-xl font-semibold tracking-tight">
            Solicitações pendentes
          </h2>
          <p className="text-sm text-muted-foreground">
            Usuários que pediram para ser presidente e aguardam sua revisão.
          </p>
        </div>

        {pending.length === 0 ? (
          <Card>
            <CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
              <Inbox className="size-5" aria-hidden="true" />
              <span>Nenhuma solicitação pendente no momento.</span>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {pending.map((row) => (
              <li key={row.id}>
                <Card>
                  <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-medium">
                      {row.full_name?.trim() || "Usuário sem nome"}
                    </span>
                    <RevisarPresidenteForm userId={row.id} />
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="historico-title">
        <div className="space-y-1">
          <h2 id="historico-title" className="text-xl font-semibold tracking-tight">
            Histórico de revisões
          </h2>
          <p className="text-sm text-muted-foreground">
            Solicitações já aprovadas ou recusadas.
          </p>
        </div>

        {history.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-muted-foreground">
              Ainda não há solicitações revisadas.
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {history.map((row) => {
              const approved = row.status === "aprovado";
              return (
                <li key={row.id}>
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-base">
                        {approved ? (
                          <CheckCircle2
                            className="size-4 text-primary"
                            aria-hidden="true"
                          />
                        ) : (
                          <XCircle
                            className="size-4 text-destructive"
                            aria-hidden="true"
                          />
                        )}
                        {nameFromJoin(row)}
                      </CardTitle>
                      <CardDescription>
                        {approved ? "Aprovada" : "Recusada"}
                        {row.reviewed_at
                          ? ` em ${formatDate(row.reviewed_at)}`
                          : ""}
                      </CardDescription>
                    </CardHeader>
                    {row.note ? (
                      <CardContent className="pt-0 text-sm text-muted-foreground">
                        {row.note}
                      </CardContent>
                    ) : null}
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
