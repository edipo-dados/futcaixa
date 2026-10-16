/**
 * Mapeia os errcodes da RPC `authorize_password_reset` para mensagens em
 * pt-BR exibidas ao presidente na tela de jogadores. Módulo puro (sem
 * dependências de servidor) para ser testável isoladamente.
 */
export function mapResetError(code: string): string {
  switch (code) {
    case "28000":
      return "Sua sessão expirou. Entre novamente.";
    case "42501":
      return "Apenas o presidente pode resetar.";
    case "P0002":
      return "Jogador não encontrado neste futebol.";
    case "22023":
      return "Este jogador ainda não tem conta de acesso; não há senha para resetar.";
    default:
      return "Não foi possível resetar a senha. Tente novamente.";
  }
}
