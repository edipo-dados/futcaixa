/**
 * Tipos compartilhados do domínio FutCaixa.
 * Serão preenchidos conforme os módulos forem implementados.
 */

/**
 * Papel do usuário DENTRO de um futebol (clube), lido de `memberships`
 * (Req 5.3). O papel não é mais global em `profiles`.
 */
export type ClubRole = "presidente" | "tesoureiro" | "jogador";

export type TransactionKind = "receita" | "despesa";
