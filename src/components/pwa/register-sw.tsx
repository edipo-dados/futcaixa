"use client";

import { useEffect } from "react";

/**
 * Registra o service worker do PWA (Requisitos 12.1 e 12.4).
 *
 * Componente invisível: não renderiza nada, apenas registra `/sw.js` no cliente
 * após a montagem. O registro é protegido por `'serviceWorker' in navigator`
 * para não quebrar em navegadores sem suporte, e só roda em produção — em
 * desenvolvimento o SW atrapalharia o hot reload e o cache do Next.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return;
    }
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        // Falha no registro não deve derrubar o app; apenas registramos.
        console.error("Falha ao registrar o service worker:", error);
      });
    };

    // Aguarda o load para não competir com o carregamento inicial da página.
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
