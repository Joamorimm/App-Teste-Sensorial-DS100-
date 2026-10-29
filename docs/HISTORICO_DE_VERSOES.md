# Histórico de versões

Resumo por fases. Cada versão corresponde a um zip entregue (`ds100-app-web (vNN).zip`).

## Fases principais

- **Início (MVP)**: login de provador, leitura/escrita do código da mesa, abrir/concluir prova, contador de mesas feitas, regras herdadas do Power Apps (30 min entre usos da mesma mesa, 1 mesa aberta por provador, provador não repete a mesa no dia, lote bloqueia ao atingir o nº de provadores).
- **Logística (≈ v11–v12)**: mapa vermelho/verde, levantamento por mesa, planeamento a partir de Excel (mais tarde substituído pela colocação por ordem no ecrã).
- **Fases intermédias**: colocação por ordem, MISU/contadeira/levantamento, palavra-passe da supervisão, histórico de movimentos, publicação GitHub + Railway, carga inicial para o gemba, edição pela supervisão, provadores geridos na app, contadeira por ordem, A7-1/A7-2…
- **v56**: ordens de vários dias (encomenda, "continua amanhã", 1.º fecho, pendente/decisão da supervisão), sábados por data, levantamento por ordem, botão de reinício só no ecrã inicial.
- **v57**: fluxo MISU → levantamento → contadeira, bloqueios depois de registar, reabertura pela supervisão.
- **v58–v87**: ver o detalhe abaixo (UX, supervisão, métricas, restauro de versões, sobras, tipo de cliente, etc.).
- **v88**: documentação de passagem (README, regras de negócio, boas práticas) e interruptor `SEM_CARGA_INICIAL` para produção.

## Detalhe v58–v88

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
- v85: barra de procura dos provadores maior; corrigido conflito de estilo com a nova barra de OP.
- v86: supervisão corrige diretamente os valores da contadeira (OK, ligeiras, QVs, sobras) e as QVs da logística, por OP e por dia.
- v87: nota na colocação: apontar só frascos (não rolhas).

- v88: documentação de passagem; variável `SEM_CARGA_INICIAL=1` desliga a carga de dados de teste em produção.
- v89: Colocar – campos da proposta (frascos partidos / rolhas partidas / QVs) em grelha de 3 colunas com campos maiores e nota explicativa.
- v90: Contadeira – data de contar (= data de prova), 'ligeiras' passa a 'rejeitadas', novo campo 'sobras de rolhas rejeitadas' (informativo), total OK + sobras no ecrã.
- v91: MISU passa a apontar FRASCOS (app calcula rolhas); cor laranja (em vez de vermelho) para mesas/contador MISU; mapa e provadores aceitam mesas dos lados A e B no mesmo dia; supervisão pode passar uma mesa para outro dia (mantém o lado); encomenda obrigatória com 0 = sem encomenda; rótulos mais claros para mudar a encomenda.
- v92: mesas de dias anteriores ainda por levantar passam automaticamente para hoje (lados A e B, provas anteriores contam, data de origem no mapa).
