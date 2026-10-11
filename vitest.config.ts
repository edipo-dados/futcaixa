import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,

    // setup-env carrega as SUPABASE_TEST_* do .env.local (ver tests/integration/
    // setup-env.ts) ANTES de qualquer suíte, de modo que helpers.ts enxergue as
    // variáveis já no topo do módulo. Deve vir antes do setup de jsdom/matchers.
    setupFiles: ["./tests/integration/setup-env.ts", "./vitest.setup.ts"],

    // IMPORTANTE: o `include` NÃO é definido aqui de propósito. Esta config é a
    // BASE herdada (via `extends`) pelos PROJETOS do `vitest.workspace.ts`
    // (unit e integration). Cada projeto define o PRÓPRIO `include`. Se
    // definíssemos `include` aqui, o `extends` o mesclaria em AMBOS os projetos,
    // fazendo o projeto `unit` também coletar `tests/**` e rodar as suítes de
    // integração EM PARALELO (dupla coleta + contenção/interferência dos crons).
    // O escopo real dos arquivos de teste vive em `vitest.workspace.ts`.
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      // `server-only` lança erro fora de um Server Component; nos testes
      // (ambiente jsdom) apontamos para um stub vazio para permitir importar
      // módulos marcados como server-only sem quebrar o guard no build real.
      "server-only": resolve(__dirname, "./vitest.server-only-stub.ts"),
    },
  },
});
