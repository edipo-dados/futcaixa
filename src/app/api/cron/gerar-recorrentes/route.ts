import { NextResponse } from "next/server";

import { currentPeriod } from "@/lib/date";
import { validateCronSecret } from "@/lib/cron/auth";
import { generateRecurringForPeriod } from "@/lib/cron/gerar-recorrentes";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Route Handler para gerar lançamentos de despesas recorrentes. Disparado por
 * um agendador externo (ver docs/crons.md) com um GET + header do CRON_SECRET.
 *
 * Fluxo (design.md "Crons — decisão"):
 *  1. Valida o `CRON_SECRET` (401 se ausente/incorreto).
 *  2. Cria o cliente service-role (contorna RLS; só servidor).
 *  3. Calcula o período atual em America/Sao_Paulo.
 *  4. Gera os lançamentos pendentes de forma idempotente (Req 4.2, 4.3).
 *
 * Agendamento configurado no agendador externo (Req 13.4). Ver docs/crons.md.
 */

// Precisa do runtime Node (service-role, server-only) e nunca deve ser cacheado.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  // 1) Autorização por segredo compartilhado com o agendador externo.
  let authorized: boolean;
  try {
    authorized = validateCronSecret(request);
  } catch (error) {
    // CRON_SECRET não configurado: falha de servidor, não "não autorizado".
    const message = error instanceof Error ? error.message : "Erro de configuração.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  if (!authorized) {
    return NextResponse.json({ ok: false, error: "Não autorizado." }, { status: 401 });
  }

  // 2–4) Geração idempotente dos lançamentos recorrentes do período atual.
  try {
    const supabase = createServiceRoleClient();
    const period = currentPeriod();
    const summary = await generateRecurringForPeriod(supabase, period);

    // Resposta mínima e de tamanho fixo. Alguns agendadores externos (ex.:
    // cron-job.org) abortam com "output too large" quando a resposta passa de
    // um limite baixo; por isso devolvemos só `{ ok: true }` e registramos os
    // contadores detalhados nos logs do servidor (visíveis no Render).
    console.log("[cron:gerar-recorrentes]", JSON.stringify(summary));

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao gerar despesas recorrentes.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// A Vercel Cron dispara via GET; expomos POST também para acionamento manual.
export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
