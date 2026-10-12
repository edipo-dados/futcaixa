import { NextResponse } from "next/server";

/**
 * Health check leve, usado como alvo do keep-alive (evitar o sleep do Render
 * Free durante o dia). NÃO toca banco nem sessão: só confirma que o processo
 * está de pé e responde rápido. É público (liberado no middleware).
 *
 * `dynamic = "force-dynamic"` garante que a resposta não seja cacheada — cada
 * ping precisa realmente acordar/atingir o servidor.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok", ts: new Date().toISOString() });
}
