# Deploy no Render

O FutCaixa é um app **Next.js full-stack** (SSR + Server Actions + middleware +
rotas de API). No Render ele roda como **um único Web Service** Node — front e
back juntos. O banco continua no **Supabase** (independente do host).

Os dois crons (mensalidades e recorrentes) chamam as rotas `/api/cron/*`,
protegidas por `CRON_SECRET`. **No plano Free do Render não há Cron Jobs
gratuitos** (só web services têm free tier), então agendamos os crons com um
**serviço externo gratuito** (ver "Crons" abaixo).

O web service está declarado em [`render.yaml`](../render.yaml) (Blueprint).

## Pré-requisitos

- Repositório no GitHub: `github.com/edipo-dados/futcaixa`.
- Projeto Supabase com as migrations aplicadas.
- Valores em mãos (Supabase Dashboard → Project Settings → API):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (secreto)
  - `CRON_SECRET` (gere com `openssl rand -hex 32`)

## Passo 1 — Web Service (Blueprint)

1. Render → **New** → **Blueprint**.
2. Conecte o repositório `edipo-dados/futcaixa`. O Render lê o `render.yaml` e
   propõe criar o Web Service `futcaixa`.
3. Preencha as 4 env vars marcadas como "secret" (`sync: false`):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`.
4. Deploy. O serviço recebe uma URL pública `https://<nome>.onrender.com`.
   Guarde essa URL — ela é usada no agendador dos crons (Passo 2).

Alternativa manual (sem Blueprint):

- **Runtime:** Node
- **Build Command:** `npm ci && npm run build`
- **Start Command:** `npm run start` (resolve `next start -p $PORT`; o Render
  injeta `PORT`)
- **Health Check Path:** `/login`
- **Env vars:** as 4 acima + `NODE_VERSION=20`

## Passo 2 — Crons (agendador externo, grátis)

Os Cron Jobs nativos do Render são **pagos**. No Free, use um agendador externo
gratuito para disparar as duas rotas 1x/dia. Qualquer um serve — exemplos:
[cron-job.org](https://cron-job.org), Upstash QStash, EasyCron.

Crie **dois jobs**, cada um com:

- **Método:** GET
- **URL:** `https://<nome>.onrender.com/api/cron/gerar-mensalidades`
  (e `.../gerar-recorrentes` no segundo)
- **Header:** `Authorization: Bearer <CRON_SECRET>`  ← mesmo valor que você pôs
  no web service; senão a rota devolve 401
- **Agendamento:** diário (ex.: 06:00 UTC = 03:00 BRT); ajuste ao seu fuso
- **Timeout:** generoso (≥ 60s) — a 1ª chamada pode acordar o serviço (cold
  start)

> Dica: esses disparos diários também "acordam" o app perto do horário. Se
> quiser evitar o sleep durante o dia, um ping extra a cada <15 min mantém vivo,
> mas consome as horas gratuitas do mês — avalie antes.

## Notas

- **Sleep (Free):** o web service dorme após 15 min sem tráfego; o primeiro
  acesso após ocioso sofre cold start (~1 min). Troque `plan: free` por um pago
  para eliminar.
- **Porta:** nunca fixe `3000` em produção — o Render define `PORT` (default
  10000). O `start` já usa `-p ${PORT:-3000}`.
- **Build standalone:** `next.config.mjs` usa `output: "standalone"` para um
  boot mais leve.
- **Cron Jobs do Render são pagos:** não há `plan: free` para `type: cron`
  (daí usarmos um agendador externo no Passo 2). Se migrar para um plano pago,
  dá para declarar os dois `type: cron` no `render.yaml` com `plan: starter`.
- **Fuso dos crons:** defina o horário no agendador externo. Muitos usam UTC —
  `0 6 * * *` (UTC) = 03:00 no horário de Brasília.
