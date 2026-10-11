import { redirect } from "next/navigation";

import { getMembershipSession } from "@/lib/auth/membership";
import { settingsRowToFormValues } from "@/lib/validation/settings";

import { loadSettings } from "./actions";
import { SettingsForm } from "./settings-form";

/**
 * Página de Configurações (Server Component) — modelo MULTI-TENANT (tarefa 21.1).
 *
 * Resolve a sessão multi-tenant e opera sempre sobre o futebol ATIVO:
 *   - sem clube ativo (estado "sem futebol") → redireciona ao onboarding
 *     `/sem-futebol` (mesmo padrão das demais telas internas — Req 1.6/7.7);
 *   - a linha de `settings` é carregada por `club_id` (não mais singleton id=1);
 *   - apenas o PRESIDENTE edita (Req 16.3). O middleware já restringe a rota
 *     `/configuracoes` ao presidente do clube ativo; o `canEdit` abaixo é
 *     defesa em profundidade (modo somente leitura para tesoureiro/jogador,
 *     que leem os dados Pix via RLS onde a rota for acessível).
 */
export default async function ConfiguracoesPage() {
  const session = await getMembershipSession();

  // Sem sessão → login (defesa em profundidade junto ao middleware/layout).
  if (!session) {
    redirect("/login");
  }

  // Sem futebol ativo → onboarding (ponto de entrada do seletor de futebol).
  if (session.hasNoClub || !session.activeClub) {
    redirect("/sem-futebol");
  }

  // Apenas presidente edita; tesoureiro/jogador leem os dados Pix (Req 16.3).
  const canEdit = session.role === "presidente";

  const settingsRow = await loadSettings(session.activeClub.clubId);

  // Se por algum motivo a linha de settings do clube não existir, exibe
  // fallback (a linha é criada na criação do futebol — RPC create_club).
  if (!settingsRow) {
    return (
      <div className="container py-8">
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="mt-2 text-muted-foreground">
          Não foi possível carregar as configurações deste futebol. Verifique se
          o banco de dados está acessível.
        </p>
      </div>
    );
  }

  const formValues = settingsRowToFormValues(settingsRow);

  return (
    <div className="container max-w-2xl py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="mt-1 text-muted-foreground">
          Dados do clube, Pix, valores padrão e parâmetros financeiros.
        </p>
        {!canEdit && (
          <p className="mt-2 text-sm text-muted-foreground">
            Somente o presidente do futebol pode alterar estas configurações.
            Você está visualizando em modo somente leitura.
          </p>
        )}
      </div>

      <SettingsForm defaultValues={formValues} canEdit={canEdit} />
    </div>
  );
}
