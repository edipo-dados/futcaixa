# Crons — FutCaixa

Este documento descreve os dois agendamentos (crons) do FutCaixa: o que fazem,
como são protegidos, como testá-los manualmente e como agendá-los no deploy
atual (Render + agendador externo).

No modelo **multi-tenant**, cada cron **itera por clube**: percorre todos os
futebóis ativos (`clubs` não arquivados) e, para cada um, lê a `settings`
daquele clube e gera cobranças/lançamentos escopados ao respectivo `club_id`.
Como a geração usa a **service role** (que **contorna a RLS**), cada iteração
filtra explicitamente por `club_id` para não cruzar dados entre futebóis, e uma
falha em um clube **não aborta** os demais (os erros são coletados por clube).

## Decisão: Route Handlers + agendador externo

O FutCaixa expõe a lógica de cron como **Route Handlers HTTP protegidos**
(`/api/cron/*`), em vez de `pg_cron` dentro do Postgres. A justificativa
completa está no [`design.md`](../.kiro/specs/futcaixa/design.md) na seção
**"Crons — decisão"**. Em resumo:

- A lógica de geração (ler Configurações, montar `txid`, aplicar valores
  personalizados, idempotência) fica em TypeScript, próxima das regras de
  negócio e dos schemas Zod — mais fácil de testar.
- A idempotência é garantida por chaves no banco (ver abaixo), não pela
  frequência do agendamento.
- Como são apenas endpoints HTTP, o agendamento é **agnóstico de host**:
  qualquer coisa que faça um `GET` autenticado nas rotas serve.

`pg_cron` ficou registrado como alternativa caso o projeto migre de hospedagem.

Atende ao **Requisito 13.4**.

### Quem dispara os crons no deploy atual (Render)

O deploy oficial é no **Render** (ver [`deploy-render.md`](./deploy-render.md)),
como um único Web Service. **No plano Free do Render não há Cron Jobs
gratuitos** (só web services têm free tier), então os endpoints são disparados
por um **agendador externo gratuito** — cron-job.org, Upstash QStash, EasyCron
etc. — fazendo um `GET` em cada rota 1x/dia com o header do `CRON_SECRET`.

> Se migrar para um plano **pago** do Render, dá para declarar dois serviços
> `type: cron` no [`render.yaml`](../render.yaml) (`plan: starter`), cada um
> rodando um `curl` que chama a rota pública do web service com o header de
> autorização. O agendador externo deixa de ser necessário nesse caso.

## Endpoints agendados

| Endpoint | Schedule sugerido | Quando roda | O que faz |
|---|---|---|---|
| `/api/cron/gerar-mensalidades` | `0 6 * * *` | Diariamente às 06:00 (UTC) = 03:00 BRT | **Para cada clube**, gera as cobranças de mensalidade do período atual (`YYYY-MM`) para os jogadores `mensalista`, `ativo` e **não isentos** daquele clube. |
| `/api/cron/gerar-recorrentes` | `0 6 * * *` | Diariamente às 06:00 (UTC) = 03:00 BRT | **Para cada clube**, gera os lançamentos de despesa das despesas recorrentes **ativas** do clube cujo lançamento do período atual ainda não foi criado. |

> O horário é definido no **agendador externo**. Muitos agendadores usam
> **UTC** por padrão — `0 6 * * *` (UTC) = 03:00 no horário de Brasília.

### Por que ambos rodam diariamente

Os dois crons são **idempotentes** e **calculam o período atual** por conta
própria (em `America/Sao_Paulo`, via `currentPeriod()`), sem depender da
frequência do agendamento. Rodar diariamente é seguro e robusto:

- O **dia de geração** das mensalidades é configurável **por clube** nas
  Configurações daquele futebol (`settings.generation_day`, uma linha por
  clube). Em vez de replicar esse valor no agendador (que não lê o banco),
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

- O agendador externo precisa enviar o header
  `Authorization: Bearer <CRON_SECRET>` em cada disparo. Diferente de alguns
  provedores que injetam esse header sozinhos, aqui você o configura
  **manualmente** no agendador, com o mesmo valor que está nas env vars do
  web service no Render.
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

Os agendadores disparam via **GET**; os handlers também aceitam **POST** para
acionamento manual. Qualquer um dos dois funciona — basta enviar o header de
autorização.

Com o `CRON_SECRET` exportado no shell:

```bash
export CRON_SECRET="<seu-segredo>"
APP="https://<seu-app>.onrender.com"   # ou http://localhost:3000 em dev

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

Em caso de **sucesso**, os dois endpoints respondem um corpo **mínimo e de
tamanho fixo** (`200`):

```json
{ "ok": true }
```

Por que mínimo: alguns agendadores externos (ex.: cron-job.org) **abortam** a
requisição com "output too large" quando a resposta passa de um limite baixo.
Para evitar esse falso negativo, a resposta HTTP é enxuta e os **contadores
detalhados** (`period`, `clubsProcessed`, `generated`, `skipped`,
`skippedNoAmount`, `clubErrors`) são escritos nos **logs do servidor** (visíveis
no Render), com os prefixos `[cron:gerar-mensalidades]` e
`[cron:gerar-recorrentes]`.

Significado dos contadores nos logs:

- `clubsProcessed` — clubes ativos percorridos na execução.
- `generated` — cobranças/lançamentos criados nesta execução (somados entre os
  clubes).
- `skipped` — itens ignorados por já existirem no período (idempotência).
- `skippedNoAmount` — (só mensalidades) mensalistas pulados por não terem valor
  cobrável (sem valor personalizado e padrão `<= 0`): não geramos cobrança de
  R$ 0,00.
- `clubErrors` — clubes cujo processamento falhou (`{ clubId, message }`); a
  falha de um clube não aborta os demais.

**Erros:**

- `401` — segredo ausente ou incorreto:
  `{ "ok": false, "error": "Não autorizado." }`
- `500` — `CRON_SECRET` não configurado no ambiente, ou falha na geração:
  `{ "ok": false, "error": "<mensagem>" }`

Numa **reexecução no mesmo mês**, os logs mostram `generated: 0` e os itens em
`skipped` (idempotência confirmada); a resposta HTTP segue sendo `{ "ok": true }`.

## Configurar o agendador externo

Pré-requisitos: o web service já no ar no Render (`https://<nome>.onrender.com`)
e a env var `CRON_SECRET` definida no painel do Render (ver a seção **Deploy no
Render** do [`README.md`](../README.md) e [`deploy-render.md`](./deploy-render.md)).

Crie **dois jobs** no agendador (ex.: [cron-job.org](https://cron-job.org)),
um para cada rota:

1. **Método:** `GET`
2. **URL:** `https://<nome>.onrender.com/api/cron/gerar-mensalidades`
   (e `.../gerar-recorrentes` no segundo job)
3. **Header:** `Authorization: Bearer <CRON_SECRET>` — mesmo valor que está no
   web service; senão a rota devolve `401`.
4. **Agendamento:** diário, ex.: `0 6 * * *` (06:00 UTC = 03:00 BRT).
5. **Timeout:** generoso (≥ 60s) — no plano Free o 1º disparo pode acordar o
   serviço (cold start de ~1 min).
6. Após salvar, use o botão de **"testar/executar agora"** do agendador e
   confirme o `200` com o JSON esperado acima.

## Alterar o agendamento

- Edite o horário diretamente no **agendador externo** (não há mais um arquivo
  no repositório que controle isso). Use a sintaxe cron do próprio agendador,
  atenta ao fuso (muitos usam UTC).
- **Relação com `generation_day`:** não é necessário sincronizar o horário do
  agendador com o dia de geração das Configurações. Cada clube tem o seu
  `generation_day` (`settings.generation_day`, uma linha por clube); como os
  crons rodam diariamente, iteram por clube e são idempotentes, eles sempre
  contemplam o dia configurado de cada futebol sem que o agendador precise ler
  o banco. Se preferir reduzir disparos, é possível agendar com menor
  frequência, mas corre-se o risco de perder o dia configurado de algum clube
  caso ele mude — por isso o padrão é **diário + idempotente**.
