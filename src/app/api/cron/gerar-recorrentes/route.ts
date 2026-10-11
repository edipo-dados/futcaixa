import { NextResponse } from "next/server";

import { currentPeriod } from "@/lib/date";
import { validateCronSecret } from "@/lib/cron/auth";
import { generateRecurringForPeriod } from "@/lib/cron/gerar-recorrentes";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Route Handler (Vercel Cron) para gerar lançamentos de despesas recorrentes.
 *
 * Fluxo (design.md "Crons — decisão"):
 *  1. Valida o `CRON_SECRET` (401 se ausente/incorreto).
 *  2. Cria o cliente service-role (contorna RLS; só servidor).
 *  3. Calcula o período atual em America/Sao_Paulo.
 *  4. Gera os lançamentos pendentes de forma idempotente (Req 4.2, 4.3).
 *
 * Agendamento configurado em `vercel.json` (Req 13.4).
 */

// Precisa do runtime Node (service-role, server-only) e nunca deve ser cacheado.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  // 1) Autorização por segredo compartilhado com a Vercel Cron.
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

    return NextResponse.json({ ok: true, ...summary });
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
