import type { Metadata } from "next";
import {
  BarChart3,
  Crown,
  HandCoins,
  Info,
  QrCode,
  Receipt,
  RefreshCw,
  Shield,
  Ticket,
  Users,
  Wallet,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Sobre e Ajuda — FutCaixa",
  description:
    "Como funciona o FutCaixa: papéis, fluxos e um guia passo a passo para presidentes, tesoureiros e jogadores.",
};

/**
 * Página "Sobre / Ajuda" (acessível a qualquer membro ativo).
 *
 * Documentação de uso dentro do próprio sistema: o que é o FutCaixa, os papéis,
 * e um guia por funcionalidade. É só conteúdo estático (sem dados do clube),
 * então não toca banco — serve a todos os papéis.
 */

/** Item de passo numerado reutilizável. */
function Steps({ items }: { items: string[] }) {
  return (
    <ol className="ml-5 list-decimal space-y-1 text-sm text-muted-foreground">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ol>
  );
}

/** Seção com título, ícone e conteúdo. */
function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-5 text-primary" aria-hidden />
          {title}
        </CardTitle>
        {description ? (
          <CardDescription>{description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

export default function SobrePage() {
  return (
    <div className="container max-w-3xl py-8">
      <div className="mb-6 space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Info className="size-6 text-primary" aria-hidden />
          Sobre o FutCaixa
        </h1>
        <p className="text-muted-foreground">
          O FutCaixa organiza o caixa do seu futebol com transparência: controla
          jogadores, mensalidades, cobranças, despesas e mostra a saúde
          financeira para todos acompanharem.
        </p>
      </div>

      <div className="space-y-6">
        {/* ── Papéis ─────────────────────────────────────────────────── */}
        <Section
          icon={Shield}
          title="Papéis no futebol"
          description="O que cada pessoa pode fazer. O papel é por futebol — você pode ser presidente em um e jogador em outro."
        >
          <ul className="space-y-2 text-sm">
            <li>
              <span className="font-medium">Presidente</span> — administra tudo:
              jogadores, membros e papéis, categorias, configurações, cobranças,
              lançamentos e aprovações. Um futebol pode ter mais de um
              presidente (co-administração).
            </li>
            <li>
              <span className="font-medium">Tesoureiro</span> — cuida da parte
              financeira: lançamentos, cobranças, aprovações de pagamento,
              inadimplentes e despesas recorrentes. Não gerencia
              jogadores/configurações.
            </li>
            <li>
              <span className="font-medium">Jogador</span> — acompanha o
              dashboard e o próprio extrato, e paga suas mensalidades via Pix.
            </li>
          </ul>
        </Section>

        {/* ── Começando: presidente ──────────────────────────────────── */}
        <Section
          icon={Crown}
          title="Começando como presidente"
          description="Para criar e administrar um futebol."
        >
          <Steps
            items={[
              "Peça o papel de presidente em “Ser presidente” (menu lateral). Um administrador da plataforma aprova sua solicitação.",
              "Com a presidência aprovada, crie o futebol em “Criar futebol”.",
              "Em Configurações, preencha os dados do Pix (chave, recebedor, cidade), o valor da mensalidade, o dia de vencimento e o saldo inicial do caixa.",
              "Cadastre os jogadores em “Jogadores” (nome, empresa, tipo, mensalidade personalizada se houver).",
            ]}
          />
        </Section>

        {/* ── Convite ────────────────────────────────────────────────── */}
        <Section
          icon={Ticket}
          title="Convidar jogadores (link de convite)"
          description="Cada futebol tem um link fixo de convite."
        >
          <Steps
            items={[
              "Em “Membros”, copie o link de convite ou compartilhe direto no WhatsApp.",
              "O jogador abre o link, cria a conta (ou entra) e clica em “Entrar neste futebol”. Ele fica pendente, aguardando sua aprovação.",
              "A solicitação aparece em “Membros” para você aprovar.",
            ]}
          />
        </Section>

        {/* ── Aprovar membro / vincular ──────────────────────────────── */}
        <Section
          icon={Users}
          title="Aprovar membros e vincular a jogadores"
          description="Ao aprovar quem entrou pelo link."
        >
          <Steps
            items={[
              "Em “Membros”, escolha o tipo do jogador: mensalista (entra na mensalidade mensal) ou avulso (paga por jogo, não gera mensalidade automática).",
              "Se o jogador já foi cadastrado manualmente antes, use “Vincular a jogador existente” para não duplicar o cadastro.",
              "Ao aprovar um mensalista, a mensalidade do mês atual já é criada como pendente.",
              "Em “Papéis”, o presidente pode promover um membro a tesoureiro ou presidente, ou rebaixar. O futebol precisa sempre de ao menos um presidente.",
            ]}
          />
        </Section>

        {/* ── Mensalidades ──────────────────────────────────────────── */}
        <Section
          icon={RefreshCw}
          title="Mensalidades (geração automática)"
          description="Todo mês, cada mensalista ativo recebe uma cobrança pendente."
        >
          <Steps
            items={[
              "O valor é o padrão das Configurações (ou o valor personalizado do jogador).",
              "O vencimento é o dia configurado em Configurações.",
              "Jogadores isentos (ex.: goleiro) e avulsos não entram na geração automática.",
              "Jogadores inativos deixam de receber novas mensalidades — o histórico é preservado.",
            ]}
          />
        </Section>

        {/* ── Cobranças e pagamento ─────────────────────────────────── */}
        <Section
          icon={HandCoins}
          title="Cobranças e pagamento"
          description="Como o dinheiro entra."
        >
          <Steps
            items={[
              "Em “Cobranças”, o presidente/tesoureiro vê e cria cobranças (mensalidade, avulso, multa, vaquinha).",
              "O jogador vê suas cobranças em “Meu extrato” e paga via Pix (QR Code ou copia e cola).",
              "Após pagar, o jogador anexa o comprovante; o pagamento fica “em análise”.",
              "Em “Aprovações”, o presidente/tesoureiro confere o comprovante e marca como paga — isso gera a receita no caixa.",
            ]}
          />
        </Section>

        {/* ── Pix no painel do jogador ──────────────────────────────── */}
        <Section
          icon={QrCode}
          title="Pix da mensalidade (jogador)"
          description="No painel do jogador."
        >
          <p className="text-sm text-muted-foreground">
            Em “Meu extrato”, o jogador encontra o QR Code e o Pix copia e cola
            já com o valor da mensalidade definido pelo presidente. É só pagar e
            enviar o comprovante.
          </p>
        </Section>

        {/* ── Despesas e recorrentes ────────────────────────────────── */}
        <Section
          icon={Receipt}
          title="Despesas e recorrentes"
          description="Como o dinheiro sai."
        >
          <Steps
            items={[
              "Em “Lançamentos”, registre despesas (quadra, goleiro, bolas, confraternização...) com data, categoria, valor e comprovante.",
              "Em “Recorrentes”, cadastre despesas fixas (ex.: aluguel do goleiro): elas são lançadas automaticamente todo mês.",
              "Desativar uma recorrente para de gerar novos lançamentos, mas preserva os já gerados.",
            ]}
          />
        </Section>

        {/* ── Dashboard ─────────────────────────────────────────────── */}
        <Section
          icon={BarChart3}
          title="Dashboard (acompanhamento)"
          description="A saúde do futebol, visível a todos os membros."
        >
          <Steps
            items={[
              "Use o seletor de mês (setas ◀ ▶) para navegar entre os meses.",
              "Cards: saldo atual, receitas e despesas do mês, resultado do mês, jogadores ativos e mensalistas, adimplência e runway.",
              "Gráficos: receitas vs despesas (12 meses, com a linha de resultado), evolução do saldo, e receitas/despesas por categoria.",
              "Últimas receitas e últimas despesas dão transparência de onde entra e sai o dinheiro.",
            ]}
          />
        </Section>

        {/* ── Saldo inicial ─────────────────────────────────────────── */}
        <Section
          icon={Wallet}
          title="Saldo inicial do caixa"
          description="Para quem já tinha caixa antes de usar o sistema."
        >
          <p className="text-sm text-muted-foreground">
            Em Configurações, informe o saldo que o futebol já tinha. Ele passa a
            compor o saldo mostrado no dashboard a partir do mês de criação do
            futebol, sem precisar recadastrar todo o histórico.
          </p>
        </Section>

        <p className="pt-2 text-center text-xs text-muted-foreground">
          FutCaixa — gestão financeira transparente para o seu futebol.
        </p>
      </div>
    </div>
  );
}
