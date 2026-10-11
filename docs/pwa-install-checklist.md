# Checklist de verificação de instalação do PWA

> Requisito 12.2 — "O PWA SHALL ser testado e funcional no Safari/iOS e no Chrome/Android."
>
> O teste de instalação em **dispositivo físico** não pode ser automatizado no ambiente de
> desenvolvimento. Este documento descreve o passo a passo manual para validar a instalação
> em aparelhos reais. Os pré-requisitos de instalabilidade (manifesto, ícones, service worker
> e metadados do `layout`) já são verificados de forma programática na task 13.2.

## Pré-requisitos (uma vez)

- **HTTPS obrigatório.** O service worker só é registrado em contexto seguro
  (`https://`) — a única exceção é `http://localhost`. Em celular, o acesso via IP da
  rede local (`http://192.168.x.x`) **não** registra o SW: use um domínio HTTPS
  (deploy na Vercel) ou um túnel (ex.: `ngrok`, `cloudflared`).
- Gerar e servir um **build de produção** (o SW só é registrado em produção):

  ```bash
  npm run build
  npm run start        # serve em http://localhost:3000
  ```

  Para testar no celular pela rede local com HTTPS, prefira o deploy de preview da Vercel
  ou um túnel apontando para a porta 3000.
- Confirmar que estes arquivos respondem na raiz do site:
  `/manifest.webmanifest`, `/sw.js`, `/offline.html`, `/icon.svg`, `/icon-192.png`,
  `/icon-512.png`, `/icon-512-maskable.png`.

---

## Chrome / Android

1. Abrir o app no Chrome usando a URL **HTTPS** (ou `localhost` em emulador).
2. Em `DevTools remoto` → `Application` → `Manifest`, confirmar que não há erros e que os
   ícones aparecem. Em `Application` → `Service Workers`, confirmar que `/sw.js` está
   **activated and running**.
3. Confirmar que o Chrome oferece a instalação:
   - banner/menu "Instalar app" (ícone de instalação na barra de endereço no desktop), ou
   - menu ⋮ → "Adicionar à tela inicial" / "Instalar app" no Android.
4. Instalar o app e abri-lo pelo ícone na tela inicial.
5. Validar a experiência instalada:
   - abre em modo **standalone** (sem a barra de endereço do navegador);
   - **ícone** correto na tela inicial (maskable, sem bordas estranhas);
   - **splash screen** com `background_color` verde (`#16a34a`);
   - barra de status com a **theme color** verde (`#16a34a`).
6. Testar **offline**:
   - com o app aberto, ativar o modo avião / desligar a rede;
   - navegar/recarregar e confirmar que aparece a `offline.html`
     ("Você está offline" + botão "Tentar novamente"), nunca a tela de erro do navegador;
   - religar a rede, tocar em "Tentar novamente" e confirmar que os dados voltam.

---

## Safari / iOS (iPhone/iPad)

> O iOS tem suporte limitado a service worker, mas suporta "Adicionar à Tela de Início"
> com `apple-touch-icon` e exibição em modo standalone (`appleWebApp`).

1. Abrir o app no **Safari** (apenas o Safari instala PWA no iOS) via URL HTTPS.
2. Tocar no botão **Compartilhar** → **"Adicionar à Tela de Início"**.
3. Na prévia de adição, confirmar que aparecem o **nome** ("FutCaixa") e o **ícone**
   (apple-touch de 192×192). Confirmar e adicionar.
4. Abrir o app pelo ícone na tela inicial e validar:
   - abre em modo **standalone** (sem a barra do Safari), graças ao `appleWebApp.capable`;
   - **ícone** correto, sem a captura de tela genérica da página;
   - título/barra de status conforme `statusBarStyle: "default"`.
5. Testar **offline** (comportamento pode variar por versão do iOS):
   - com o app aberto, ativar o modo avião;
   - recarregar e confirmar que, quando o SW está ativo, a `offline.html` é exibida;
   - em versões de iOS sem SW ativo, documentar que ao menos a navegação já carregada
     permanece utilizável e a indisponibilidade de dados fica clara.

---

## Resultado esperado (critério de aprovação)

- [ ] Chrome/Android: instalável, standalone, ícone + splash + theme color corretos, offline OK.
- [ ] Safari/iOS: adicionável à tela inicial, standalone, apple-touch-icon correto, offline OK.

Marque os itens acima após o teste em dispositivos reais para atender ao Requisito 12.2.
