# Deploy no Render

O FutCaixa é um app **Next.js full-stack** (SSR + Server Actions + middleware +
rotas de API). No Render ele roda como **um único Web Service** Node — front e
back juntos. O banco continua no **Supabase** (independente do host).

Os dois crons (mensalidades e recorrentes) rodam como **Cron Jobs** separados
que chamam as rotas `/api/cron/*`, protegidas por `CRON_SECRET`.

Tudo isso está declarado em [`render.yaml`](../render.yaml) (Blueprint).

## Pré-requisitos

- Repositório no GitHub: `github.com/edipo-dados/futcaixa`.
- Projeto Supabase com as migrations aplicadas.
- Valores em mãos (Supabase Dashboard → Project Settings → API):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (secreto)
  - `CRON_SECRET` (gere com `openssl rand -hex 32`)

## Opção A — Blueprint (recomendada)

1. Render → **New** → **Blueprint**.
2. Conecte o repositório `edipo-dados/futcaixa`. O Render lê o `render.yaml` e
   propõe criar: 1 Web Service (`futcaixa`) + 2 Cron Jobs.
3. Em cada serviço, preencha as env vars marcadas como "secret" no `render.yaml`
   (`sync: false`): as 4 do Supabase/cron no web service; `APP_URL` e
   `CRON_SECRET` em cada cron job.
4. Faça o primeiro deploy do web service. Ele recebe uma URL pública
   `https://<nome>.onrender.com`.
5. Copie essa URL e cole em **`APP_URL`** nos dois cron jobs (é o alvo do curl).
   Importante: `CRON_SECRET` precisa ser **o mesmo valor** no web service e nos
   dois cron jobs — senão a rota devolve 401.

## Opção B — manual (sem Blueprint)

Web Service:

- **Runtime:** Node
- **Build Command:** `npm ci && npm run build`
- **Start Command:** `npm run start` (resolve `next start -p $PORT`; o Render
  injeta `PORT`)
- **Health Check Path:** `/login`
- **Env vars:** as 4 acima + `NODE_VERSION=20`

Cron Jobs (um por rota), ambos com schedule `0 6 * * *` (06:00 UTC = 03:00 BRT):

- **Command:**
  `curl --fail -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/gerar-mensalidades"`
  (e `.../gerar-recorrentes` no segundo)
- **Env vars:** `APP_URL` (a URL do web service) e `CRON_SECRET` (o mesmo do web).

## Notas

- **Sleep (Free):** o web service dorme após 15 min sem tráfego; o primeiro
  acesso após ocioso sofre cold start (~1 min). Troque `plan: free` por um pago
  para eliminar.
- **Porta:** nunca fixe `3000` em produção — o Render define `PORT` (default
  10000). O `start` já usa `-p ${PORT:-3000}`.
- **Build standalone:** `next.config.mjs` usa `output: "standalone"` para um
  boot mais leve.
- **Fuso dos crons:** o schedule do Render é em **UTC**. `0 6 * * *` = 03:00 no
  horário de Brasília. Ajuste se quiser outro horário.
- **Alternativa de agendador:** qualquer serviço que faça um GET com o header
  `Authorization: Bearer <CRON_SECRET>` nas rotas serve (cron-job.org, Upstash
  QStash etc.) — útil se preferir não usar os Cron Jobs do Render.
