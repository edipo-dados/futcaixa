import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getMembershipSession } from "@/lib/auth/membership";
import { fromCents } from "@/lib/money";
import { createPixProvider } from "@/lib/payments/StaticPixProvider";
import { validatePixConfig } from "@/lib/payments/pix-config";
import { createClient } from "@/lib/supabase/server";
import { CHARGE_STATUS_LABELS, type ChargeRow } from "@/lib/validation/charge";

import { PaymentView } from "./payment-view";

/**
 * Tela de pagamento de uma cobrança (Server Component — tarefa 9.4).
 *
 * MULTI-TENANT (tarefa 21.8): a leitura da cobrança é escopada ao futebol
 * ATIVO (`.eq('club_id', clubId)`), de modo que nenhuma cobrança de outro
 * futebol seja carregada aqui — nem mesmo via id direto na URL. A RLS por
 * tenant/papel permanece a autoridade final; o filtro por `club_id` é defesa em
 * profundidade. A leitura/validação do Pix (settings) é da tarefa 21.9 e NÃO é
 * tocada aqui.
 *
 * Fluxo:
 *  1. Resolve a sessão multi-tenant; sem futebol ativo → `/sem-futebol`.
 *     Carrega a cobrança pelo id via cliente ligado à sessão, filtrando pelo
 *     `club_id` do clube ativo. A RLS garante que um `jogador` só vê as próprias
 *     cobranças; presidente/tesoureiro veem as do clube. Se não houver linha
 *     visível no clube ativo → `notFound()`.
 *  2. Só gera o QR para cobranças `pendente` (ou `em_analise`, para reexibir).
 *     Para `paga`/`cancelada`, mostra uma mensagem informativa.
 *  3. Carrega as Configurações de Pix DO CLUBE da cobrança (`charge.club_id`)
 *     e valida os pré-requisitos (`validatePixConfig`). Como `settings` é por
 *     clube (não mais singleton), a fonte da chave/recebedor/cidade é a linha
 *     daquele futebol. Se faltar algum campo, bloqueia a geração do QR e exibe
 *     a orientação (Req 12.8).
 *  4. Com a config válida, monta o payload via
 *     `createPixProvider(config).createStaticCharge(...)` e entrega ao
 *     client component `PaymentView` (QR + Pix copia e cola).
 *
 * O upload de comprovante (status → `em_analise`) é a tarefa 9.5 e NÃO é
 * tratado aqui.
 *
 * Requisitos: 12.1 (QR Pix estático a partir da config do futebol ativo),
 * 12.8 (bloqueio quando o Pix do futebol não está configurado).
 */

/** Status que ainda permitem exibir o QR para pagamento. */
const PAYABLE_STATUSES = new Set<ChargeRow["status"]>([
  "pendente",
  "em_analise",
]);

interface PagarPageProps {
  // No Next.js 15 os params de rota são assíncronos.
  params: Promise<{ chargeId: string }>;
}

/** Linha de settings com os campos de Pix usados na validação. */
interface PixSettingsRow {
  pix_key: string | null;
  pix_receiver_name: string | null;
  pix_city: string | null;
}

async function loadCharge(
  clubId: string,
  chargeId: string,
): Promise<ChargeRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("charges")
    .select(
      "id, player_id, amount_cents, description, kind, period, due_date, status, paid_at, txid, deleted_at",
    )
    .eq("club_id", clubId)
    .eq("id", chargeId)
    .is("deleted_at", null)
    .maybeSingle<ChargeRow>();

  if (error || !data) return null;
  return data;
}

/**
 * Carrega os dados de Pix da `settings` DO CLUBE da cobrança (tarefa 21.9).
 *
 * `settings` é por clube (`club_id` único) — o singleton `id = 1` não existe
 * mais. A cobrança já foi carregada escopada ao futebol ativo
 * (`loadCharge(clubId, ...)`), então o `clubId` recebido aqui é exatamente o
 * clube da cobrança sendo paga. Filtramos a settings por esse `club_id` para
 * que a chave/recebedor/cidade do Pix venham do futebol correto (Req 12.1).
 *
 * A RLS por tenant já garante que o jogador só enxerga a settings do seu
 * clube; o filtro explícito é defesa em profundidade e torna a fonte dos dados
 * inequívoca.
 */
async function loadPixSettings(clubId: string): Promise<PixSettingsRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("settings")
    .select("pix_key, pix_receiver_name, pix_city")
    .eq("club_id", clubId)
    .maybeSingle<PixSettingsRow>();

  if (error || !data) return null;
  return data;
}

/** Cabeçalho comum com o link de volta para o extrato. */
function BackLink() {
  return (
    <Link
      href="/meu-extrato"
      className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Voltar para meu extrato
    </Link>
  );
}

export default async function PagarCobrancaPage({ params }: PagarPageProps) {
  const { chargeId } = await params;

  // Resolve o futebol ativo: a cobrança é lida escopada ao clube ativo.
  const session = await getMembershipSession();
  if (!session) {
    redirect("/login");
  }
  if (session.hasNoClub || !session.activeClub) {
    redirect("/sem-futebol");
  }

  // 1. Carrega a cobrança do CLUBE ATIVO (RLS filtra o que cada papel pode ver;
  //    o filtro por club_id impede carregar cobrança de outro futebol).
  const charge = await loadCharge(session.activeClub.clubId, chargeId);
  if (!charge) {
    notFound();
  }

  return (
    <div className="container max-w-md py-8">
      <div className="mb-6">
        <BackLink />
        <h1 className="text-2xl font-bold">Pagar cobrança</h1>
      </div>

      {/* 2. Estados terminais: nada de QR, só informação. */}
      {!PAYABLE_STATUSES.has(charge.status) ? (
        <Card>
          <CardHeader>
            <CardTitle>Pagamento indisponível</CardTitle>
            <CardDescription>
              {charge.status === "paga"
                ? "Esta cobrança já está paga."
                : "Esta cobrança foi cancelada e não pode ser paga."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">Valor: </span>
              <span className="font-semibold tabular-nums">
                {fromCents(charge.amount_cents)}
              </span>
            </p>
            <p>
              <span className="text-muted-foreground">Descrição: </span>
              {charge.description}
            </p>
            <p>
              <span className="text-muted-foreground">Status: </span>
              {CHARGE_STATUS_LABELS[charge.status]}
            </p>
          </CardContent>
        </Card>
      ) : (
        <PayableSection charge={charge} clubId={session.activeClub.clubId} />
      )}
    </div>
  );
}

/**
 * Seção de pagamento para cobranças pagáveis: carrega a config de Pix do CLUBE
 * da cobrança, valida os pré-requisitos e, se ok, monta o payload e renderiza
 * o QR; caso contrário, exibe a orientação de configuração (Req 12.8).
 */
async function PayableSection({
  charge,
  clubId,
}: {
  charge: ChargeRow;
  clubId: string;
}) {
  const settings = await loadPixSettings(clubId);
  const pixResult = validatePixConfig(settings ?? {});

  // 3. Pix do clube não configurado → bloqueia geração do QR e orienta
  //    (Req 12.8).
  if (!pixResult.ok) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle
              className="size-5 text-amber-500"
              aria-hidden="true"
            />
            Pix não configurado
          </CardTitle>
          <CardDescription>{pixResult.message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/configuracoes">
              <Settings aria-hidden="true" />
              Abrir Configurações
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // 4. Config válida → monta o payload Pix estático.
  const provider = createPixProvider(pixResult.config);
  const { payload } = provider.createStaticCharge({
    amountCents: charge.amount_cents,
    txid: charge.txid,
    description: charge.description,
  });

  return (
    <PaymentView
      chargeId={charge.id}
      payload={payload}
      amountCents={charge.amount_cents}
      description={charge.description}
      dueDate={charge.due_date}
    />
  );
}
