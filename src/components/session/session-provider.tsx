"use client";

import { createContext, useContext, useMemo } from "react";

import type { ClubRole, MembershipSession } from "@/lib/auth/membership";

/**
 * Contexto de sessão do cliente no modelo MULTI-TENANT (tarefa 23.1).
 *
 * A {@link MembershipSession} é resolvida no servidor (layout da área `(app)`)
 * e repassada aos Client Components via este provider. O objeto é simples e
 * serializável (atravessa a fronteira servidor → cliente sem problemas) e já
 * carrega o clube ativo, o papel nele (`memberships.role`) e as flags de
 * onboarding/plataforma.
 *
 * Observação de segurança: assim como o middleware e a navegação filtrada por
 * papel, este contexto é apenas conveniência de UX. A autoridade real de
 * acesso é a RLS no Postgres (Req 1.7/6.2).
 */
const SessionContext = createContext<MembershipSession | null>(null);

interface SessionProviderProps {
  /** Sessão resolvida no servidor; `null` não deveria ocorrer dentro de `(app)`. */
  session: MembershipSession | null;
  children: React.ReactNode;
}

/** Provider do contexto de sessão. Deve envolver a área autenticada. */
export function SessionProvider({ session, children }: SessionProviderProps) {
  // `session` é estável por render do servidor; `useMemo` evita recriar a
  // referência à toa quando a árvore cliente re-renderiza.
  const value = useMemo(() => session, [session]);
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

/**
 * Hook que retorna a sessão atual. Lança se usado fora do provider ou sem
 * sessão (contextos dentro de `(app)` sempre têm sessão).
 */
export function useSession(): MembershipSession {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error(
      "useSession deve ser usado dentro de <SessionProvider> com uma sessão carregada.",
    );
  }
  return session;
}

/**
 * Variante não-lançante do `useSession`: retorna `null` quando não há sessão.
 * Útil em componentes que podem renderizar fora da área autenticada.
 */
export function useSessionOptional(): MembershipSession | null {
  return useContext(SessionContext);
}

/**
 * Retorna o papel do usuário NO CLUBE ATIVO, ou `null` quando o usuário está
 * "sem futebol" (nenhuma membership ativa).
 */
export function useRole(): ClubRole | null {
  return useSession().role;
}

/**
 * Indica se o usuário tem, NO CLUBE ATIVO, algum dos papéis informados
 * (espelha `hasClubRole` do servidor, mas para uso no cliente).
 */
export function useHasRole(...roles: ClubRole[]): boolean {
  const session = useContext(SessionContext);
  return session?.role != null && roles.includes(session.role);
}
