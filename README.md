# App Avaliação Olfativa DS100 (versão web)

Aplicação web responsiva (mobile-first) que substitui a versão Power Apps, com
base de dados PostgreSQL própria. Pensada para ser publicada no Railway.

## O que já está feito (MVP)

- Login simples (escolher provador de uma lista)
- Leitura/introdução do código da mesa
- Verificação de disponibilidade (bloqueada / livre / lote completo / já feita hoje / outra mesa aberta)
- Abrir mesa e Concluir análise
- Contador de "mesas feitas hoje" por provador
- Regras replicadas: intervalo de 30 min entre usos da mesma mesa, 1 mesa aberta por provador,
  mesmo provador não repete a mesma mesa no mesmo dia, lote bloqueia ao atingir nº de provadores,
  mesas não planeadas abrem livremente.

## O que falta (próximas fases, fora do MVP)

- Importação automática do planeamento (equivalente ao fluxo Excel → Lotes do Power Automate)
- ScreenMesas (mapa visual das mesas)
- Filtro por provador, "amostra" com 3 provadores, critério extra de 20 min, alertas por email
- Autenticação real (hoje é só seleção de nome, sem password — igual ao que tínhamos no Power Apps)

Por agora, para testar com lotes planeados, usa o endpoint `POST /api/lotes` (ver abaixo) ou
corre o `migrations/seed-dev.sql` manualmente num ambiente de teste.

## Estrutura

```
server.js            # servidor Express + rotas da API
logic.js              # regras de negócio (disponibilidade da mesa)
db.js                 # ligação PostgreSQL
migrations/schema.sql # tabelas + lista de aprovadores (corre automaticamente a cada arranque)
migrations/seed-dev.sql # dados de exemplo só para testes locais
public/               # frontend (HTML/CSS/JS, mobile-first)
```

## Testar localmente

Precisas de um PostgreSQL local (ou usa Docker: `docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres`).

```
npm install
cp .env.example .env   # ajusta se necessário
npm start
```

Abre `http://localhost:3000` no telemóvel (mesma rede) ou no browser.

## Publicar no Railway

**Opção simples (recomendada), via Railway CLI — não precisa de GitHub:**

1. Cria conta em https://railway.app
2. Instala a CLI: `npm install -g @railway/cli`
3. Dentro desta pasta do projeto, corre:
   ```
   railway login
   railway init
   ```
4. No dashboard do Railway, no projeto criado, clica em **"+ New"** → **"Database"** → **"PostgreSQL"**.
   Isto cria automaticamente a variável `DATABASE_URL` que a app já sabe usar.
5. Ainda na pasta do projeto:
   ```
   railway up
   ```
6. No dashboard, vai a **Settings → Networking → Generate Domain** para obteres o link público (ex: `ds100.up.railway.app`).
7. Abre esse link no telemóvel — a app corre lá, com a base de dados a funcionar.

A cada arranque, a app aplica sozinha o `schema.sql` (cria tabelas e garante a lista de
aprovadores) — não precisas de correr nada manualmente.

**Alternativa**: ligar um repositório GitHub ao Railway (Deploy from GitHub repo) e dar push
ao código — o Railway faz o deploy automaticamente a cada push.

## Adicionar um Lote (planeamento) manualmente, por agora

Enquanto não temos a importação automática do Excel, podes criar um lote assim (por exemplo,
via Postman, ou com `curl` a partir de um computador):

```
curl -X POST https://<o-teu-link-railway>/api/lotes \
  -H "Content-Type: application/json" \
  -d '{"mesa":"A1","ordem":"15007239","numeroProvadores":2}'
```

Isto cria (ou atualiza) o lote dessa mesa para hoje. `ordem` e `numeroProvadores` são opcionais (default 2).


## Novidades (v12): Logística — mapa vermelho/verde e levantamento de mesas

## Novidades (v11)

- Ecrã inicial com **Provadores** e **Logística** (Logística ainda em construção) + ligação discreta para **Supervisão**.
- **Supervisão · alocar mesas**: a supervisora escolhe o dia de prova, carrega o `planeamento_*.xlsx`
  (folha DS100) e a app propõe intervalos de mesas por OP (frascos do dia anterior ÷ capacidade da mesa,
  lado A/B do dia, mesas seguidas). Pode ajustar os intervalos e confirmar — grava os lotes desse dia.
- Capacidade por defeito: 483 frascos/mesa (variável de ambiente `CAPACIDADE_MESA`).
- Os provadores veem no scanner as **mesas atribuídas hoje** (toque para preencher).

## Testes automáticos

`npm install` e depois `npm test` (36 testes, ~10 s, sem precisar de Postgres instalado).


## Palavra-passe da supervisora

Colocar/editar mesas na Logística pede a palavra-passe **8126**. Para mudar: Railway > Variables > `PIN_SUPERVISORA`.

## Levantamento (MISU, Contadeira, Logística)

- MISU: contaminados (aroma ligeiro e forte). Sem contadeira aponta ligeiras, fortes e QVs; com contadeira aponta só QVs e entrega.
- Contadeira: aponta o valor da máquina (ligeiras, fortes, aprovadas).
- Logística: aprovadas = total - (ligeiras + fortes) ou valor da contadeira; QVs somam colocação + MISU + logística.

- O MISU aponta sempre os aromas ligeiro e forte (à mesa) antes de a mesa seguir. A contadeira trabalha à OP, só entra depois de o MISU entregar todas as mesas da OP, e aponta as aprovadas.

## Palavra-passe da supervisora (8126)
- "Colocar · amanhã" é livre para a logística (sem palavra-passe).
- O separador "Editar · supervisora" (e qualquer alteração às mesas de HOJE a meio do processo) exige a palavra-passe (variável PIN_SUPERVISORA, por defeito 8126), validada no servidor.
- Validação final: uma mesa só pode ser levantada se o levantamento (MISU + contadeira) bater certo com o total de rolhas da colocação.

## Começar do zero
Já não há carregamento de Excel: a logística coloca as mesas no ecrã "Colocar · amanhã" (é o ecrã inicial da Logística).
Para limpar dados de teste: "Editar · supervisora" (palavra-passe) → "Limpar todos os dados de teste".
Para testar no próprio dia: "Editar · supervisora" → "Colocar mesas de HOJE (teste)".

## Colocação por ordem
A logística escreve o nº de ordem, os frascos, as rolhas por frasco (1, 2 ou 4), o tipo, a contadeira e o DSROL. A app calcula as mesas
com o layout e a capacidade de frascos de cada mesa (regra das filas de 7, com 1 fila de separação entre ordens). Várias ordens podem
partilhar a mesma mesa; cada uma tem as suas rolhas por frasco, frascos partidos e QVs. O total de rolhas da mesa é a soma das ordens.

## Contadeira por ordem
Sim ou não é decidido POR ORDEM, não por mesa. Numa mesa partilhada o MISU continua a trabalhar à mesa (uma só folha), mas aponta por ordem:
as ordens com contadeira só levam aromas fortes; as sem contadeira levam ligeiros e fortes (aprovadas = rolhas da ordem − ligeiros − fortes − partidas).
A contadeira trabalha à ordem. A mesa só é levantada quando o MISU apontou todas as ordens e a contadeira contou as ordens que lhe cabem.

## Menu da supervisora (palavra-passe)
Logística → Editar · supervisora abre um menu com: **Provadores** (adicionar, renomear, tirar/voltar à lista), **Provas de uma mesa** (editar ou apagar o que um provador registou hoje) e **Colocação e levantamento** (editar todos os campos, por ordem, de hoje ou de amanhã; corrigir o MISU e a contadeira). Tem ainda as ferramentas: colocar mesas de hoje (teste), descarregar o histórico e limpar dados de teste.
Numa mesa com várias ordens, cada ordem é identificada como A7-1, A7-2, ...

## Carga inicial para o teste no gemba
No primeiro arranque a app grava na base de dados as 6 ordens colocadas na sexta 23/10 (a mesa A7 com 5 ordens, etc.) para o **dia do arranque**, com as **provas dos provadores já feitas** em todas as mesas (A1 a A9). Fica tudo pronto para o MISU e a logística operarem o levantamento. Faz-se **uma só vez** (registado em `cargas_iniciais`). Para outro dia, define a variável `CARGA_DATA` (AAAA-MM-DD) antes do primeiro arranque. Para repetir a carga mais tarde: menu da supervisora → "Carregar ordens de teste com provas já feitas".

## Dados de teste (colocação de sexta 23/10 para a prova de segunda 26/10)
No menu da supervisora: **Carregar ordens de teste** (6 ordens, com a mesa 7 como no exemplo: 5 ordens na mesma mesa) ou **... com provas já feitas** (todas as mesas, menos a última, ficam prontas para o MISU/levantamento; a A7 tem 5 ordens).
Para a app arrancar já com estes dados, define no Railway (Variables): `SEED_TESTE=1` e, se quiseres as provas feitas, `SEED_TESTE_PROVAS=1`. As ordens carregam-se para o dia de hoje no arranque (sem duplicar). Retira as variáveis quando acabarem os testes.

## v56 · ordens de vários dias
- Colocar: campos "Quantidade encomendada (rolhas)" e "A ordem continua amanhã?".
- Se continua: a contadeira faz o 1.º fecho (parcial). O fecho final soma os dias; ≥ encomenda = OK, < = pendente para a supervisão (acrescentar rolhas ou aceitar a falta: Editar · supervisora → Ordens · encomenda e decisões).
- Levantar tem duas vistas: Mesas · MISU e Ordens · logística. O levantamento e as QVs da logística são por ordem; o MISU aponta as QVs por ordem.
- Sábado como dia útil por data: Editar · supervisora → Dias de trabalho.
- Botão de reinício só na página principal.

## v57
- MISU conta em frascos (×1/2/4 rolhas), sem QVs, e fica bloqueado depois de guardado.
- Logística: um só passo (QVs + levantar ordem); depois só a supervisora altera.
- Fluxo: MISU → levantamento (logística) → contadeira (rolhas OK + ligeiras, tem de bater com a colocação).
- Supervisora: Ordens · encomenda e decisões → reabrir MISU / levantamento / contagem.
- v58: a supervisora pode alterar o nº de provadores de uma mesa (Editar · supervisora → Provas de uma mesa).
- v59: pesquisa de OP nas vistas Ordens · logística e Contadeira.
- v60: menu da supervisora simplificado; só ficou o CSV de movimentos; Restaurar versão anterior (cópias automáticas dos dados).
- v61: Ordens · logística: por levantar a amarelo, levantada a verde.
- v62: a sessão da supervisora termina também ao mudar de aplicação / bloquear o ecrã.
- v63: blocos das ordens com contorno verde nítido.
- v64: botão Fechar fixo no topo de todas as folhas (sair sem guardar).
- v65: folhas compactas (2 colunas, ordens recolhíveis); contadores dos provadores e provas do dia passam a seguir o dia de Lisboa (zeram à meia-noite).
- v66: título 'Menu Supervisão'.
- v67: Ordens · logística em grelha de 2 cartões compactos; separadores Por levantar / Levantadas.
- v68: botão ↻ Limpar no formulário de Colocar.
- v69: MISU volta a contar em rolhas (valor real).
- v70: tocar em 'N mesas feitas hoje' mostra a lista de mesas (com hora de fecho).
- v71: Menu Supervisão → Provadores · provas, mesas e métricas (hoje/7/30 dias, CSV).
- v72: Menu Supervisão → Fechar provas em lote (intervalo de mesas, exceções, nº de provadores).
- v73: 'Tirar esta ordem' só na supervisão (exige palavra-passe).
- v74: rolhas partidas reais (nº real) na colocação e na edição; ecrãs dos provadores mostram frascos · rolhas partidas.
- v75: rótulo 'Quantidade total de frascos (a distribuir pelas mesas)'.
- v76: rótulo 'Quantidade total de frascos / mesas'.
- v77: ordens com contadeira: a logística só levanta; as QVs apontam-se na contadeira (junto das rolhas OK e ligeiras). Sem contadeira: igual.
- v78: 'Tipo' passa a 'Tipo de cliente' (EUR, GRUPO, AMOSTRA).
- v79: tipo de cliente visível nos ecrãs da logística (ordens e mesa) e da contadeira.
- v80: só um Fechar (topo) quando a janela não tem scroll; com scroll, também o do fundo.
- v81: Levantar começa vazio: só aparece a informação depois de escolher MISU ou Logística.
- v82: contadeira com campo Sobras (saco de 5 000 incompleto: fecha o dia, não entra no acumulado); pesquisa de OP redesenhada.
- v83: textos selecionáveis/copiáveis em toda a app (botões e mesas continuam sem seleção).
- v84: menu inicial: Provadores, Logística, Contadeira.
