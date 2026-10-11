import { defineWorkspace } from "vitest/config";

/**
 * Workspace do Vitest — separa os testes em dois PROJETOS com estratégias de
 * paralelismo distintas, resolvendo a tensão entre velocidade e um recurso
 * externo compartilhado:
 *
 *   • unit        → testes puros em `src/**` (sem banco). Rodam com o
 *                   paralelismo padrão do Vitest (vários arquivos em paralelo),
 *                   mantendo a suíte unitária rápida.
 *
 *   • integration → testes de INTEGRAÇÃO em `tests/integration/**`, que rodam
 *                   DE VERDADE contra um ÚNICO projeto Supabase compartilhado.
 *                   Aqui o paralelismo ENTRE ARQUIVOS é DESLIGADO
 *                   (`fileParallelism: false`): com várias suítes concorrentes,
 *                   as sessões de auth, RPCs e — sobretudo — os crons que varrem
 *                   TODOS os clubes se atropelam. Dois crons de recorrentes
 *                   rodando ao mesmo tempo (ainda que em períodos diferentes)
 *                   reprocessam as linhas um do outro — a idempotência de
 *                   recorrentes depende de ler/gravar `last_generated_period`,
 *                   que não é isolado entre execuções concorrentes —, além de
 *                   saturar os limites do projeto remoto e estourar timeouts.
 *                   Serializar APENAS os arquivos de integração mantém a suíte
 *                   determinística e ainda rápida (~1,5 min), sem afrouxar
 *                   nenhuma asserção. Os testes DENTRO de cada arquivo já são
 *                   sequenciais por padrão.
 *
 * Ambos os projetos herdam a base (plugins, aliases, setupFiles, environment)
 * de `vitest.config.ts` via `extends`. A base NÃO define `include` — cada
 * projeto define o seu, evitando que o `unit` colete `tests/**` por herança.
 */
export default defineWorkspace([
  {
    extends: "./vitest.config.ts",
    test: {
      name: "unit",
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
    },
  },
  {
    extends: "./vitest.config.ts",
    test: {
      name: "integration",
      include: ["tests/**/*.{test,spec}.{ts,tsx}"],
      // Recurso externo compartilhado (um único Supabase): serializa os
      // arquivos para evitar contenção e interferência cruzada entre crons.
      // `fileParallelism` não é tipado por PROJETO no Vitest 2.x; o equivalente
      // tipado é confinar o projeto a UM ÚNICO worker (`singleThread`), o que
      // faz seus arquivos rodarem em sequência — mesmo efeito, sem contenção.
      pool: "threads",
      poolOptions: {
        threads: { singleThread: true },
      },
    },
  },
]);
