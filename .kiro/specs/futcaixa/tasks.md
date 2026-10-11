# Plano de implementação — FutCaixa

Cada item é uma tarefa de codificação incremental. As referências entre parênteses apontam para os requisitos de `requirements.md`. A ordem prioriza fundação (projeto, banco, RLS, auth) antes dos módulos, deixando testes e deploy ao longo do caminho.

- [x] 1. Setup do projeto e fundação
  - [x] 1.1 Inicializar Next.js (App Router) + TypeScript, Tailwind e shadcn/ui; configurar ESLint/Prettier e Vitest
    - Estrutura de pastas de `src/` conforme design; tema mobile-first
    - _Requisitos: 12.3_
  - [x] 1.2 Configurar clientes Supabase (server e client), variáveis de ambiente e helper de sessão
    - `lib/supabase/server.ts`, `lib/supabase/client.ts`; `.env.example`
    - _Requisitos: 1.3, 1.7_
  - [x] 1.3 Implementar utilitários de dinheiro (centavos ↔ BRL) e data (America/Sao_Paulo) com testes unitários
    - `lib/money.ts`, `lib/date.ts`
    - _Requisitos: 11.4_

- [x] 2. Banco de dados e segurança (migrations via Supabase CLI)
  - [x] 2.1 Migration do schema base: profiles, players, categories, settings
    - CHECKs de domínio (tipo, status, nível 1..3), singleton de settings; categories com `sort_order`, `is_active`, `is_system`
    - _Requisitos: 2.1, 2.2, 3.2, 10.1, 10.2, 10.3_
  - [x] 2.2 Migration de transações e recorrências: transactions, recurring_expenses
    - CHECK `amount_cents > 0`, soft delete, FKs
    - _Requisitos: 3.1, 3.10, 4.1, 11.5_
  - [x] 2.3 Migration de cobranças e comprovantes: charges, payment_proofs
    - Índice único parcial `(player_id, period)` p/ mensalidade; `txid` único
    - _Requisitos: 5.1, 5.2, 5.4, 6.5_
  - [x] 2.4 Migration de metas e auditoria: goals, audit_log + triggers de auditoria
    - Triggers capturam before/after e actor em transactions, charges, payment_proofs, settings
    - _Requisitos: 3.9, 5.7, 6.6, 6.7, 8.6, 11.3_
  - [x] 2.5 Migration das views agregadas: v_monthly_summary, v_category_breakdown, v_balance_history, v_delinquency_rate
    - _Requisitos: 8.1, 8.2, 8.3, 8.4, 8.8_
  - [x] 2.6 Habilitar RLS e criar políticas por papel em todas as tabelas + função `current_role()`
    - Jogador só vê as próprias charges/proofs; sem acesso direto a transactions
    - _Requisitos: 1.5, 1.6, 1.7, 8.8, 8.9, 11.1_
  - [x] 2.7 Configurar bucket privado `proofs` e policies de Storage (dono ou gestor) + helper de URL assinada
    - _Requisitos: 3.7, 6.5, 11.2_

- [x] 3. Autenticação e autorização
  - [x] 3.1 Tela de login com magic link / OTP, restrita a e-mails cadastrados
    - Mensagem genérica quando e-mail não existe
    - _Requisitos: 1.1, 1.2_
  - [x] 3.2 Middleware de proteção de rotas e guarda por papel
    - Público só acessa `/sorteio`; jogador bloqueado em rotas admin
    - _Requisitos: 1.4, 1.5, 1.6_
  - [x] 3.3 Carregamento de perfil/papel pós-login e contexto de sessão
    - _Requisitos: 1.3_

- [x] 4. Configurações (admin)
  - [x] 4.1 Schema Zod + tela de Configurações (dados do clube, Pix, valores padrão, dias, saldo inicial, logo)
    - Upload de logo; apenas admin edita
    - _Requisitos: 10.1, 10.2, 10.3, 10.5_
  - [x] 4.2 Validação de pré-requisitos de Pix (bloquear uso sem chave/recebedor/cidade)
    - _Requisitos: 10.4_

- [x] 5. Jogadores (admin)
  - [x] 5.1 CRUD de jogadores com Zod (campos, tipo, status, nível, isento+motivo, valores personalizados)
    - Validar e-mail/telefone; isento exige motivo
    - _Requisitos: 2.1, 2.2, 2.3, 2.4, 2.5, 2.8_
  - [x] 5.2 Inativação preservando histórico e exclusão da geração automática
    - _Requisitos: 2.6_

- [x] 6. Categorias e lançamentos (admin/tesoureiro)
  - [x] 6.1 Gestão de categorias editáveis (criar, renomear, reordenar e ativar/desativar; incluindo as padrão)
    - Categoria de sistema não é excluída se já usada; lançamentos antigos preservam a categoria original
    - _Requisitos: 3.2, 3.3, 3.4, 3.5_
  - [x] 6.2 CRUD de lançamentos com comprovante (upload para bucket privado), soft delete e auditoria
    - Rejeitar valor ≤ 0; URL assinada para visualizar comprovante
    - _Requisitos: 3.1, 3.7, 3.8, 3.9, 3.10, 3.11_
  - [x] 6.3 Lançamento rápido de despesa do dia do jogo (data, categoria ex.: Goleiro, descrição livre, jogador opcional)
    - Atalho de UI pré-selecionando tipo `despesa`
    - _Requisitos: 3.6_

- [x] 7. Despesas recorrentes + cron
  - [x] 7.1 CRUD de despesas recorrentes (valor, categoria, dia, ativa/inativa)
    - _Requisitos: 4.1, 4.4_
  - [x] 7.2 Route Handler de cron `gerar-recorrentes` protegido por CRON_SECRET, idempotente
    - Atualiza `last_generated_period`; configurar Vercel Cron
    - _Requisitos: 4.2, 4.3, 13.4_

- [x] 8. Cobranças + cron de mensalidades
  - [x] 8.1 Cobranças avulsas manuais (mensalidade/avulso/multa/vaquinha) com vencimento
    - _Requisitos: 5.3, 5.8_
  - [x] 8.2 Route Handler de cron `gerar-mensalidades` para mensalistas ativos não isentos, idempotente
    - Aplica valor personalizado quando houver; índice único evita duplicar
    - _Requisitos: 5.1, 5.2, 13.4_
  - [x] 8.3 Transição de status e geração automática de receita ao marcar como paga; cancelamento auditado
    - Cálculo derivado de "atrasada" nas listagens
    - _Requisitos: 5.4, 5.5, 5.6, 5.7_

- [x] 9. Pagamento via Pix
  - [x] 9.1 Implementar CRC16-CCITT com testes unitários (payloads de referência)
    - `lib/payments/pix/crc16.ts`
    - _Requisitos: 6.3_
  - [x] 9.2 Montagem do BR Code / EMV (TLV, normalização de nome/cidade, txid) com testes
    - `lib/payments/pix/brcode.ts`
    - _Requisitos: 6.1, 6.2_
  - [x] 9.3 Interface `PaymentProvider` + `StaticPixProvider`
    - Isola regra de cobrança de futura integração PSP
    - _Requisitos: 6.8_
  - [x] 9.4 Tela de pagamento: QR Code + botão "Pix copia e cola"
    - _Requisitos: 6.1, 6.4_
  - [x] 9.5 Upload de comprovante (imagem/PDF) → status `em_analise`; validação de tipo/tamanho
    - _Requisitos: 6.5_
  - [x] 9.6 Aprovação/rejeição por admin/tesoureiro (paga + receita; ou volta a pendente) com auditoria
    - _Requisitos: 6.6, 6.7_

- [x] 10. Inadimplentes (admin/tesoureiro)
  - [x] 10.1 Lista de atrasados (nome, total devido, meses em atraso) a partir de cobranças pendentes vencidas
    - _Requisitos: 7.1_
  - [x] 10.2 Geração de mensagem WhatsApp: "Copiar mensagem" e "Compartilhar" via `wa.me`, com opção de ocultar valores
    - _Requisitos: 7.2, 7.3, 7.4_

- [x] 11. Dashboards (jogadores logados)
  - [x] 11.1 Cards (saldo atual, receitas/despesas do mês, % adimplência) a partir das views
    - _Requisitos: 8.1, 8.8_
  - [x] 11.2 Gráficos Recharts: receitas vs despesas (12m), despesas por categoria (mês/ano), evolução do saldo
    - _Requisitos: 8.2, 8.3, 8.4_
  - [x] 11.3 Runway (média de despesas dos últimos 3 meses) com tratamento de divisão por zero
    - _Requisitos: 8.5_
  - [x] 11.4 Metas/vaquinhas com barra de progresso
    - _Requisitos: 8.6_
  - [x] 11.5 Lista das últimas despesas com comprovante visível (transparência)
    - _Requisitos: 8.7_
  - [x] 11.6 "Meu extrato": cobranças e pagamentos do próprio jogador
    - _Requisitos: 8.9_

- [x] 12. Sorteio de times (público)
  - [x] 12.1 Algoritmo de sorteio por rodadas com testes unitários (cores, equilíbrio, sobras, seed)
    - `lib/sorteio/draft.ts`
    - _Requisitos: 9.4, 9.5, 9.6, 9.7, 9.11_
  - [x] 12.2 UI pública do sorteio: montar lista (cadastrados ou nomes livres + nível), nº de times e cores
    - _Requisitos: 9.1, 9.2, 9.3_
  - [x] 12.3 Ações "sortear de novo" e "copiar resultado" (texto WhatsApp); persistência em localStorage
    - _Requisitos: 9.8, 9.9, 9.10_

- [x] 13. PWA
  - [x] 13.1 Manifest + ícones (maskable) + service worker (app shell, network-first, aviso offline)
    - _Requisitos: 12.1, 12.4_
  - [x] 13.2 Verificação de instalação no Safari/iOS e Chrome/Android
    - _Requisitos: 12.2_

- [x] 14. Seed, documentação e deploy
  - [x] 14.1 Seed com 10 jogadores e 6 meses de lançamentos/cobranças para popular dashboards
    - Incluir despesas de Goleiro em dias de jogo para exemplificar
    - _Requisitos: 13.1_
  - [x] 14.2 README: setup local, variáveis de ambiente, migrations (Supabase CLI) e deploy na Vercel
    - _Requisitos: 13.2, 13.3_
  - [x] 14.3 Configurar Vercel Cron (mensalidades e recorrentes) e CRON_SECRET; documentar
    - _Requisitos: 13.4_

- [x] 15. Testes de integração e RLS
  - [x] 15.1 Fluxo cobrança → comprovante → aprovação → lançamento de receita
    - _Requisitos: 5.6, 6.6_
  - [x] 15.2 Idempotência dos crons (mensalidades e recorrentes)
    - _Requisitos: 4.3, 5.2_
  - [x] 15.3 Testes de RLS: jogador não lê cobranças de terceiros nem acessa transactions direto
    - _Requisitos: 8.8, 8.9, 11.1_

---

## Evolução multi-tenant

As seções a seguir evoluem o FutCaixa de single-tenant para **multi-tenant** (um "futebol" = um tenant). Partem do pressuposto de **reset de dados** (os dados existentes são descartados), então as migrações são para frente, podem adicionar `club_id` como `NOT NULL` sem backfill e o `seed.sql` é reescrito. A ordem é fundação-primeiro: banco/RLS → auth/onboarding → admin de plataforma → ciclo de vida do clube → refatorar os módulos existentes para o escopo do clube → shell de UI → seed/docs → testes. A autenticação por e-mail+senha já existe (login/cadastro e trigger que cria o perfil `jogador`), então as tarefas de auth são de **evolução**, não criação do zero.

- [x] 16. Fundação multi-tenant no banco (migrations via Supabase CLI)
  - [x] 16.1 Migration de `clubs` (tenant de topo)
    - Criar `clubs` (id, name, slug nullable, invite_code text unique **estável/não expira**, created_by → profiles.id, logo_path nullable, deleted_at); índice único em `invite_code`
    - _Requisitos: 3.1, 3.5, 6.1_
  - [x] 16.2 Migration de `memberships` (vínculo usuário↔clube)
    - Criar `memberships` (id, user_id → profiles.id, club_id → clubs.id, role `presidente|tesoureiro|jogador`, status `pendente|ativo|recusado`, player_id nullable → players.id, created_at, updated_at); CHECK de domínio em role/status; `unique (user_id, club_id)`
    - _Requisitos: 4.3, 5.1, 5.2, 5.4_
  - [x] 16.3 Evoluir `profiles` e criar `president_requests` (histórico)
    - Em `profiles`: adicionar `is_system_admin boolean default false` e `president_status text default 'none'` (CHECK `none|pendente|aprovado`); **remover/substituir** `profiles.role` e `profiles.player_id` (papel e vínculo agora são por clube via `memberships`); criar `president_requests` (id, user_id, status, requested_at, reviewed_by nullable, reviewed_at nullable, note nullable) como trilha de aprovações, complementar a `profiles.president_status` que guarda o estado atual
    - _Requisitos: 1.2, 2.1, 2.4, 5.3_
  - [x] 16.4 Adicionar `club_id` às tabelas de domínio e tornar `settings` uma linha por clube
    - Adicionar `club_id uuid not null references clubs(id)` em players, categories, transactions, recurring_expenses, charges, payment_proofs, goals e audit_log (audit_log aceita `club_id` nulo para ações de plataforma); em `settings`, remover o singleton `id=1` e adicionar `club_id` com restrição `unique` (uma linha por clube)
    - _Requisitos: 6.1, 16.4, 17.3_
  - [x] 16.5 Mover a semeadura de categorias para a lógica de criação de clube
    - Remover a migração global que semeava categorias de sistema; as categorias padrão passam a ser inseridas por clube no fluxo `createClub` (tarefa 20.1)
    - _Requisitos: 3.3, 9.2_
  - [x] 16.6 Ajustar índice único de mensalidade e reescrever views agregadas por clube
    - Trocar o índice único parcial de `charges` para `(club_id, player_id, period)` quando `kind='mensalidade'`; reescrever `v_monthly_summary`, `v_category_breakdown`, `v_balance_history` e `v_delinquency_rate` para projetar/filtrar por `club_id` (saldo usa `settings.initial_balance_cents` do clube)
    - _Requisitos: 11.2, 14.2, 14.3, 14.4, 14.8_

- [x] 17. Reescrita da RLS (dupla dimensão: tenant + papel)
  - [x] 17.1 Funções auxiliares de autorização
    - Criar `is_system_admin()`, `club_role(p_club_id)`, `is_member_of(p_club_id)` e `my_player_id(p_club_id)` como funções `stable`, lendo `profiles.is_system_admin` e `memberships` (status `ativo`)
    - _Requisitos: 6.2, 6.7, 5.3_
  - [x] 17.2 Reescrever políticas das tabelas escopadas por clube
    - Reescrever todas as policies de players, categories, transactions, recurring_expenses, charges, payment_proofs, goals, settings, audit_log e views: leitura/escrita só em clubes com membership `ativa` e papel suficiente; presidente CRUD, tesoureiro lançamentos/pagamentos, jogador sem acesso direto a `transactions`; `system_admin` com bypass de tenant
    - _Requisitos: 6.2, 6.3, 6.5, 6.7, 17.1_
  - [x] 17.3 Políticas do jogador para as próprias cobranças/comprovantes por clube
    - Jogador SELECT apenas `charges`/`payment_proofs` onde `player_id = my_player_id(club_id)`; INSERT de comprovante só nas próprias; sem acesso a dados de terceiros
    - _Requisitos: 6.6, 14.9_
  - [x] 17.4 Políticas de plataforma para solicitações de presidente
    - Cada usuário lê o próprio `president_status`/`president_requests`; leitura de solicitações de terceiros restrita a `system_admin`
    - _Requisitos: 2.5, 2.7_
  - [x] 17.5 Reescrever policies de Storage do bucket `proofs` com `club_id` no caminho
    - Caminho `proofs/<club_id>/<charge_id>/...`; upload/leitura permitidos ao dono da cobrança ou a presidente/tesoureiro do **mesmo** clube; leitura só por URL assinada do servidor
    - _Requisitos: 6.8, 17.2_

- [x] 18. Auth e onboarding "sem futebol"
  - [x] 18.1 Evoluir carregamento de sessão/perfil para resolver memberships e futebol ativo
    - `lib/auth/membership.ts`: resolve as memberships `ativas` do usuário e o papel no clube ativo (nunca de `profiles`); expõe estado "sem futebol" quando não há membership ativa
    - _Requisitos: 1.3, 1.6, 5.3, 7.1_
  - [x] 18.2 Evoluir middleware para onboarding e rotas públicas
    - Rotas públicas apenas `/sorteio` e `/convite/<codigo>`; usuário autenticado sem membership ativa é levado ao onboarding; `club_id` da rota sem membership ativa redireciona ao seletor/"sem futebol"
    - _Requisitos: 1.6, 1.7, 7.7_
  - [x] 18.3 Ação de logout visível na UI
    - Server Action/handler que encerra a sessão do Supabase e redireciona para o login (consumida pela sidebar na tarefa 23.1)
    - _Requisitos: 1.5, 7.5_

- [x] 19. Admin de plataforma (system_admin)
  - [x] 19.1 Fluxo "solicitar ser presidente"
    - Tela/ação de onboarding que altera `profiles.president_status` para `pendente` e grava uma linha em `president_requests`; bloqueia criar futebol enquanto não `aprovado`
    - _Requisitos: 2.1, 2.2_
  - [x] 19.2 Tela do system_admin: solicitações de presidente (listar/aprovar) com histórico
    - Listar usuários com `president_status='pendente'`; aprovar altera para `aprovado`, atualiza a linha de `president_requests` (reviewed_by/reviewed_at) e registra auditoria; negar ação a quem não é `system_admin`
    - _Requisitos: 2.3, 2.4, 2.5, 2.6, 17.3_
  - [x] 19.3 Tela do system_admin: listar todos os futebóis
    - Listagem de todos os `clubs` (bypass de tenant); apenas `system_admin`
    - _Requisitos: 2.3, 6.7_
  - [ ]* 19.4 Testes do fluxo de aprovação de presidente
    - Não-admin não aprova; aprovação grava histórico e habilita criação de futebol
    - _Requisitos: 2.4, 2.5, 2.6_

- [x] 20. Ciclo de vida do futebol (presidente)
  - [x] 20.1 Criação atômica de futebol (`createClub`)
    - `lib/clubs/createClub.ts`: numa só transação/RPC cria `clubs` (com `invite_code`), a linha de `settings` do clube, as categorias padrão semeadas e a membership do criador (`role=presidente`, `status=ativo`); registra auditoria; rollback total se qualquer etapa falhar
    - _Requisitos: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_
  - [x] 20.2 Página pública de convite `/convite/<codigo>`
    - `lib/clubs/invite.ts` resolve `invite_code` → clube; sem conta permite cadastro, com conta permite login; ao autenticar cria (ou reaproveita) membership `jogador`/`pendente`; exibe "aguardando aprovação"
    - _Requisitos: 4.1, 4.2, 4.3, 4.4_
  - [x] 20.3 Tela de membros: aprovar (criar/vincular jogador) e recusar
    - Listar memberships `pendentes` do clube; **aprovar** escolhendo tipo (`mensalista|avulso`) cria/vincula `players` do clube e preenche `memberships.player_id` com `status=ativo`; **recusar** define `status=recusado`; avulso não entra na geração de mensalidades; auditar; negar a quem não é presidente
    - _Requisitos: 4.5, 4.6, 4.7, 4.8, 4.9_
  - [x] 20.4 Promoção/rebaixamento de papéis com guarda do último presidente
    - Presidente altera `memberships.role` (`jogador|tesoureiro|presidente`) no seu clube; **impedir rebaixar/remover o ÚLTIMO presidente ativo** (o clube mantém ≥1 presidente); auditar; negar a quem não é presidente
    - _Requisitos: 5.1, 5.5, 5.6_
  - [ ]* 20.5 Testes de criação atômica, convite→aprovação→vínculo e guarda do último presidente
    - Falha em etapa não deixa clube parcial; aprovação cria/vincula player; não é possível remover o último presidente
    - _Requisitos: 3.6, 4.6, 5.1_

- [x] 21. Refatorar módulos existentes para o escopo do futebol
  - [x] 21.1 Escopar Configurações ao futebol ativo
    - `settings` por clube (não mais singleton); leitura/escrita do clube ativo; só presidente edita, tesoureiro/jogador leem dados Pix
    - _Requisitos: 16.1, 16.2, 16.3, 16.4, 16.6_
  - [x] 21.2 Escopar Jogadores ao futebol ativo
    - CRUD de `players` filtrando/injetando `club_id`; só presidente cria/edita/inativa jogadores do clube
    - _Requisitos: 8.1, 8.6, 8.8_
  - [x] 21.3 Escopar Categorias ao futebol ativo
    - Gestão de categorias por `club_id`; categoria usada não é apagada; semeadas na criação do clube como ponto de partida
    - _Requisitos: 9.2, 9.3, 9.4, 9.5_
  - [x] 21.4 Escopar Lançamentos ao futebol ativo
    - CRUD de `transactions` injetando `club_id`; categoria/jogador do mesmo clube; comprovante em caminho com `club_id`; auditoria com `club_id`; só presidente/tesoureiro
    - _Requisitos: 9.1, 9.7, 9.9, 9.11_
  - [x] 21.5 Escopar Cobranças ao futebol ativo
    - CRUD de `charges` por `club_id`; "atrasada" derivada; marcar paga gera receita escopada ao clube; cancelamento auditado
    - _Requisitos: 11.3, 11.4, 11.5, 11.6, 11.7_
  - [x] 21.6 Escopar Despesas recorrentes ao futebol ativo
    - CRUD de `recurring_expenses` por `club_id`; só presidente/tesoureiro
    - _Requisitos: 10.1, 10.4_
  - [x] 21.7 Escopar Inadimplentes ao futebol ativo
    - Lista de atrasados do clube ativo; mensagem WhatsApp usa a chave Pix do clube
    - _Requisitos: 13.1, 13.2_
  - [x] 21.8 Escopar Dashboards e "Meu extrato" ao futebol ativo
    - Cards/gráficos lendo as views com `where club_id = <ativo>`; "Meu extrato" usa `my_player_id(club_id)`; nunca cruza clubes
    - _Requisitos: 14.1, 14.8, 14.9_
  - [x] 21.9 Escopar Pix à configuração do futebol ativo
    - `StaticPixProvider` recebe chave/recebedor/cidade da `settings` do clube ativo; bloquear QR se faltar config do clube
    - _Requisitos: 12.1, 12.8_
  - [x] 21.10 Evoluir crons para iterar por futebol
    - `gerar-mensalidades` e `gerar-recorrentes` percorrem os clubes ativos, leem a `settings` de cada um e geram cobranças/lançamentos escopados; a service role filtra explicitamente por `club_id` em cada iteração; falha em um clube não aborta os demais
    - _Requisitos: 10.2, 11.1, 17.6, 19.4_
  - [ ]* 21.11 Testes de escopo por clube nos módulos refatorados
    - Operações em um clube não afetam/leem outro; crons não cruzam dados entre clubes
    - _Requisitos: 6.5, 17.6_

- [x] 22. Checkpoint — garantir que os testes passam
  - Garanta que todos os testes passem; pergunte ao usuário em caso de dúvida.

- [x] 23. Shell de UI — navegação lateral
  - [x] 23.1 Sidebar lateral (drawer mobile-first) substituindo a nav do topo
    - `components/layout/Sidebar.tsx`: drawer colapsável em telas pequenas, fixa em telas largas; links filtrados pelo papel no clube ativo; nome do usuário, papel e logout; estados especiais "sem futebol" e "presidente aprovado sem clube" (CTA criar futebol)
    - _Requisitos: 7.2, 7.5, 18.3_
  - [x] 23.2 Club switcher e entrada de admin de plataforma na sidebar
    - Seletor de troca de futebol quando houver >1 membership ativa (um só clube mostra o nome sem seletor); troca o `club_id` ativo (rota/cookie); entrada de administração da plataforma visível só para `system_admin`
    - _Requisitos: 7.3, 7.4, 7.6_

- [x] 24. Seed e documentação multi-tenant
  - [x] 24.1 Reescrever `seed.sql` para multi-tenant
    - Criar um `system_admin` de exemplo (`is_system_admin=true`), um futebol de exemplo com seu presidente (membership `presidente` ativa), alguns membros (jogadores vinculados a `players`), categorias e `settings` do clube e ~6 meses de lançamentos/cobranças — tudo escopado ao `club_id` de exemplo
    - _Requisitos: 19.1_
  - [x] 24.2 Atualizar README/docs para o modelo multi-tenant
    - Documentar os papéis (system_admin/presidente/tesoureiro/jogador), onboarding "sem futebol", fluxo de convite, criação de futebol e que `settings`/categorias são por clube; migrations via Supabase CLI e crons por clube
    - _Requisitos: 19.2, 19.3, 19.4_

- [x] 25. Testes de integração e RLS multi-tenant
  - [x] 25.1 Isolamento entre futebóis (RLS)
    - Usuário do clube A não lê dados do clube B em nenhuma tabela nem view; `club_id` indevido na UI retorna vazio/negação
    - _Requisitos: 6.3, 6.4, 6.5_
  - [x] 25.2 Escopo do jogador e bypass do system_admin
    - Jogador restrito aos próprios dados e aos agregados do clube; sem acesso direto a `transactions`; `system_admin` enxerga todos os clubes sem vazar para os demais papéis
    - _Requisitos: 6.6, 6.7, 14.8_
  - [x] 25.3 Fluxos de ciclo de vida e idempotência por clube
    - Atomicidade da criação de clube; convite→aprovação→vínculo com `players`; guarda do último presidente; idempotência dos crons por clube
    - _Requisitos: 3.6, 4.6, 5.1, 10.3, 11.2_

- [x] 26. Checkpoint final — garantir que os testes passam
  - Garanta que todos os testes passem; pergunte ao usuário em caso de dúvida.

## Notas (evolução multi-tenant)

- Tarefas marcadas com `*` são testes opcionais e podem ser puladas para um MVP mais rápido.
- Cada tarefa referencia requisitos específicos (R1–R19) para rastreabilidade.
- Os checkpoints garantem validação incremental.
- As tarefas das seções 1–15 permanecem concluídas e não são retocadas; a evolução parte de reset de dados (sem backfill).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["16.1", "16.3"] },
    { "id": 1, "tasks": ["16.2", "16.4"] },
    { "id": 2, "tasks": ["16.5", "16.6", "17.1"] },
    { "id": 3, "tasks": ["17.2", "17.3", "17.4", "17.5"] },
    { "id": 4, "tasks": ["18.1", "18.2", "18.3"] },
    { "id": 5, "tasks": ["19.1", "19.2", "19.3", "20.1"] },
    { "id": 6, "tasks": ["19.4", "20.2", "20.3", "20.4"] },
    { "id": 7, "tasks": ["20.5", "21.1", "21.2", "21.3"] },
    { "id": 8, "tasks": ["21.4", "21.5", "21.6", "21.7"] },
    { "id": 9, "tasks": ["21.8", "21.9", "21.10"] },
    { "id": 10, "tasks": ["21.11", "23.1"] },
    { "id": 11, "tasks": ["23.2", "24.1", "24.2"] },
    { "id": 12, "tasks": ["25.1", "25.2", "25.3"] }
  ]
}
```
