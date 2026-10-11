import { NextResponse } from "next/server";

import { currentPeriod } from "@/lib/date";
import { validateCronSecret } from "@/lib/cron/auth";
import { generateMensalidadesForPeriod } from "@/lib/cron/gerar-mensalidades";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Route Handler (Vercel Cron) para gerar as mensalidades dos mensalistas
 * ativos não isentos (Req 5.1).
 *
 * Fluxo (design.md "Crons — decisão"):
 *  1. Valida o `CRON_SECRET` (401 se ausente/incorreto; 500 se não configurado).
 *  2. Cria o cliente service-role (contorna RLS; só servidor).
 *  3. Calcula o período atual em America/Sao_Paulo.
 *  4. Gera as cobranças de forma idempotente (Req 5.2) — o índice único parcial
 *     do banco evita duplicar; a função trata a violação (23505) graciosamente.
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
    const message =
      error instanceof Error ? error.message : "Erro de configuração.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  if (!authorized) {
    return NextResponse.json(
      { ok: false, error: "Não autorizado." },
      { status: 401 },
    );
  }

  // 2–4) Geração idempotente das mensalidades do período atual.
  try {
    const supabase = createServiceRoleClient();
    const period = currentPeriod();
    const summary = await generateMensalidadesForPeriod(supabase, period);

    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao gerar mensalidades.";
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
