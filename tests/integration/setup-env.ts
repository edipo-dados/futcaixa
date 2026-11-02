/**
 * Setup de ambiente para os testes de INTEGRAÇÃO.
 *
 * Os testes de integração do FutCaixa rodam DE VERDADE contra um projeto
 * Supabase e esperam as variáveis `SUPABASE_TEST_URL`,
 * `SUPABASE_TEST_SERVICE_ROLE_KEY` e `SUPABASE_TEST_ANON_KEY`.
 *
 * Este setup LÊ o `.env.local` em runtime de teste e preenche APENAS as
 * `SUPABASE_TEST_*` definidas explicitamente nele (um projeto Supabase
 * dedicado a testes). As credenciais de produção NUNCA são usadas como
 * fallback, e um banco de teste com a mesma URL de produção é recusado —
 * nesses casos as suítes de integração ficam em skip.
 *
 * Importante:
 *   - NENHUM segredo é commitado: os valores são lidos do `.env.local` apenas
 *     em tempo de execução dos testes (o `.env.local` está no .gitignore).
 *   - Variáveis `SUPABASE_TEST_*` já presentes no ambiente têm PRECEDÊNCIA
 *     (ex.: CI apontando para um projeto dedicado); o `.env.local` só preenche
 *     o que estiver faltando.
 *   - Este arquivo não usa `dotenv` (não é dependência do projeto); faz um
 *     parse mínimo de `KEY=value`, suficiente para o `.env.local`.
 *
 * É carregado via `setupFiles` do Vitest (vitest.config.ts), antes de qualquer
 * suíte, de modo que `helpers.ts` enxergue as variáveis já no topo do módulo.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Parser mínimo de arquivo `.env` (sem dependência externa). Suporta:
 *   - linhas `KEY=value`;
 *   - comentários iniciados por `#` e linhas em branco (ignorados);
 *   - aspas simples/duplas ao redor do valor (removidas);
 *   - `export KEY=value` (o prefixo `export ` é descartado).
 * Não interpola variáveis nem trata multilinha — desnecessário aqui.
 */
function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ")
      ? line.slice("export ".length)
      : line;

    const eq = withoutExport.indexOf("=");
    if (eq === -1) continue;

    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1).trim();

    // Remove aspas simétricas ao redor do valor.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    if (key) result[key] = value;
  }
  return result;
}

/**
 * SEGURANÇA: os testes de integração CRIAM e APAGAM dados reais (usuários de
 * auth, clubes, cobranças) e o cron itera TODOS os clubes do banco. Por isso
 * NUNCA reaproveitamos as credenciais de produção (`NEXT_PUBLIC_SUPABASE_URL`,
 * `SUPABASE_SERVICE_ROLE_KEY`, ...) como fallback: rodar `npm run test` com o
 * `.env.local` de produção já poluiu o banco real com cobranças de teste.
 *
 * Só lemos do `.env.local` as variáveis `SUPABASE_TEST_*` definidas
 * EXPLICITAMENTE (apontando para um projeto Supabase dedicado a testes). Sem
 * elas, as suítes de integração são ignoradas (skip).
 */
const TEST_URL_KEY = "SUPABASE_TEST_URL";
const SERVICE_ROLE_SOURCE = "SUPABASE_TEST_SERVICE_ROLE_KEY";
const ANON_SOURCE = "SUPABASE_TEST_ANON_KEY";

/** URL de produção (usada só para recusar um banco de teste igual a ela). */
const PROD_URL_KEY = "NEXT_PUBLIC_SUPABASE_URL";

/**
 * Decide qual string é a chave SECRETA (service role) e qual é a PUBLICÁVEL
 * (anon). O mapeamento por NOME de variável é o padrão; porém, como a Supabase
 * passou a emitir chaves com prefixos explícitos (`sb_secret_...` secreta,
 * `sb_publishable_...` publicável), usamos esses prefixos — e o formato JWT com
 * `role: service_role` — para corrigir o caso (comum) em que os dois valores
 * foram trocados entre `SUPABASE_SERVICE_ROLE_KEY` e
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` no `.env.local`.
 *
 * Os testes de integração só funcionam com a chave secreta correta (RLS bypass
 * + Admin API); por isso esta correção é importante para que RODEM de verdade.
 */
function classifyKeys(
  byName: { serviceRole?: string; anon?: string },
): { serviceRole?: string; anon?: string } {
  const candidates = [byName.serviceRole, byName.anon].filter(
    (v): v is string => Boolean(v && v.length > 0),
  );

  const isSecret = (key: string): boolean => {
    if (key.startsWith("sb_secret_")) return true;
    if (key.startsWith("sb_publishable_")) return false;
    // JWT (três partes) com payload role=service_role → secreta.
    const parts = key.split(".");
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(
          Buffer.from(parts[1], "base64").toString("utf8"),
        ) as { role?: string };
        if (payload.role === "service_role") return true;
        if (payload.role === "anon") return false;
      } catch {
        /* não é JWT legível; cai no heurístico abaixo */
      }
    }
    return false;
  };

  const secret = candidates.find((k) => isSecret(k));
  const publishable = candidates.find((k) => !isSecret(k));

  // Se conseguimos classificar explicitamente, usamos a classificação (corrige
  // a troca). Caso contrário, mantemos o mapeamento por nome como fallback.
  return {
    serviceRole: secret ?? byName.serviceRole,
    anon: publishable ?? byName.anon,
  };
}

/**
 * Carrega o `.env.local` da raiz do repositório e preenche as variáveis
 * `SUPABASE_TEST_*` que ainda não existirem no `process.env`. Silencioso quando
 * o arquivo não existe (ex.: CI com as `SUPABASE_TEST_*` já definidas).
 *
 * Precedência: variáveis `SUPABASE_TEST_*` já presentes no ambiente NÃO são
 * sobrescritas (ex.: CI apontando para um projeto dedicado).
 */
function loadTestEnvFromDotEnvLocal(): void {
  // vitest roda com cwd = raiz do projeto; resolve relativo a ela.
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;

  let parsed: Record<string, string>;
  try {
    parsed = parseEnvFile(readFileSync(envPath, "utf8"));
  } catch {
    // Falha ao ler o arquivo não deve derrubar a suíte; apenas não mapeia.
    return;
  }

  const setIfAbsent = (target: string, value: string | undefined): void => {
    const existing = process.env[target];
    if (existing && existing.length > 0) return; // precedência do ambiente
    if (value && value.length > 0) process.env[target] = value;
  };

  setIfAbsent(TEST_URL_KEY, parsed[TEST_URL_KEY]);

  const { serviceRole, anon } = classifyKeys({
    serviceRole: parsed[SERVICE_ROLE_SOURCE],
    anon: parsed[ANON_SOURCE],
  });
  setIfAbsent("SUPABASE_TEST_SERVICE_ROLE_KEY", serviceRole);
  setIfAbsent("SUPABASE_TEST_ANON_KEY", anon);
}

/**
 * Trava final: se o banco de teste apontar para a MESMA URL de produção,
 * desligamos as variáveis de teste (as suítes viram skip) e avisamos.
 */
function refuseProductionDatabase(): void {
  const envPath = resolve(process.cwd(), ".env.local");
  let prodUrl = process.env[PROD_URL_KEY];
  if (!prodUrl && existsSync(envPath)) {
    try {
      prodUrl = parseEnvFile(readFileSync(envPath, "utf8"))[PROD_URL_KEY];
    } catch {
      /* sem .env.local legível: nada a comparar */
    }
  }

  const testUrl = process.env[TEST_URL_KEY];
  const normalize = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  if (testUrl && prodUrl && normalize(testUrl) === normalize(prodUrl)) {
    delete process.env.SUPABASE_TEST_URL;
    delete process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_TEST_ANON_KEY;
    console.warn(
      "[integration] SUPABASE_TEST_URL é igual à URL de produção — testes de integração DESATIVADOS para não alterar dados reais.",
    );
  }
}

loadTestEnvFromDotEnvLocal();
refuseProductionDatabase();
