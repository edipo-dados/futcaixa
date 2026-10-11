import type { Metadata } from "next";

import { SorteioClient } from "./sorteio-client";

/**
 * Página pública de Sorteio de times (Requisito 9.1).
 *
 * Está no grupo de rotas `(public)`, que não possui layout próprio — logo o
 * layout raiz (`src/app/layout.tsx`) se aplica, e ele NÃO exige autenticação.
 * O `src/middleware.ts` também libera `/sorteio` sem login. A interface
 * interativa fica no componente cliente `SorteioClient`.
 */
export const metadata: Metadata = {
  title: "Sorteio de times | FutCaixa",
  description:
    "Monte a lista de jogadores com níveis, escolha o número de times e as cores, e sorteie times equilibrados. Sem login.",
};

export default function SorteioPage() {
  return (
    <main className="container space-y-6 py-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Sorteio de times</h1>
        <p className="text-muted-foreground">
          Monte a lista de jogadores com o nível de cada um, defina quantos
          times e as cores, e clique em sortear. Os times saem equilibrados
          pelos níveis. Não precisa de login.
        </p>
      </header>

      <SorteioClient />
    </main>
  );
}
