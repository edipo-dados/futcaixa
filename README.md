# FutCaixa

Plataforma **multi-tenant** de gestão financeira para futebóis recreativos, pensada para o celular (PWA mobile-first).

Cada **futebol** (clube) é um **tenant** isolado: tem seus próprios jogadores, lançamentos, cobranças, despesas recorrentes, metas, categorias, configurações, auditoria, comprovantes e dashboards. Uma mesma pessoa pode participar de **vários futebóis**, com um papel diferente em cada um.

O objetivo central é dar **transparência** ao caixa de cada futebol: presidente e tesoureiro registram receitas e despesas, os jogadores acompanham a saúde do caixa por dashboards agregados e pagam suas cobranças via **Pix (QR Code estático)** anexando o comprovante. Há ainda um **sorteio de times público** (sem login) para montar jogos equilibrados no dia da pelada.

Principais recursos:

- Cadastro aberto (e-mail + senha); acesso a um futebol só por **convite** ou por **aprovação de presidente**.
- Criação de futebol pelo presidente aprovado (clube + configurações + categorias + membership criados de uma vez).
- Lançamentos de receitas/despesas com categoria, comprovante e auditoria — por clube.
- Despesas recorrentes e geração automática de mensalidades (via cron que **itera por clube**).
- Cobranças com pagamento por Pix copia e cola / QR Code e aprovação manual do comprovante.
- Lista de inadimplentes com mensagem pronta para WhatsApp (`wa.me`).
- Dashboards agregados por clube (saldo, receitas/despesas, adimplência, runway, metas/vaquinhas) e "Meu extrato" do próprio jogador.
- Sorteio de times público e 100% client-side.

## Stack

| Área | Tecnologia |
|---|---|
| Framework | Next.js (App Router) + TypeScript |
| Backend | Supabase — Postgres (RLS), Auth (e-mail + senha, cadastro aberto), Storage privado |
| Multi-tenancy | `club_id` + `memberships` + RLS por tenant **e** por papel |
| UI | Tailwind CSS + shadcn/ui (navegação lateral / sidebar) |
| Gráficos | Recharts |
| Validação | Zod |
| Testes | Vitest |
| Migrations | Supabase CLI (SQL versionado no repositório) |
| Hospedagem | Vercel (inclui Vercel Cron) |

---

## Papéis de acesso

O papel **não é global**: ele vive em `memberships` por par (usuário, futebol). A mesma pessoa pode ser presidente de um futebol, jogador de outro e tesoureiro de um terceiro. A única exceção de escopo é o `system_admin`, que é um flag de plataforma.

| Papel | Escopo | Como é definido | Pode |
|---|---|---|---|
| **system_admin** | Plataforma | `profiles.is_system_admin` (via SQL/seed, nunca self-service) | Aprovar solicitações de presidente; listar/gerenciar **todos** os futebóis; **bypass de tenant** (ignora `club_id`). |
| **presidente** | Por futebol | `memberships.role='presidente'` com `status='ativo'` | Criar e administrar o(s) futebol(is): configurações, categorias, jogadores, lançamentos, cobranças; convidar e aprovar membros; promover/rebaixar membros. |
| **tesoureiro** | Por futebol | `memberships.role='tesoureiro'` | Lançamentos financeiros e aprovação de pagamentos do clube; não gerencia membros nem configurações sensíveis. |
| **jogador** | Por futebol | `memberships.role='jogador'` | Dashboards agregados do clube, próprio extrato e próprias cobranças; pagar via Pix. |
| **público** | — | sem login | Apenas o Sorteio (`/sorteio`) e a abertura de um convite (`/convite/<codigo>`). |

Configurações e categorias são **por clube** (uma linha de `settings` por clube; categorias semeadas na criação do clube), nunca mais globais/singleton.

---

## Fluxo de acesso (onboarding "sem futebol")

A autenticação é por **e-mail + senha com cadastro aberto** (não há mais magic link/OTP). A tela `/login` tem duas abas, **Entrar** e **Criar conta**; ao se cadastrar, o perfil (`profiles`) é criado por trigger no banco. Uma conta recém-criada **não tem acesso a nenhum futebol** — ela parte de um estado "sem futebol".

1. **Cadastro / login** em `/login` (nome + e-mail + senha para criar conta).
2. Usuário autenticado **sem membership ativa** é levado a **`/sem-futebol`**, onde pode:
   - **Abrir um convite** de um futebol existente; ou
   - **Solicitar ser presidente** (sujeito à aprovação do `system_admin`).
3. **Convite** — qualquer pessoa abre **`/convite/<codigo>`** (o `invite_code` é estável do clube e não expira). Sem conta, pode se cadastrar; com conta, faz login. Ao autenticar, entra no clube como **`jogador` com status `pendente`** e vê "aguardando aprovação". O presidente aprova em **`/membros`**, escolhendo o tipo (`mensalista`/`avulso`); isso cria/vincula um registro em `players` do clube e ativa a membership (`status='ativo'`). Membros `avulso` não entram na geração automática de mensalidades.
4. **Solicitar presidência** — altera `profiles.president_status` para `pendente` e registra uma solicitação. O `system_admin` aprova em **`/admin/solicitacoes`** (passa para `aprovado`). Só então o usuário pode criar futebóis.
5. **Criar futebol** — o presidente aprovado cria em **`/criar-futebol`**. A operação é **atômica** (RPC Postgres `create_club`): cria o `clubs` (com `invite_code`), a linha de `settings` do clube, as **categorias padrão** semeadas e a membership do criador (`role='presidente'`, `status='ativo'`). Se qualquer etapa falhar, nada é criado (rollback total).

### Futebol ativo e troca de clube

A área autenticada usa uma **sidebar lateral** (drawer colapsável no mobile, fixa em telas largas) com os links filtrados pelo papel do usuário no **futebol ativo**, além do nome do usuário, seu papel e o logout.

- Quando o usuário participa de **mais de um** futebol, a sidebar mostra um **club switcher**; a seleção é guardada no cookie **`fc_active_club`**.
- Com um único futebol, o nome do clube aparece sem seletor.
- O `system_admin` vê também a entrada de administração da plataforma (`/admin`).

> A seleção de clube é conveniência de UX. A fronteira real de segurança é a **RLS no Postgres** (filtra por `club_id` **e** por papel via `memberships`): enviar um `club_id` ao qual o usuário não pertence retorna conjunto vazio / negação, sem revelar a existência de dados.

---

## Pré-requisitos

- **Node.js 20+** (o projeto é desenvolvido com os tipos do Node 20; Node 18 também costuma funcionar, mas recomendamos a 20 LTS).
- **npm** (vem com o Node).
- **[Supabase CLI](https://supabase.com/docs/guides/cli)** para aplicar as migrations e rodar o seed.
- Um **projeto Supabase** (crie em [app.supabase.com](https://app.supabase.com)) — você vai precisar da URL do projeto e das chaves de API.

---

## Setup local (passo a passo)

1. **Clone o repositório**

   ```bash
   git clone <url-do-repositorio> futcaixa
   cd futcaixa
   ```

2. **Instale as dependências**

   ```bash
   npm install
   ```

3. **Configure as variáveis de ambiente**

   Copie o arquivo de exemplo e preencha com os valores do seu projeto Supabase (Dashboard → Project Settings → API):

   ```bash
   cp .env.example .env.local
   ```

   | Variável | Pública? | Descrição |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | sim | URL do projeto Supabase, ex.: `https://xxxxxxxx.supabase.co`. |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | sim | Chave anônima do Supabase. Usada no cliente e no servidor com a sessão do usuário; **respeita a RLS**. |
   | `SUPABASE_SERVICE_ROLE_KEY` | **não — segredo** | Chave service role que **contorna a RLS**. Usada apenas no servidor (rotas de cron e operações administrativas). Como contorna a RLS, o código precisa filtrar explicitamente por `club_id` em cada iteração. Nunca exponha ao cliente nem faça commit dela. |
   | `CRON_SECRET` | não | Segredo que protege os Route Handlers de cron (`gerar-mensalidades`, `gerar-recorrentes`). A Vercel Cron o envia no header `Authorization: Bearer <CRON_SECRET>`. Gere um valor aleatório forte. |
   | `NEXT_PUBLIC_APP_URL` | sim (opcional) | URL pública do app (ex.: `https://futcaixa.vercel.app`). Usada apenas para montar o link do sistema nas mensagens de cobrança (inadimplentes). Pode ficar em branco. |

   > `.env.local` nunca deve ser versionado. Mantenha os segredos fora do Git.

4. **Suba o banco** (migrations + seed) — veja a seção [Banco de dados / migrations](#banco-de-dados--migrations-supabase-cli).

5. **Rode o servidor de desenvolvimento**

   ```bash
   npm run dev
   ```

   O app sobe em `http://localhost:3000`.

6. **Entre e crie seu primeiro futebol** — veja [Primeiro acesso](#primeiro-acesso-cadastro-presidente-e-futebol).

---

## Banco de dados / migrations (Supabase CLI)

As migrations ficam versionadas em [`supabase/migrations/`](supabase/migrations) como SQL (padrão da Supabase CLI) e descrevem todo o schema **multi-tenant**: a entidade de topo `clubs`, a ponte `memberships` (usuário ↔ clube, com papel e status), `club_id` nas tabelas de domínio, `settings` por clube (`club_id` único, substituindo o antigo singleton `id=1`), `invite_code`, as flags `is_system_admin`/`president_status` em `profiles`, as funções auxiliares de autorização (`is_system_admin()`, `club_role()`, `is_member_of()`, `my_player_id()`), a RPC atômica `create_club`, CHECKs de domínio, views agregadas por `club_id`, triggers de auditoria, **RLS habilitada em todas as tabelas** (por tenant **e** por papel) e o **bucket privado `proofs`** (comprovantes acessíveis só por URL assinada, com o `club_id` no caminho). O logo do clube é salvo em um bucket público `logos` quando ele existir (o upload tem fallback caso o bucket não esteja criado).

As **categorias padrão não são mais semeadas por uma migração global**: elas passam a ser inseridas **por clube** no fluxo de criação do futebol (função `seed_club_categories`, chamada pela RPC `create_club` e pelo seed de desenvolvimento).

O seed de exemplo fica em [`supabase/seed.sql`](supabase/seed.sql): cria um `system_admin` de exemplo, um futebol de exemplo com seu presidente (membership `presidente` ativa), alguns membros (jogadores vinculados a `players`), as categorias e a `settings` do clube e ~6 meses de lançamentos/cobranças (incluindo despesas de "Goleiro" em dias de jogo) — tudo escopado ao `club_id` de exemplo — para popular os dashboards.

### Linkar o projeto Supabase

```bash
supabase login
supabase link --project-ref <seu-project-ref>
```

O `project-ref` aparece na URL do seu projeto no dashboard (`https://app.supabase.com/project/<project-ref>`).

### Aplicar as migrations em um projeto remoto

```bash
supabase db push
```

Isso aplica, na ordem, todas as migrations de `supabase/migrations/` ao banco do projeto linkado.

Para rodar o seed em um banco já migrado:

```bash
supabase db query --file supabase/seed.sql
# alternativas:
# supabase db query < supabase/seed.sql
# psql "$DATABASE_URL" -f supabase/seed.sql
# ou cole o conteúdo de supabase/seed.sql no SQL Editor do dashboard
```

### Fluxo local (recomendado em dev)

Com o ambiente local da Supabase CLI, o comando abaixo recria o banco, **aplica todas as migrations e executa o `seed.sql` automaticamente**:

```bash
supabase db reset
```

Use esse comando sempre que quiser um banco limpo com os dados de exemplo.

> **Reset de dados:** a evolução para o modelo multi-tenant parte de um **reset limpo** (os dados single-tenant são descartados). O ambiente sobe **sem clubes** — é preciso criar um futebol por um presidente aprovado (e, opcionalmente, semear um `system_admin` via SQL).

---

## Primeiro acesso (cadastro, presidente e futebol)

Como o cadastro é aberto, o primeiro acesso é feito pela própria interface — mas criar um futebol exige um presidente **aprovado**, e aprovar presidentes exige um **`system_admin`**. Em um ambiente novo, defina um `system_admin` via SQL (ele não é self-service).

1. **Crie sua conta** em `/login` (aba **Criar conta**: nome + e-mail + senha). Você entra autenticado, porém **sem futebol**.

2. **Torne-se `system_admin`** (apenas no primeiro setup) marcando a flag no seu perfil. No SQL Editor do Supabase (ou via `supabase db query`):

   ```sql
   update public.profiles
   set is_system_admin = true
   where id = (select id from auth.users where email = 'voce@exemplo.com');
   ```

   > O `seed.sql` já cria um `system_admin` de exemplo; em dev você pode usá-lo em vez do passo acima.

3. **Fique presidente.** Em `/sem-futebol`, clique em **solicitar ser presidente** (isso marca `president_status='pendente'`). Como `system_admin`, aprove a solicitação em **`/admin/solicitacoes`** (passa para `aprovado`). Se você for ao mesmo tempo o `system_admin` e o futuro presidente, pode também aprovar direto via SQL:

   ```sql
   update public.profiles
   set president_status = 'aprovado'
   where id = (select id from auth.users where email = 'voce@exemplo.com');
   ```

4. **Crie seu futebol** em **`/criar-futebol`** (nome, chave Pix, recebedor, cidade, valores padrão, dias de vencimento/geração, saldo inicial). A RPC `create_club` cria o clube, as configurações, as categorias padrão e sua membership de presidente ativa de uma vez.

5. **Convide jogadores** compartilhando o link **`/convite/<codigo>`** do clube. Cada pessoa entra como `jogador` pendente; aprove em **`/membros`** escolhendo o tipo (`mensalista`/`avulso`).

Depois disso, novos usuários entram sozinhos (cadastro aberto) e ganham acesso ao futebol pelo convite; a promoção a `tesoureiro`/`presidente` é feita pelo presidente em `/membros`.

---

## Scripts disponíveis

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe o servidor de desenvolvimento (`http://localhost:3000`). |
| `npm run build` | Build de produção (`next build`). |
| `npm run start` | Sobe o build de produção (`next start`). |
| `npm run lint` | ESLint (`next lint`). |
| `npm run typecheck` | Checagem de tipos sem emitir (`tsc --noEmit`). |
| `npm run format` | Formata o projeto com Prettier (`prettier --write .`). |
| `npm run format:check` | Verifica a formatação sem alterar arquivos. |
| `npm run test` | Roda a suíte de testes uma vez (`vitest run`). |
| `npm run test:watch` | Roda os testes em modo watch. |

---

## Crons (Vercel Cron)

O arquivo [`vercel.json`](vercel.json) agenda dois Route Handlers que agora **iteram por clube** — percorrem todos os futebóis ativos e, para cada um, leem a `settings` daquele clube (dia de geração, valores padrão) e geram cobranças/lançamentos escopados ao respectivo `club_id`:

- `/api/cron/gerar-mensalidades` — para **cada clube**, gera as cobranças de mensalidade dos mensalistas ativos e não isentos do clube (idempotente).
- `/api/cron/gerar-recorrentes` — para **cada clube**, gera as despesas recorrentes do período (idempotente).

Ambos rodam diariamente às `06:00 (UTC)` (`0 6 * * *`) e são protegidos pelo **`CRON_SECRET`**: a Vercel Cron envia o header `Authorization: Bearer <CRON_SECRET>` em cada disparo, e o handler recusa (`401`) qualquer chamada sem o segredo correto. A geração usa a service role **apenas no servidor** e, como ela **contorna a RLS**, cada iteração filtra explicitamente por `club_id` para não cruzar dados entre futebóis; uma falha em um clube não aborta os demais.

> Detalhes de agendamento, idempotência (por clube), proteção pelo segredo, como testar com `curl` e como configurar na Vercel: veja [`docs/crons.md`](docs/crons.md). A configuração das variáveis de ambiente também é tratada na seção de deploy abaixo.

---

## Deploy na Vercel

1. **Conecte o repositório** no painel da [Vercel](https://vercel.com) (Import Project). A Vercel detecta o Next.js automaticamente — o build command é `next build` e nenhuma configuração extra de framework é necessária.

2. **Configure as variáveis de ambiente** no painel da Vercel (Project → Settings → Environment Variables), com os mesmos nomes do `.env.local`:

   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (segredo — defina só na Vercel, nunca no cliente)
   - `CRON_SECRET` (segredo usado pelos crons)
   - `NEXT_PUBLIC_APP_URL` (opcional — a URL pública do deploy)

3. **Deploy.** No deploy, os crons declarados em `vercel.json` são **ativados automaticamente** pela Vercel, passando a chamar os endpoints `/api/cron/*` nos horários agendados com o header do `CRON_SECRET`.

4. Garanta que o banco do projeto Supabase de produção já teve as migrations aplicadas (`supabase db push`) antes de liberar o acesso. Lembre que o ambiente sobe **sem clubes**: defina um `system_admin` e crie o primeiro futebol conforme [Primeiro acesso](#primeiro-acesso-cadastro-presidente-e-futebol).

---

## Testes

A suíte usa **Vitest**:

```bash
npm run test
```

Cobre, entre outros, a lógica central do domínio:

- **Dinheiro e datas** — conversões centavos ↔ BRL e cálculos de período em `America/Sao_Paulo`.
- **Pix** — cálculo do **CRC16-CCITT** e montagem do **BR Code / EMV** (payloads de referência; os dados do recebedor vêm da `settings` do clube).
- **Sorteio de times** — distribuição de cores, equilíbrio de níveis, tratamento de sobras e determinismo por seed.
- **Multi-tenant** — resolução do clube ativo (`memberships`), criação de futebol e isolamento por `club_id` (RLS).
- **Validação (Zod)** e demais regras de negócio.
