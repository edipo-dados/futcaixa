/*
 * Service Worker do FutCaixa (PWA) — Requisitos 12.1 e 12.4.
 *
 * Estratégia:
 * - install: faz precache da "app shell" mínima (raiz "/" e a página offline),
 *   para que o app continue abrindo mesmo sem rede.
 * - activate: remove caches de versões antigas (cache versionado por nome).
 * - fetch: network-first para navegações e dados; cai no cache quando a rede
 *   falha e, por fim, na página offline (shell + aviso de indisponibilidade).
 *
 * Observação: o cache é VERSIONADO. Suba o número da versão sempre que a shell
 * mudar para invalidar os caches antigos no próximo activate.
 */

const CACHE_VERSION = "v1";
const CACHE_NAME = `futcaixa-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";

// App shell mínima pré-cacheada na instalação.
const APP_SHELL = ["/", OFFLINE_URL, "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // addAll falha tudo se um item falhar; a shell é intencionalmente enxuta.
      await cache.addAll(APP_SHELL);
      // Ativa imediatamente esta versão sem esperar abas antigas fecharem.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Limpa caches de versões anteriores do FutCaixa.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("futcaixa-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

/**
 * Network-first: tenta a rede, cacheia respostas boas e, em caso de falha,
 * devolve o que houver em cache. Para navegações, o fallback final é a página
 * offline (Requisito 12.4 — shell + aviso claro de indisponibilidade de dados).
 */
async function networkFirst(request, { isNavigation }) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    // Só cacheia respostas básicas/válidas (evita opaque/erros).
    if (response && response.ok && response.type !== "opaqueredirect") {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    if (isNavigation) {
      const offline = await cache.match(OFFLINE_URL);
      if (offline) {
        return offline;
      }
    }
    // Último recurso: resposta sintética indicando indisponibilidade.
    return new Response("", {
      status: 503,
      statusText: "Offline",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Só tratamos GET; outros métodos (POST etc.) seguem direto para a rede.
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  // Ignora requisições de outras origens (ex.: Supabase, CDNs) — deixa a rede
  // cuidar; cachear origens externas poderia servir dados sensíveis obsoletos.
  if (url.origin !== self.location.origin) {
    return;
  }

  const isNavigation =
    request.mode === "navigate" ||
    (request.headers.get("accept") || "").includes("text/html");

  // Navegações e dados usam network-first para sempre priorizar o mais recente.
  event.respondWith(networkFirst(request, { isNavigation }));
});
