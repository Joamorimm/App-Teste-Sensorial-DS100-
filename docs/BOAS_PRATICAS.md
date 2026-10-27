# Boas práticas e operação da app DS100

Guia para quem opera, mantém ou evolui a app **sem ter acompanhado a sua construção**.

## A. Operação diária (supervisão / quem gere o gemba)

**Antes do turno (≈ 5 min)**
1. Abrir a app no telemóvel (ícone no ecrã principal) e tocar no botão de reinício do ecrã inicial para garantir a versão mais recente.
2. Confirmar que a **logística colocou as ordens do dia seguinte** (Logística → Colocar: o mapa mostra mesas ocupadas).
3. Confirmar que o **lado do dia** está certo (mensagem "Hoje é o lado X" nos provadores) e que a lista de **provadores** está atualizada (Menu Supervisão → Provadores).
4. Ordem a continuar noutros dias: confirmar a **encomenda** e o "continua amanhã" (a app pré-preenche a encomenda se a OP já existir).

**Durante o turno**
- Provadores abrem/concluem mesas; MISU conta; logística levanta **a ordem**; contadeira regista OK, ligeiras, QVs e sobras.
- Se algo ficou mal registado: **não apagar nem refazer** — usar o Menu Supervisão (corrigir valores, reabrir etapa). Fica tudo registado.
- Se uma prova ficou aberta por esquecimento: Menu Supervisão → *Provas de uma mesa* → editar/fechar.
- Preciso de mais/menos provadores numa mesa: *Provas de uma mesa* → "Nº de provadores necessários".
- Sábado de trabalho: *Dias de trabalho* (só datas futuras e sábados).

**No fim do dia / semana**
- Ordens **pendentes**: Menu Supervisão → *Ordens* → acrescentar rolhas ou aceitar a falta.
- Semanalmente: **descarregar o CSV de movimentos** e as **métricas dos provadores** (7/30 dias) e arquivar.

## B. Segurança e acessos

- **Palavra-passe da supervisão**: variável `PIN_SUPERVISORA` no Railway. **Mudar o valor por defeito** antes de produção e **não a escrever em documentos partilhados**. Quem sai da equipa → trocar a palavra-passe no mesmo dia.
- Contas a transferir/rever quando alguém sai da empresa: **GitHub** (repositório `ds100-app`), **Railway** (projeto, domínio, faturação), e quem conhece a palavra-passe. Garantir **pelo menos 2 pessoas com acesso** a cada um.
- O repositório deve ser **privado**. Nunca guardar palavras-passe, `DATABASE_URL` ou ficheiros `.env` no GitHub.
- A app não tem login por pessoa: o registo "quem fez" dos provadores é a escolha do nome. A auditoria da supervisão é pela tabela `movimentos` (a palavra-passe é única).

## C. Dados, cópias de segurança e recuperação

- **Histórico (`movimentos`)** nunca é apagado. Descarregar em *Menu Supervisão → Descarregar movimentos (CSV)*.
- **Versões**: a app guarda uma cópia dos dados antes de alterações importantes e, no máximo, de 15 em 15 minutos (últimas 60). **Menu Supervisão → Restaurar versão anterior** repõe mesas, ordens, provas, MISU, contadeira e levantamentos (mantém o histórico). Antes de restaurar guarda o estado atual.
- **Backups do Postgres (obrigatório em produção)**: Railway → serviço **Postgres → Backups** → ativar cópias regulares. Fazer **um teste de restauro** uma vez, para saber como se faz.
- **Voltar uma versão do código**: Railway → *Deployments* → escolher um deploy anterior → *Redeploy*. (A restauração de versão na app é só dos **dados**.)
- **Limpar dados de teste**: não existe botão no menu (retirado de propósito para evitar acidentes). Opções seguras:
  1. *Restaurar versão anterior* escolhendo uma versão de antes dos testes; ou
  2. Pedir a quem mantém a app para chamar `POST /api/supervisora/reset` com `{"pin":"<palavra-passe>","confirmar":"APAGAR"}` (apaga mesas, ordens, provas, MISU/contadeira; **não** apaga `movimentos`, versões nem a lista de provadores).
  Fazer **sempre** um CSV de movimentos e confirmar que existe versão/backup antes.

## D. Passagem a produção (checklist — fazer uma vez)

1. [ ] No Railway → Variables: definir **`PIN_SUPERVISORA`** (nova) e **`SEM_CARGA_INICIAL=1`**. Remover `SEED_TESTE`, `SEED_TESTE_PROVAS`, `CARGA_DATA`, `FORCAR_CARGA_INICIAL` se existirem.
2. [ ] **Limpar os dados de teste** (secção C) e confirmar que o mapa está vazio.
3. [ ] Rever a **lista de provadores** (nomes reais, sem duplicados).
4. [ ] Ativar **backups do Postgres** e testar um restauro.
5. [ ] Confirmar **2 pessoas** com acesso a GitHub e Railway, e quem sabe a palavra-passe.
6. [ ] Confirmar o **domínio** da app e adicionar o atalho ao ecrã principal nos telemóveis do gemba.
7. [ ] Testar com o **Plano de teste por persona** (Excel) e arquivar o resultado.
8. [ ] Combinar o **canal de apoio**: quem recebe os problemas e como se regista (usar a folha *Registo de problemas*).

## E. Como alterar a app sem partir nada

1. Trabalhar **sempre** a partir da versão mais recente do repositório.
2. `npm install` e **`npm test` antes** de mexer (têm de passar todos).
3. Pequenas alterações, um assunto de cada vez. **Novas regras → novo teste** em `tests/api.test.js`.
4. Alterações à base de dados: **só adicionar** (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`) em `migrations/schema.sql`. Nunca apagar/renomear colunas em produção.
5. **Aumentar o nome da cache** em `public/sw.js` (`const CACHE = 'ds100-vNN'`) sempre que mudar ficheiros de `public/`; senão os telemóveis ficam com a versão antiga.
6. `npm test` outra vez → *commit* no GitHub → esperar o deploy → testar no telemóvel com um caso real.
7. Registar a alteração em `docs/HISTORICO_DE_VERSOES.md` e, se mudar uma regra, em `docs/REGRAS_DE_NEGOCIO.md`.
8. Fora do horário de prova (ou com a supervisão avisada): não publicar a meio de um turno.

Notas técnicas úteis:
- Os testes usam PGlite (Postgres em memória). Os testes que usam a palavra-passe errada devem ficar **no início** do ficheiro (existe limite de tentativas por IP).
- Contas de "hoje" usam sempre `Europe/Lisbon` (helpers em `planeamento.js` e SQL com `AT TIME ZONE 'Europe/Lisbon'`). Não usar `CURRENT_DATE`.
- Valores de mesa/ordem: o **frasco** é a unidade de colocação; as contas de MISU/contadeira são em **rolhas**.

## F. Resolução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Ecrã com aspeto/versão antiga | Cache do telemóvel | Botão de reinício do ecrã inicial; fechar e abrir a app |
| "Hoje é o lado X…" | Mesa do lado errado | Normal: usar mesas do lado do dia |
| Mesa "não planeada" | A logística não colocou essa mesa | Colocar a ordem (ou usar a mesa livre, se for intencional) |
| "Palavra-passe incorreta"/"Demasiadas tentativas" | 5 erros seguidos | Esperar 1 minuto |
| Contadeira não deixa guardar ("não bate") | Soma ≠ total da OP | Rever OK, ligeiras, fortes (MISU), partidas e sobras; corrigir MISU/partidas na supervisão se for o caso |
| Contadeira diz "ainda não levantada" | Falta levantar a ordem | Logística levanta primeiro |
| Não consigo levantar a ordem | Há mesas em prova ou MISU em falta | Ver a ordem (mensagem indica o que falta) |
| Ordem "pendente" | Acumulado < encomenda | Supervisão: acrescentar rolhas ou aceitar a falta |
| Valor gravado errado | Erro de digitação | Supervisão → corrigir valores / reabrir etapa |
| Dados "sumiram" depois de uma ação | Restauro/limpeza | *Restaurar versão anterior* ou backup do Postgres |
| App em baixo | Deploy falhou / Railway | Railway → Deployments → logs; *Redeploy* da versão anterior; verificar `/api/saude` |
| Lado A/B parece trocado num feriado | Feriados não estão no calendário | Ver limitações no README; falar com quem mantém a app |

## G. O que **nunca** fazer

- Apagar dados diretamente na base de dados sem backup/versão.
- Partilhar a palavra-passe da supervisão por canais abertos.
- Publicar alterações sem `npm test` a passar.
- Mudar regras de contas (somas, sobras, acumulado) sem atualizar testes e `REGRAS_DE_NEGOCIO.md`.
- Usar `CURRENT_DATE`/`new Date()` para datas "de hoje" (usar os helpers de Lisboa).
- Remover a tabela `movimentos` ou a lógica que a preenche (é a auditoria da operação).

## H. Contactos e responsabilidades (preencher)

| Papel | Nome | Contacto |
|---|---|---|
| Responsável pela app (negócio) | | |
| Responsável técnico (GitHub/Railway) | | |
| Suplente | | |
| Quem conhece a palavra-passe da supervisão | | |
