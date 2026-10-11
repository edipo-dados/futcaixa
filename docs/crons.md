# Crons — FutCaixa

Este documento descreve os dois agendamentos (crons) do FutCaixa: o que fazem,
como são protegidos, como testá-los manualmente e como configurá-los na Vercel.

No modelo **multi-tenant**, cada cron **itera por clube**: percorre todos os
futebóis ativos (`clubs` não arquivados) e, para cada um, lê a `settings`
daquele clube e gera cobranças/lançamentos escopados ao respectivo `club_id`.
Como a geração usa a **service role** (que **contorna a RLS**), cada iteração
filtra explicitamente por `club_id` para não cruzar dados entre futebóis, e uma
falha em um clube **não aborta** os demais (os erros são coletados por clube).

## Decisão: Vercel Cron

O FutCaixa usa **Vercel Cron** chamando Route Handlers protegidos, em vez de
`pg_cron` dentro do Postgres. A justificativa completa está no
[`design.md`](../.kiro/specs/futcaixa/design.md) na seção **"Crons — decisão"**.
Em resumo:

- O deploy já é na Vercel; não exige habilitar/gerenciar a extensão `pg_cron`
  nem credenciais de serviço dentro do banco.
- A lógica de geração (ler Configurações, montar `txid`, aplicar valores
  personalizados, idempotência) fica em TypeScript, próxima das regras de
  negócio e dos schemas Zod — mais fácil de testar.
- A idempotência é garantida por chaves no banco (ver abaixo), não pela
  frequência do agendamento.

`pg_cron` ficou registrado como alternativa caso o projeto migre de hospedagem.

Atende ao **Requisito 13.4**.

## Endpoints agendados

O agendamento é declarado em [`vercel.json`](../vercel.json):

| Endpoint | Schedule (cron) | Quando roda | O que faz |
|---|---|---|---|
| `/api/cron/gerar-mensalidades` | `0 6 * * *` | Diariamente às 06:00 (UTC) | **Para cada clube**, gera as cobranças de mensalidade do período atual (`YYYY-MM`) para os jogadores `mensalista`, `ativo` e **não isentos** daquele clube. |
| `/api/cron/gerar-recorrentes` | `0 6 * * *` | Diariamente às 06:00 (UTC) | **Para cada clube**, gera os lançamentos de despesa das despesas recorrentes **ativas** do clube cujo lançamento do período atual ainda não foi criado. |

> Os horários dos crons na Vercel são interpretados em **UTC**.

### Por que ambos rodam diariamente

Os dois crons são **idempotentes** e **calculam o período atual** por conta
própria (em `America/Sao_Paulo`, via `currentPeriod()`), sem depender da
frequência do agendamento. Rodar diariamente é seguro e robusto:

- O **dia de geração** das mensalidades é configurável **por clube** nas
  Configurações daquele futebol (`settings.generation_day`, uma linha por
  clube). Em vez de replicar esse valor no `vercel.json` (que não lê o banco),
  deixamos o cron rodar todo dia: ele percorre os clubes, cria a cobrança no
  período atual e, nas execuções seguintes do mesmo mês, a idempotência evita
  duplicação. Assim cada clube sempre pega o seu dia configurado, qualquer que
  seja, sem acoplar a programação do cron ao banco.
- Uma reexecução no mesmo mês nunca duplica nada (ver garantias abaixo), então
  não há risco em disparar mais vezes do que o necessário.

### Garantias de idempotência

- **Mensalidades:** índice único **parcial** em
  `charges(club_id, player_id, period) WHERE kind = 'mensalidade' AND deleted_at IS NULL`
  (escopado por clube). Cada cobrança é inserida individualmente; ao receber uma
  violação de unicidade do Postgres (código `23505`), o cron a trata como "já
  gerada", conta em `skipped` e segue (Req 5.2).
- **Recorrentes:** a coluna `recurring_expenses.last_generated_period`
  (`YYYY-MM`), por despesa recorrente (que já carrega seu `club_id`). O cron só
  processa recorrências ativas cujo `last_generated_period` seja diferente do
  período atual; após gerar o lançamento, grava o período. Reexecutar no mesmo
  mês não duplica (Req 4.3).

## Proteção por `CRON_SECRET`

Os Route Handlers de cron são públicos quanto à rede, então têm proteção
própria pelo segredo **`CRON_SECRET`** (validado em
[`src/lib/cron/auth.ts`](../src/lib/cron/auth.ts)):

- A Vercel Cron injeta automaticamente o header
  `Authorization: Bearer <CRON_SECRET>` em cada disparo **quando `CRON_SECRET`
  está definido nas variáveis de ambiente do projeto**. Não é preciso
  configurar o header manualmente no `vercel.json`.
- O handler recusa com **`401`** qualquer chamada sem o segredo correto e
  responde **`500`** se a variável `CRON_SECRET` não estiver configurada no
  ambiente (nunca tratamos "sem segredo" como autorizado).
- A geração usa a **service role apenas no servidor** (contorna a RLS), nunca
  exposta ao cliente.

O `CRON_SECRET` está documentado em [`.env.example`](../.env.example). Gere um
valor aleatório forte, por exemplo:

```bash
openssl rand -hex 32
```

## Testar os endpoints manualmente

A Vercel Cron dispara via **GET**; os handlers também aceitam **POST** para
acionamento manual. Qualquer um dos dois funciona — basta enviar o header de
autorização.

Com o `CRON_SECRET` exportado no shell:

```bash
export CRON_SECRET="<seu-segredo>"
APP="https://<seu-app>.vercel.app"   # ou http://localhost:3000 em dev

# Mensalidades
curl -X POST "$APP/api/cron/gerar-mensalidades" \
  -H "Authorization: Bearer $CRON_SECRET"

# Recorrentes
curl -X POST "$APP/api/cron/gerar-recorrentes" \
  -H "Authorization: Bearer $CRON_SECRET"
```

> Em desenvolvimento local, defina `CRON_SECRET` no `.env.local` antes de
> `npm run dev`.

### Respostas esperadas (JSON)

Os contadores (`generated`, `skipped`, ...) são **agregados de todos os
clubes** processados na execução.

**Sucesso — mensalidades** (`200`):

```json
{
  "ok": true,
  "period": "2024-03",
  "clubsProcessed": 3,
  "generated": 8,
  "skipped": 0,
  "skippedNoAmount": 1,
  "clubErrors": []
}
```

- `clubsProcessed` — clubes ativos percorridos nesta execução.
- `generated` — cobranças criadas nesta execução (somadas entre os clubes).
- `skipped` — cobranças ignoradas por já existirem no período (idempotência).
- `skippedNoAmount` — mensalistas pulados por não terem valor cobrável (sem
  valor personalizado e padrão `<= 0`): não geramos cobrança de R$ 0,00.
- `clubErrors` — lista de clubes cujo processamento falhou (`{ clubId, message }`);
  a falha de um clube não aborta os demais.

**Sucesso — recorrentes** (`200`):

```json
{
  "ok": true,
  "period": "2024-03",
  "clubsProcessed": 3,
  "generated": 2,
  "skipped": 0,
  "clubErrors": []
}
```

- `clubsProcessed` — clubes ativos percorridos nesta execução.
- `generated` — lançamentos de despesa criados nesta execução (entre os clubes).
- `skipped` — recorrências ativas que já tinham o período gerado (idempotência).
- `clubErrors` — clubes cujo processamento falhou, isolados dos demais.

**Erros:**

- `401` — segredo ausente ou incorreto:
  `{ "ok": false, "error": "Não autorizado." }`
- `500` — `CRON_SECRET` não configurado no ambiente, ou falha na geração:
  `{ "ok": false, "error": "<mensagem>" }`

Numa **reexecução no mesmo mês**, espere `generated: 0` e os itens contados em
`skipped` (idempotência confirmada).

## Configurar na Vercel

1. No painel da Vercel: **Project → Settings → Environment Variables**, defina
   `CRON_SECRET` (além das demais variáveis — ver a seção **Deploy na Vercel**
   do [`README.md`](../README.md)).
2. Faça o **deploy**. Os crons declarados em `vercel.json` são **ativados
   automaticamente**: a Vercel passa a chamar `/api/cron/*` nos horários
   agendados, já com o header `Authorization: Bearer <CRON_SECRET>`.
3. Acompanhe as execuções em **Project → Settings → Cron Jobs** (histórico e
   status de cada disparo) e nos **Logs** das funções.

## Alterar o agendamento

- Edite o campo `schedule` do cron correspondente em
  [`vercel.json`](../vercel.json) (sintaxe cron padrão, em **UTC**) e faça um
  novo deploy para a mudança valer.
- **Relação com `generation_day`:** não é necessário sincronizar o `schedule`
  com o dia de geração das Configurações. Cada clube tem o seu
  `generation_day` (`settings.generation_day`, uma linha por clube); como os
  crons rodam diariamente, iteram por clube e são idempotentes, eles sempre
  contemplam o dia configurado de cada futebol sem que o `vercel.json` precise
  ler o banco. Se preferir reduzir disparos, é possível agendar com menor
  frequência, mas corre-se o risco de perder o dia configurado de algum clube
  caso ele mude — por isso o padrão é **diário + idempotente**.
