# Keep-alive (evitar o sleep do Render Free durante o dia)

O web service no plano **Free** do Render dorme após 15 min sem tráfego; o
próximo acesso sofre cold start (~1 min). Para evitar isso **durante o dia**,
pingamos uma rota leve a cada ~10 min com um agendador externo gratuito — e
deixamos o app dormir **das 23:00 às 08:00** (BRT), o que também economiza as
horas gratuitas mensais do Render.

A rota de ping é [`/api/health`](../src/app/api/health/route.ts): pública, sem
banco, sem sessão, resposta JSON mínima (`{"status":"ok"}`).

## Configuração no cron-job.org (grátis)

1. Crie conta em https://cron-job.org e vá em **Cronjobs → Create cronjob**.
2. **Title:** `futcaixa keep-alive`
3. **URL:** `https://futcaixa.onrender.com/api/health`
   (URL pública do web service no Render)
4. **Schedule:** escolha **"Custom"** / expressão cron. Recomendado:

   ```
   */14 8-22 * * *
   ```

   - Dispara a cada **14 min**, das **08:00 às 22:59**. O Render dorme com 15
     min de inatividade, então 14 min mantém o app vivo com folga mínima e
     gasta MENOS cota do Free que 10 min.
   - Entre **23:00 e 07:59 não dispara** → o app dorme à noite (Req do dono).
   - Se preferir mais margem contra cold start, use `*/10 8-22 * * *` (a cada
     10 min), ao custo de mais horas consumidas.
5. **Timezone:** selecione **America/Sao_Paulo** (BRT). É o que faz a janela
   23:00–08:00 bater no horário de Brasília. Se o agendador só aceitar UTC,
   use `*/10 11-23,0-1 * * *` (equivalente aproximado: 08:00–22:59 BRT = 11:00
   UTC do mesmo dia até 01:59 UTC do dia seguinte) — mas o ideal é definir o
   timezone como São Paulo e manter `*/10 8-22 * * *`.
6. **Method:** GET. **Save**.

## Observações

- **Cota do Free:** mesmo com a pausa noturna, o keep-alive consome horas de
  instância. Se o serviço começar a ficar indisponível perto do fim do mês,
  reduza a frequência (ex.: a cada 20 min: `*/20 8-22 * * *`) ou migre para um
  plano pago (sem sleep, sem truque).
- **Não confundir com os crons de negócio:** este ping é só para manter o app
  acordado. Os crons que geram mensalidades/recorrentes continuam sendo os dois
  jobs que batem em `/api/cron/*` com `Authorization: Bearer <CRON_SECRET>`
  (ver `docs/deploy-render.md`).
- **Primeiro ping do dia:** às 08:00 o app pode estar dormindo; esse primeiro
  ping o acorda (cold start). Os seguintes já pegam o serviço quente.
