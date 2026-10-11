# Requisitos — FutCaixa

## Introdução

O FutCaixa é uma **plataforma web multi-tenant** para gestão financeira de futebóis recreativos. Cada **futebol** (clube) é um **tenant** isolado, com seus próprios jogadores, lançamentos, cobranças, despesas recorrentes, metas, categorias, configurações, auditoria, comprovantes e views agregadas. Uma mesma pessoa pode participar de **vários futebóis**, com um papel diferente em cada um.

O objetivo central continua sendo dar **transparência** ao caixa de cada futebol: presidentes e tesoureiros lançam receitas e despesas, jogadores acompanham a saúde financeira por dashboards e pagam suas cobranças via Pix (QR Code estático). Uma aba pública de sorteio de times permanece acessível sem login.

A autenticação é por **e-mail + senha com cadastro aberto** (o magic link foi removido). Qualquer pessoa pode criar uma conta, mas **uma conta recém-criada não tem acesso a nenhum futebol**: parte de um estado "sem futebol" e só ganha acesso ao (a) abrir um link de convite de um futebol (entra como membro `pendente`) ou (b) solicitar e ser aprovada como presidente e então criar o próprio futebol.

Presença, notificações e integração com API de WhatsApp **não** fazem parte deste escopo (são tratadas em outro app).

### Diretrizes transversais

- Interface 100% em português (pt-BR).
- Valores monetários em BRL, exibidos no formato `R$ 1.234,56` e **armazenados em centavos** (inteiro), nunca em ponto flutuante.
- Datas e horas no formato brasileiro (`dd/mm/aaaa`), fuso `America/Sao_Paulo`.
- Mobile-first: a maioria dos acessos é por celular.
- PWA instalável, funcional no Safari/iOS e Chrome/Android.
- **Reset de dados:** na evolução para a estrutura multi-tenant os dados existentes são **descartados** (reset limpo); o ambiente parte sem clubes, exigindo criação de futebol por um presidente aprovado (e, opcionalmente, um `system_admin` semeado via SQL).

### Perfis de acesso

| Perfil | Escopo | Como é definido | Descrição |
|---|---|---|---|
| **system_admin** | Plataforma | Flag `is_system_admin` em `profiles`, definido via SQL/seed (nunca self-service) | Administrador da plataforma. Aprova solicitações de presidência, vê e gerencia todos os futebóis e **ignora o escopo por tenant** (bypass de `club_id`). |
| **presidente** | Por futebol | `memberships.role = 'presidente'` com `status = 'ativo'` | Administrador de um futebol. Após aprovado, cria e administra **um ou mais futebóis** (dashboards, lançamentos, cobranças, configurações, categorias, jogadores), convida jogadores, aprova membros e promove/rebaixa membros no seu futebol. |
| **tesoureiro** | Por futebol | `memberships.role = 'tesoureiro'` | Lançamentos financeiros e aprovação de pagamentos do futebol. Não gerencia membros nem configurações sensíveis. |
| **jogador** | Por futebol | `memberships.role = 'jogador'` | Vê dashboards agregados do futebol, o próprio extrato e as próprias cobranças, e paga via Pix. |
| **público** | — | Sem login | Acessa apenas a aba de Sorteio (`/sorteio`) e a abertura de um link de convite (`/convite/<codigo>`). |

O papel **não é global**: ele vive em uma linha de `memberships` por par (usuário, futebol). A mesma pessoa pode ser presidente de um futebol, jogador de outro e tesoureiro de um terceiro.

---

## Requisito 1 — Autenticação por e-mail e senha (cadastro aberto)

**História de usuário:** Como visitante, quero criar uma conta com e-mail e senha e entrar/sair livremente, para começar a usar a plataforma sem depender de pré-cadastro por um administrador.

### Critérios de aceitação

1. QUANDO uma pessoa acessa o cadastro informando nome, e-mail e senha THEN o sistema SHALL criar uma conta via Supabase Auth (e-mail + senha) e criar o perfil correspondente em `profiles`.
2. QUANDO uma conta é criada THEN o sistema SHALL iniciar o perfil com `is_system_admin = false` e `president_status = none`, sem nenhuma membership de futebol.
3. QUANDO um usuário entra informando e-mail e senha válidos THEN o sistema SHALL autenticá-lo e carregar o perfil a partir de `profiles`.
4. SE o e-mail ou a senha informados no login forem inválidos THEN o sistema SHALL negar o acesso com uma mensagem genérica, sem revelar se o e-mail existe.
5. QUANDO um usuário solicita sair (logout) THEN o sistema SHALL encerrar a sessão do Supabase e redirecionar para a tela de login.
6. ENQUANTO um usuário autenticado não tiver nenhuma membership `ativa` o sistema SHALL tratá-lo como "sem futebol" e direcioná-lo à tela de onboarding (solicitar presidente ou abrir um convite).
7. ENQUANTO um usuário não estiver autenticado o sistema SHALL permitir acesso apenas à aba pública de Sorteio (`/sorteio`) e à abertura de um link de convite (`/convite/<codigo>`).
8. O sistema SHALL aplicar as regras de autorização no servidor via RLS no Postgres, não apenas na interface.

---

## Requisito 2 — Solicitação e aprovação de presidente

**História de usuário:** Como usuário sem futebol, quero solicitar o papel de presidente e ser aprovado pelo administrador da plataforma, para então poder criar e administrar meus próprios futebóis.

### Critérios de aceitação

1. QUANDO um usuário autenticado solicita ser presidente THEN o sistema SHALL alterar `profiles.president_status` para `pendente`.
2. ENQUANTO `president_status` for `pendente` ou `none` o sistema SHALL impedir que o usuário crie futebóis.
3. QUANDO um `system_admin` abre a tela de solicitações de presidente THEN o sistema SHALL listar os usuários com `president_status = pendente`.
4. QUANDO um `system_admin` aprova uma solicitação THEN o sistema SHALL alterar `president_status` para `aprovado` e registrar a ação no log de auditoria.
5. SE um usuário que não é `system_admin` tenta aprovar uma solicitação de presidente THEN o sistema SHALL negar a ação.
6. QUANDO `president_status` for `aprovado` THEN o sistema SHALL permitir que o usuário crie futebóis.
7. O sistema SHALL permitir que cada usuário leia o próprio `president_status`, e SHALL restringir a leitura de solicitações de terceiros ao `system_admin`.

---

## Requisito 3 — Criação de futebol (tenant)

**História de usuário:** Como presidente aprovado, quero criar um futebol informando seus dados e parâmetros financeiros, para administrar seu caixa de forma isolada.

### Critérios de aceitação

1. QUANDO um presidente aprovado cria um futebol informando nome, chave Pix, nome do recebedor, cidade e valores padrão THEN o sistema SHALL criar uma linha em `clubs` de forma atômica.
2. QUANDO um futebol é criado THEN o sistema SHALL criar automaticamente a linha de `settings` daquele futebol (uma linha por futebol).
3. QUANDO um futebol é criado THEN o sistema SHALL semear as categorias padrão daquele futebol (despesa: Quadra, Bolas, Coletes, Arbitragem, Goleiro, Água/Gelo, Confraternização, Outros; receita: Mensalidade, Avulso, Multa, Doação, Vaquinha, Outros).
4. QUANDO um futebol é criado THEN o sistema SHALL criar a membership do criador com `role = presidente` e `status = ativo`.
5. QUANDO um futebol é criado THEN o sistema SHALL gerar um `invite_code` único e **estável que não expira**, usado no link `/convite/<codigo>`.
6. SE qualquer etapa da criação do futebol falhar THEN o sistema SHALL não deixar o futebol parcialmente criado (operação atômica), de modo que `clubs`, `settings`, categorias e a membership de presidente existam juntos ou nenhum exista.
7. QUANDO a criação do futebol conclui THEN o sistema SHALL registrar a ação no log de auditoria.

---

## Requisito 4 — Convite por link e aprovação de membros

**História de usuário:** Como presidente, quero convidar jogadores por um link fixo e aprovar quem entrar, vinculando cada aprovado a um registro de jogador, para montar o grupo do meu futebol.

### Critérios de aceitação

1. QUANDO qualquer pessoa abre `/convite/<codigo>` com um código válido THEN o sistema SHALL identificar o futebol correspondente ao `invite_code`.
2. SE a pessoa que abre o convite não tiver conta THEN o sistema SHALL permitir o cadastro (e-mail + senha); SE já tiver conta THEN o sistema SHALL permitir o login.
3. QUANDO uma pessoa autenticada abre um convite válido THEN o sistema SHALL criar (ou reaproveitar) uma membership daquele futebol com `role = jogador` e `status = pendente`.
4. ENQUANTO a membership estiver `pendente` o sistema SHALL informar que o acesso aguarda aprovação do presidente e SHALL impedir o acesso aos dados do futebol.
5. QUANDO um presidente abre a tela de membros pendentes THEN o sistema SHALL listar as memberships `pendentes` do seu futebol.
6. QUANDO um presidente aprova um membro escolhendo o tipo (`mensalista` ou `avulso`) THEN o sistema SHALL criar automaticamente (ou vincular a um existente) um registro em `players` daquele futebol com o tipo escolhido e SHALL preencher `memberships.player_id` com esse jogador, alterando `status` para `ativo`.
7. QUANDO um membro é aprovado como `avulso` THEN o sistema SHALL não incluí-lo na geração automática de mensalidades (sua receita entra como avulso).
8. SE um usuário que não é presidente do futebol tenta aprovar um membro THEN o sistema SHALL negar a ação.
9. QUANDO um membro é aprovado THEN o sistema SHALL registrar a ação no log de auditoria do futebol.

---

## Requisito 5 — Papéis por futebol e promoção de membros

**História de usuário:** Como presidente, quero promover e rebaixar membros entre jogador, tesoureiro e presidente dentro do meu futebol, para delegar a administração conforme necessário.

### Critérios de aceitação

1. QUANDO um presidente promove ou rebaixa um membro do seu futebol THEN o sistema SHALL atualizar `memberships.role` para `jogador`, `tesoureiro` ou `presidente`.
2. O sistema SHALL garantir no máximo uma membership por par (usuário, futebol) (`unique (user_id, club_id)`).
3. O sistema SHALL determinar o papel do usuário no futebol ativo exclusivamente a partir de `memberships`, nunca de `profiles`.
4. O sistema SHALL permitir que uma mesma pessoa tenha papéis diferentes em futebóis diferentes e participe de vários futebóis.
5. SE um usuário que não é presidente do futebol tenta alterar o papel de um membro THEN o sistema SHALL negar a ação.
6. QUANDO o papel de um membro é alterado THEN o sistema SHALL registrar a ação no log de auditoria do futebol.

---

## Requisito 6 — Isolamento multi-tenant (não-funcional, crítico)

**História de usuário:** Como presidente e como jogador, quero que os dados de cada futebol fiquem totalmente isolados, para que nenhum futebol veja os dados de outro e cada pessoa só acesse o que lhe compete.

### Critérios de aceitação

1. O sistema SHALL carregar `club_id` em todas as tabelas de domínio (jogadores, categorias, lançamentos, cobranças, despesas recorrentes, metas, comprovantes, configurações e auditoria quando aplicável).
2. O sistema SHALL habilitar RLS em TODAS as tabelas, com políticas que filtram por `club_id` **E** pelo papel do usuário naquele futebol (via `memberships`).
3. ENQUANTO um usuário não tiver membership `ativa` em um futebol o sistema SHALL impedir leitura e escrita de qualquer dado daquele futebol.
4. SE a interface enviar um `club_id` ao qual o usuário não pertence THEN o sistema SHALL retornar conjunto vazio ou negar a escrita por RLS, independentemente da seleção da interface.
5. O sistema SHALL impedir que um futebol acesse dados de outro futebol em qualquer tabela ou view agregada.
6. O sistema SHALL restringir o jogador aos agregados do seu futebol e às próprias cobranças/pagamentos (`player_id = my_player_id(club_id)`), sem acesso ao detalhe financeiro de terceiros.
7. O `system_admin` SHALL ser a única exceção ao escopo por tenant (bypass de `club_id`) para fins de administração da plataforma.
8. O caminho dos comprovantes em Storage SHALL incluir o `club_id` e o acesso SHALL respeitar "dono da cobrança ou gestor do mesmo futebol".

---

## Requisito 7 — Futebol ativo e navegação lateral

**História de usuário:** Como usuário que participa de um ou mais futebóis, quero uma navegação lateral que mantenha um "futebol ativo" e me deixe trocar de futebol, para operar no contexto certo e sair quando quiser.

### Critérios de aceitação

1. O sistema SHALL manter um "futebol ativo" que determina de qual futebol os dados são exibidos, derivado do segmento de rota e/ou de um cookie/parâmetro de futebol selecionado.
2. O sistema SHALL exibir uma sidebar lateral (drawer colapsável em telas pequenas, fixa em telas largas) com os links de navegação filtrados pelo papel do usuário no futebol ativo.
3. WHERE o usuário tem membership `ativa` em mais de um futebol o sistema SHALL exibir um seletor de troca de futebol na sidebar.
4. WHERE o usuário participa de um único futebol o sistema SHALL exibir o nome do futebol sem seletor.
5. O sistema SHALL exibir na sidebar o nome do usuário, seu papel no futebol ativo e a ação de logout.
6. WHERE o usuário é `system_admin` o sistema SHALL exibir na sidebar a entrada de administração da plataforma (futebóis e solicitações de presidente).
7. SE o `club_id` do futebol ativo não corresponder a uma membership `ativa` do usuário THEN o sistema SHALL redirecioná-lo para o seletor de futebol ou para a tela "sem futebol".

---

## Requisito 8 — Gestão de jogadores (por futebol)

**História de usuário:** Como presidente, quero cadastrar e manter os jogadores do meu futebol, para controlar quem é mensalista, quem é isento e os valores aplicáveis a cada um.

### Critérios de aceitação

1. QUANDO um presidente cadastra um jogador no futebol ativo THEN o sistema SHALL registrar `club_id`, nome, apelido, e-mail, telefone, tipo (`mensalista` | `avulso` | `convidado`), status (`ativo` | `inativo`), nível técnico (1 a 3) e isento (booleano).
2. SE o jogador for marcado como isento THEN o sistema SHALL exigir um motivo (ex.: "goleiro").
3. QUANDO um presidente define um valor personalizado de mensalidade ou avulso para um jogador THEN o sistema SHALL usar esse valor no lugar do valor padrão das Configurações do futebol.
4. SE um jogador não tiver valor personalizado THEN o sistema SHALL aplicar o valor padrão definido nas Configurações do futebol.
5. O sistema SHALL validar o formato de e-mail e telefone antes de salvar.
6. QUANDO um presidente inativa um jogador THEN o sistema SHALL deixar de incluí-lo na geração automática de mensalidades do futebol, preservando seu histórico.
7. O nível técnico (1 a 3) SHALL poder ser utilizado como peso no algoritmo de sorteio de times.
8. Apenas o `presidente` do futebol SHALL criar, editar ou inativar jogadores daquele futebol.

---

## Requisito 9 — Lançamentos financeiros (por futebol)

**História de usuário:** Como presidente ou tesoureiro, quero registrar receitas e despesas do meu futebol com categoria e comprovante, para manter o caixa auditável e transparente.

### Critérios de aceitação

1. QUANDO um presidente ou tesoureiro cria um lançamento THEN o sistema SHALL registrar `club_id`, data, valor (em centavos), tipo (`receita` | `despesa`), categoria (do mesmo futebol), descrição, jogador vinculado (opcional, do mesmo futebol) e comprovante (opcional, em Storage).
2. O sistema SHALL oferecer, por futebol, as categorias semeadas na criação do futebol apenas como ponto de partida.
3. QUANDO um presidente gerencia categorias THEN o sistema SHALL permitir criar novas, renomear e reordenar quaisquer categorias do futebol (inclusive as semeadas) e ativar/desativar categorias.
4. SE uma categoria já estiver vinculada a lançamentos existentes THEN o sistema SHALL permitir desativá-la mas NÃO SHALL apagá-la, preservando o histórico.
5. QUANDO uma categoria é desativada THEN o sistema SHALL manter os lançamentos antigos exibindo a categoria original.
6. QUANDO um presidente ou tesoureiro lança uma despesa do dia do jogo THEN o sistema SHALL permitir informar a data do jogo, a categoria (ex.: Goleiro) e uma descrição livre, opcionalmente vinculando o jogador relacionado.
7. QUANDO um usuário anexa um comprovante THEN o sistema SHALL armazená-lo em bucket privado (caminho com o `club_id`) e servir o acesso por URL assinada.
8. QUANDO um lançamento é excluído THEN o sistema SHALL aplicar soft delete em vez de remover o registro.
9. QUANDO um lançamento é criado, editado ou excluído THEN o sistema SHALL registrar a ação no log de auditoria do futebol com usuário, data/hora e valores antes/depois.
10. O sistema SHALL rejeitar valores monetários menores ou iguais a zero.
11. Apenas `presidente` e `tesoureiro` do futebol SHALL criar, editar ou excluir lançamentos daquele futebol.

---

## Requisito 10 — Despesas recorrentes (por futebol)

**História de usuário:** Como tesoureiro, quero cadastrar despesas que se repetem no meu futebol (ex.: aluguel mensal da quadra), para que sejam lançadas automaticamente sem trabalho manual.

### Critérios de aceitação

1. QUANDO um presidente ou tesoureiro cadastra uma despesa recorrente THEN o sistema SHALL registrar `club_id`, valor, categoria, descrição, dia do mês e periodicidade.
2. QUANDO chega o dia configurado de uma despesa recorrente ativa THEN o sistema SHALL gerar automaticamente o lançamento de despesa correspondente, escopado ao `club_id`, via rotina agendada (cron) que itera por futebol.
3. SE a rotina de geração rodar mais de uma vez no mesmo período THEN o sistema SHALL evitar duplicar o lançamento já gerado (idempotência por futebol, via `last_generated_period`).
4. QUANDO uma despesa recorrente é desativada THEN o sistema SHALL parar de gerar novos lançamentos a partir dela, preservando os já gerados.

---

## Requisito 11 — Cobranças (por futebol)

**História de usuário:** Como tesoureiro, quero gerar e acompanhar as cobranças dos jogadores do meu futebol, para controlar quem pagou e quem está em atraso.

### Critérios de aceitação

1. QUANDO chega o dia configurado de geração de um futebol THEN o sistema SHALL criar automaticamente, via cron que itera por futebol, as cobranças de mensalidade de todos os jogadores `mensalista`, `ativo` e **não isentos** daquele futebol.
2. SE a geração mensal já tiver criado a cobrança de um jogador no período THEN o sistema SHALL não duplicar a cobrança (idempotência por `club_id` + jogador + período).
3. QUANDO um presidente ou tesoureiro cria uma cobrança avulsa THEN o sistema SHALL registrar `club_id`, jogador, valor, descrição e vencimento (ex.: avulso do jogo, multa, vaquinha).
4. O sistema SHALL manter o status da cobrança como `pendente`, `em_analise`, `paga` ou `cancelada`.
5. O sistema SHALL calcular "atrasada" de forma derivada (vencimento no passado E status `pendente`), nunca armazenando esse estado.
6. QUANDO uma cobrança é marcada como `paga` THEN o sistema SHALL gerar automaticamente o lançamento de receita correspondente, vinculado ao jogador e ao futebol.
7. QUANDO uma cobrança é cancelada THEN o sistema SHALL registrar a ação no log de auditoria do futebol.
8. O vencimento SHALL ser configurável nas Configurações do futebol.

---

## Requisito 12 — Pagamento via Pix (QR Code estático, por futebol)

**História de usuário:** Como jogador, quero pagar minha cobrança via Pix por QR Code e anexar o comprovante, para quitar minha dívida de forma simples pelo celular.

### Critérios de aceitação

1. QUANDO um jogador abre uma cobrança para pagamento THEN o sistema SHALL gerar um QR Code Pix **estático** no padrão BR Code / EMV do Banco Central, a partir da configuração Pix do futebol ativo (chave, recebedor e cidade da `settings` do futebol).
2. O payload Pix SHALL conter valor da cobrança, nome do recebedor, cidade e um `txid` único por cobrança.
3. O sistema SHALL calcular o CRC16 (CCITT-FFFF) do payload corretamente e SHALL cobrir esse cálculo com testes unitários.
4. QUANDO o QR Code é exibido THEN o sistema SHALL também disponibilizar um botão "Pix copia e cola" com o mesmo payload.
5. QUANDO o jogador anexa um comprovante (imagem ou PDF) THEN o sistema SHALL mudar o status da cobrança para `em_analise` e armazenar o arquivo em bucket privado (caminho com o `club_id`).
6. QUANDO um presidente ou tesoureiro do futebol aprova um pagamento `em_analise` THEN o sistema SHALL mudar o status para `paga`, gerar o lançamento de receita e registrar a aprovação no log de auditoria.
7. QUANDO um presidente ou tesoureiro do futebol rejeita um pagamento `em_analise` THEN o sistema SHALL voltar o status para `pendente` e registrar o motivo no log de auditoria.
8. SE a chave Pix, o nome do recebedor ou a cidade do futebol não estiverem configurados THEN o sistema SHALL impedir a geração do QR Code e orientar a configuração.
9. O sistema SHALL abstrair a camada de pagamento numa interface `PaymentProvider`, com a implementação atual `StaticPixProvider`, de modo que um PSP com Pix dinâmico e webhook possa ser plugado no futuro sem reescrever as regras de cobrança.

---

## Requisito 13 — Inadimplentes (por futebol)

**História de usuário:** Como tesoureiro, quero ver quem está em atraso no meu futebol e gerar uma mensagem pronta de cobrança, para cobrar o grupo pelo WhatsApp sem digitar tudo à mão.

### Critérios de aceitação

1. QUANDO um presidente ou tesoureiro abre a tela de inadimplentes THEN o sistema SHALL listar os jogadores do futebol ativo com cobranças atrasadas, mostrando nome, valor total devido e número de meses em atraso.
2. QUANDO o usuário clica em "Copiar mensagem" THEN o sistema SHALL gerar um texto formatado para WhatsApp (com emojis, total por jogador, chave Pix do futebol e link do sistema) e copiá-lo para a área de transferência.
3. QUANDO o usuário clica em "Compartilhar no WhatsApp" THEN o sistema SHALL abrir `https://wa.me/?text=` com a mensagem pré-preenchida, sem usar nenhuma API do WhatsApp.
4. SE o usuário ativar a opção "ocultar valores individuais" THEN o sistema SHALL gerar a mensagem sem expor o valor devido por cada jogador.

---

## Requisito 14 — Dashboards (por futebol, jogadores logados)

**História de usuário:** Como jogador, quero acompanhar a saúde financeira do caixa do meu futebol por gráficos e cards, para confiar na transparência da gestão sem ver os dados individuais dos outros.

### Critérios de aceitação

1. QUANDO um jogador acessa o dashboard THEN o sistema SHALL exibir, escopados ao futebol ativo, cards de saldo atual em caixa, receitas do mês, despesas do mês e % de adimplência do mês.
2. O sistema SHALL exibir um gráfico de receitas vs despesas mês a mês dos últimos 12 meses do futebol ativo.
3. O sistema SHALL exibir um gráfico de despesas por categoria (do mês e acumulado no ano) do futebol ativo.
4. O sistema SHALL exibir a evolução do saldo ao longo do tempo do futebol ativo.
5. O sistema SHALL exibir o "Runway": quantos meses o caixa do futebol cobre, com base na média de despesas dos últimos 3 meses.
6. O sistema SHALL exibir metas/vaquinhas do futebol com barra de progresso (ex.: "Jogo de camisas — R$ 800 — 62%").
7. O sistema SHALL exibir a lista das últimas despesas do futebol com comprovante visível (transparência).
8. Os dashboards SHALL ler de **views agregadas** no Postgres, sempre filtrando por `club_id`; um jogador NUNCA SHALL acessar dados individuais de outro jogador nem dados de outro futebol.
9. QUANDO um jogador acessa "Meu extrato" THEN o sistema SHALL mostrar apenas as cobranças e pagamentos do próprio jogador no futebol ativo.

---

## Requisito 15 — Sorteio de times (público, sem login)

**História de usuário:** Como organizador no dia do jogo, quero sortear times equilibrados a partir de uma lista de nomes e níveis, para formar jogos justos rapidamente, mesmo sem estar logado.

### Critérios de aceitação

1. ENQUANTO o usuário estiver sem login o sistema SHALL permitir o acesso completo à aba de Sorteio.
2. QUANDO o usuário monta a lista THEN o sistema SHALL permitir digitar nomes livres, atribuindo a cada um um nível de 1 a 3; WHERE o usuário está logado em um futebol o sistema SHALL opcionalmente permitir pré-carregar os jogadores do futebol ativo.
3. QUANDO o usuário configura o sorteio THEN o sistema SHALL aceitar o número de times e as cores dos times (ex.: Azul, Vermelho, Amarelo, Verde).
4. QUANDO o sorteio é executado THEN o sistema SHALL distribuir por rodadas: ordenar jogadores em potes por nível e, a cada rodada, cada time recebe exatamente 1 jogador, com a ordem dos times embaralhada a cada rodada.
5. O sistema SHALL garantir que as primeiras N retiradas produzam N cores de time diferentes.
6. O sistema SHALL distribuir os jogadores mais fracos de forma equilibrada entre os times, sem concentrá-los em um só.
7. SE o total de jogadores não dividir igualmente pelo número de times THEN o sistema SHALL distribuir as sobras em times diferentes.
8. QUANDO o usuário clica em "sortear de novo" THEN o sistema SHALL gerar um novo resultado respeitando as mesmas regras de equilíbrio.
9. QUANDO o usuário clica em "copiar resultado" THEN o sistema SHALL copiar um texto formatado para WhatsApp com os times.
10. O sorteio SHALL funcionar 100% no cliente e SHALL persistir o estado em localStorage para não perder a lista ao recarregar.
11. O algoritmo de sorteio SHALL ser coberto por testes unitários (distribuição de cores, equilíbrio de níveis e casos de sobra).

---

## Requisito 16 — Configurações do futebol (presidente)

**História de usuário:** Como presidente, quero configurar os dados do meu futebol e os parâmetros financeiros, para que cobranças, Pix e dashboards reflitam a realidade do grupo.

### Critérios de aceitação

1. QUANDO um presidente acessa Configurações THEN o sistema SHALL permitir definir, para o futebol ativo, nome do futebol, logo, chave Pix, nome do recebedor e cidade.
2. O sistema SHALL permitir definir, por futebol, valores padrão (mensalidade, avulso), dia de vencimento e dia de geração das mensalidades.
3. QUANDO um presidente define o saldo inicial do caixa THEN o sistema SHALL considerá-lo no cálculo do saldo atual exibido nos dashboards daquele futebol.
4. O sistema SHALL manter uma única linha de `settings` por futebol (`club_id` único).
5. SE a chave Pix, nome do recebedor ou cidade do futebol não estiverem configurados THEN o sistema SHALL impedir a geração de QR Code Pix e exibir uma mensagem orientando a configuração.
6. Apenas o `presidente` do futebol SHALL alterar as Configurações daquele futebol; `tesoureiro` e `jogador` SHALL ter acesso de leitura aos dados Pix.

---

## Requisito 17 — Segurança e auditoria (não-funcional)

**História de usuário:** Como presidente, quero que os dados sejam protegidos por regras de acesso no servidor e que ações sensíveis fiquem registradas, para garantir a integridade e a confiança do grupo.

### Critérios de aceitação

1. O sistema SHALL habilitar RLS em TODAS as tabelas, com políticas por `club_id` e por papel (presidente, tesoureiro, jogador), além do bypass de plataforma do `system_admin`.
2. O bucket de comprovantes SHALL ser privado, com caminho que inclui o `club_id`, e o acesso SHALL ocorrer apenas por URLs assinadas.
3. QUANDO ocorre uma ação sensível (aprovar pagamento, editar ou excluir lançamento, aprovar membro, criar futebol, aprovar presidente, alterar papel) THEN o sistema SHALL registrar no `audit_log` o usuário, a data/hora, o `club_id` (quando aplicável) e os valores antes/depois.
4. O sistema SHALL armazenar todos os valores monetários em centavos (inteiro), nunca em float.
5. Nenhum dado financeiro SHALL ser removido fisicamente; exclusões SHALL ser soft delete.
6. SE a rotina de cron usar a service role (bypass de RLS) THEN o sistema SHALL filtrar explicitamente por `club_id` em cada iteração para não cruzar dados entre futebóis.

---

## Requisito 18 — PWA e experiência mobile (não-funcional)

**História de usuário:** Como jogador, quero instalar o app no celular e usá-lo com conforto na tela pequena, para acessar rápido no dia a dia.

### Critérios de aceitação

1. O sistema SHALL fornecer um `manifest` e um service worker que o tornem instalável como PWA.
2. O PWA SHALL ser testado e funcional no Safari/iOS e no Chrome/Android.
3. A interface SHALL ser mobile-first, com navegação lateral (sidebar) e toques adequados a telas pequenas.
4. ENQUANTO offline o PWA SHALL exibir ao menos a shell do app e uma mensagem clara de indisponibilidade de dados.
5. O sistema SHALL evitar vazamento de dados entre futebóis no cache do service worker, chaveando o cache de dados por `club_id` ou invalidando-o na troca de futebol.

---

## Requisito 19 — Entregáveis e operação (não-funcional)

**História de usuário:** Como desenvolvedor/organizador, quero dados de exemplo, documentação e crons configurados, para subir o sistema e visualizar os dashboards sem esforço.

### Critérios de aceitação

1. O sistema SHALL incluir um `seed.sql` que crie um futebol de exemplo com seu presidente (membership `presidente` ativa), alguns membros (jogadores vinculados a `players`), categorias e `settings` do futebol e ~6 meses de lançamentos, tudo escopado ao `club_id` de exemplo, e opcionalmente um `system_admin` de exemplo (`is_system_admin = true`).
2. O repositório SHALL conter um README com setup local, variáveis de ambiente, como rodar as migrations e como fazer o deploy na Vercel.
3. As migrations SHALL ser versionadas no repositório via Supabase CLI, adicionando `clubs`, `memberships`, `club_id` nas tabelas de domínio, `settings.club_id` único, `invite_code`, `is_system_admin`/`president_status` em `profiles` e as funções auxiliares e políticas RLS.
4. Os crons (geração de mensalidades e despesas recorrentes) SHALL estar configurados via Vercel Cron chamando Route Handlers protegidos por `CRON_SECRET`, iterando por futebol.
