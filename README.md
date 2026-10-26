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
