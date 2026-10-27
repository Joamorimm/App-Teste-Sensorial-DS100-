# App Avaliação Olfativa DS100

Aplicação web (mobile-first) da Cork Supply para o gemba da prova sensorial DS100: **colocação de ordens nas mesas**, **provas dos provadores**, **MISU**, **levantamento (logística)** e **contadeira**, com histórico completo de movimentos. Substitui a versão Power Apps/Excel.

> **Estado atual (27/10/2026) — versão v88 (documentação de passagem).**
> A app está funcional, publicada no Railway e validada em testes no gemba. Tem 93 testes automáticos a passar.
> Antes de passar a produção definitiva, seguir a lista **"Passagem a produção"** em [`docs/BOAS_PRATICAS.md`](docs/BOAS_PRATICAS.md).

## Para quem chega agora — por onde começar

1. Ler este ficheiro (visão geral).
2. [`docs/REGRAS_DE_NEGOCIO.md`](docs/REGRAS_DE_NEGOCIO.md) — **como o processo funciona e porquê** (as regras que a app impõe).
3. [`docs/BOAS_PRATICAS.md`](docs/BOAS_PRATICAS.md) — operação diária, segurança, dados, como alterar a app sem partir nada, resolução de problemas.
4. [`PUBLICAR.md`](PUBLICAR.md) — GitHub → Railway, passo a passo.
5. [`docs/HISTORICO_DE_VERSOES.md`](docs/HISTORICO_DE_VERSOES.md) — o que mudou e quando.

## O que a app faz

Ecrã inicial com três áreas:

| Área | Quem usa | O que faz |
|---|---|---|
| **Provadores** | Provadores | Escolhem o nome, verificam e abrem a mesa, concluem a prova. Contador "N mesas feitas hoje" (toque para ver a lista). |
| **Logística** | Operador de colocação, MISU, operador de levantamento, supervisão | Separadores **Colocar**, **Levantar** (vistas *Mesas · MISU* e *Ordens · logística*) e **Editar · supervisora** (palavra-passe). |
| **Contadeira** | Contador/expedição | Regista, por OP, rolhas OK, ligeiras, QVs e sobras; vê encomenda e tipo de cliente. |

### Fluxo ponta a ponta (um dia de prova)

```
Dia D-1  Colocar        Operador regista a ORDEM (OP), frascos, rolhas/frasco, tipo de cliente,
                        contadeira, DSROL, encomenda e "continua amanhã?" → a app reparte pelas mesas
Dia D    Provadores     2 provadores por mesa (3 em AMOSTRA) fecham a prova → a mesa fica pronta
         MISU           Conta rolhas de aroma ligeiro/forte por ordem (só fortes se a ordem vai à contadeira)
         Levantar       Logística levanta a ORDEM (sem contadeira: QVs + levantar num só passo)
         Contadeira     Conta OK, ligeiras, QVs e sobras da OP; fecha o dia / 1.º fecho
         Ordem fecha    Se "continua amanhã = Não" soma os dias e compara com a encomenda (OK / pendente)
         Supervisão     Corrige valores, decide pendentes, reabre etapas, restaura versões
```

## Arquitetura

- **Node.js ≥ 18 + Express** (um só serviço) · **PostgreSQL** (Railway) · **frontend em JavaScript puro** (sem framework) servido pelo próprio Express · PWA com *service worker* (cache *network-first*).
- Sem autenticação por utilizador: os provadores escolhem o nome numa lista; as ações da supervisão pedem a **palavra-passe da supervisora** (variável `PIN_SUPERVISORA`), validada no servidor.
- Tudo o que se escreve fica registado em `movimentos` (histórico). Antes de alterações importantes é guardada uma **versão** dos dados (restaurável).
- Fuso horário: **Europe/Lisbon** em todas as contas de dia (os contadores zeram à meia-noite de Lisboa).

### Estrutura do projeto

```
server.js              Servidor Express: todas as rotas /api e regras de colocação, MISU, levantamento, contadeira, supervisão
logic.js               Regras de disponibilidade de uma mesa para os provadores
levantamento.js        Cálculos derivados (aprovadas, contaminados, partidas) e agregação por OP
planeamento.js         Dias úteis, alternância dos lados A/B, sábados incluídos pela supervisão
colocacao.js           Algoritmo que reparte uma ordem pelas mesas (capacidade em frascos)
layout.js              Layout físico e capacidade de cada mesa (lado A: 42 mesas, lado B: 43)
db.js / migrate.js     Ligação ao PostgreSQL / aplicação do esquema
migrations/schema.sql  Esquema da base de dados (idempotente: corre a cada arranque)
public/                Frontend: index.html (ecrãs + CSS), app.js (lógica), sw.js (cache), manifest, ícones
tests/                 Testes automáticos (node --test + PGlite em memória)
docs/                  Documentação de passagem
railway.json           Configuração de deploy (healthcheck /api/saude)
```

### Base de dados (principais tabelas)

| Tabela | Conteúdo |
|---|---|
| `aprovadores` | Lista de provadores |
| `registos` | Provas (mesa, provador, abertura/fecho, estado) |
| `lotes` | Agregado por mesa e dia (provadores necessários, rolhas, MISU, levantamento) |
| `lote_ops` | **Ordens dentro de cada mesa** (frascos, rolhas/frasco, partidos, QVs, MISU por ordem) |
| `ordens` / `ordens_dia` | Encomenda, rolhas acrescentadas, decisão de falta; por dia: continua, QVs, levantamento |
| `contagens_op` | Contagem da contadeira por OP e dia (OK, ligeiras, sobras) |
| `dias_extra` | Sábados incluídos como dia útil |
| `movimentos` | **Histórico de todas as escritas** (nunca é apagado) |
| `versoes` | Cópias dos dados para "Restaurar versão anterior" (últimas 60) |
| `cargas_iniciais` | Marca que a carga de dados de teste já foi feita |

## Variáveis de ambiente

| Variável | Para quê | Valor |
|---|---|---|
| `DATABASE_URL` | Ligação ao Postgres (no Railway: `${{Postgres.DATABASE_URL}}`) | obrigatória em produção |
| `PIN_SUPERVISORA` | Palavra-passe da supervisão | **definir sempre**; se faltar, usa o valor por defeito de teste |
| `SEM_CARGA_INICIAL` | `1` = **não** carregar as ordens de teste no 1.º arranque | `1` em produção |
| `PORT` | Porta (o Railway define) | automática |
| `CARGA_DATA`, `SEED_TESTE`, `SEED_TESTE_PROVAS`, `FORCAR_CARGA_INICIAL` | Só para testes/demonstrações | não usar em produção |
| `DS100_PGLITE` | Base de dados em memória (só testes locais) | `1` só em testes |

## Correr e testar localmente

```bash
npm install
npm test                      # 93 testes, ~10 s, sem precisar de Postgres
DS100_PGLITE=1 npm start      # app local com base de dados em memória (http://localhost:3000)
```

Com Postgres real: copiar `.env.example` para `.env`, ajustar e correr `npm start`.

## Publicar

Cada *commit* no GitHub publica sozinho no Railway. Passo a passo em [`PUBLICAR.md`](PUBLICAR.md). **Antes de carregar uma versão nova correr `npm test`** e ler a checklist em `docs/BOAS_PRATICAS.md`.

## Estado conhecido e limitações

- **Feriados não existem no calendário**: o lado A/B alterna só em dias úteis (seg–sex). A supervisão pode **acrescentar sábados**, mas não retirar um feriado.
- **Âncora do lado:** 21/10/2026 = lado B (em `planeamento.js`); a alternância calcula-se a partir daí.
- **Palavra-passe única** da supervisão (sem utilizadores individuais) e **sem login real dos provadores** (escolha de nome).
- **Sem botão de limpar dados** no menu (retirado de propósito). Ver `docs/BOAS_PRATICAS.md` para limpar com segurança.
- `server.js` é grande (~1 500 linhas): possível melhoria futura é dividi-lo por módulos. Os testes dão rede de segurança para isso.
- O layout das mesas (`layout.js`) vem de "Layout DS100 Joana.xlsx": se a disposição física mudar, atualizar este ficheiro.
- Endpoints antigos de planeamento por Excel (`/api/planeamento/*`) e lotes manuais (`/api/lotes`) mantêm-se por compatibilidade; o fluxo atual é a colocação por ordem.

## Próximos passos sugeridos

1. Passagem a produção (checklist) e ativar backups do Postgres.
2. Utilizadores individuais para a supervisão (em vez de palavra-passe única).
3. Calendário de feriados (retirar dias úteis).
4. Relatórios/métricas além dos provadores (por OP, cliente, lado) e exportação para Excel.
5. Dividir `server.js` em módulos.
