# Regras de negócio da app DS100

Este documento explica **o que a app impõe e porquê**. Quem alterar o código deve manter estas regras (ou decidir conscientemente mudá-las e atualizar este ficheiro e os testes).
As regras estão em: `logic.js` (provadores), `server.js` (colocação, MISU, levantamento, contadeira, supervisão), `levantamento.js` (contas), `planeamento.js` (calendário/lados), `colocacao.js` (distribuição pelas mesas).

## 1. Conceitos

- **OP / Ordem**: ordem de produção (nº com 6–12 dígitos que **começa por 150, 151 ou 950**).
- **Mesa**: posição física de prova; lado **A** (42 mesas) e lado **B** (43). Cada mesa tem uma **capacidade em frascos** (`layout.js`).
- **Frasco / rolha**: a colocação trabalha em **frascos**; cada frasco tem **1, 2 ou 4 rolhas**. Total de rolhas = frascos × rolhas por frasco. *O operador só aponta frascos; as rolhas são calculadas.*
- **Tipo de cliente**: `EUR`, `GRUPO` ou `AMOSTRA` (obrigatório). AMOSTRA exige **3 provadores**; os outros 2.
- **DSROL**: sim/não, por ordem.
- **QVs**: qualidade visual, **sempre em nº de rolhas**.
- **Contaminadas**: rolhas de aroma **ligeiro** e **forte**. **Partidas**: rolhas perdidas em frascos partidos/vazios (nº **real** de rolhas, que pode ser diferente de frascos partidos × rolhas por frasco).
- **Dia útil / lado do dia**: segunda a sexta (sábado só se a supervisão o incluir). O lado alterna A/B em cada dia útil (âncora: 21/10/2026 = B). A logística coloca no dia anterior; os provadores usam o lado do dia.

## 2. Colocação (operador Colocar)

1. Campos obrigatórios: nº de ordem, **quantidade total de frascos / mesas**, rolhas por frasco, tipo de cliente, contadeira (sim/não), DSROL (sim/não), **quantidade encomendada (rolhas)** e **"A ordem continua amanhã?"**.
2. A app propõe a distribuição pelas mesas segundo a capacidade (frascos de 7 em 7 por fila, com 1 fila de separação entre ordens). **Várias ordens podem partilhar a mesma mesa** e identificam-se como `A7-1`, `A7-2`…
3. Por mesa/ordem, o operador pode indicar **frascos partidos**, **rolhas partidas (nº real)** e **QVs** da colocação. Se não indicar as rolhas partidas, usa-se frascos partidos × rolhas por frasco.
4. Dia de colocação = próximo dia útil. **Tirar uma ordem é ação da supervisão** (exige palavra-passe).
5. Se a ordem já existe (outros dias), a app mostra a encomenda e o que já foi aprovado nos dias anteriores.

## 3. Provadores (`logic.js`)

- O provador **escolhe o nome** (lista gerida pela supervisão) e escreve/lê o código da mesa.
- Uma mesa só abre se: for do **lado do dia**; **não esteja aberta**; o lote **não esteja completo** (nº de provadores atingido); o provador **não a tenha feito hoje**; passaram **30 minutos** desde o último fecho dessa mesa; o provador **não tenha outra mesa aberta**.
- Mesas **sem colocação** ("não planeada") abrem livremente (comportamento herdado do Power Apps).
- Quando o nº de provas fechadas iguala o nº de provadores necessários, a mesa fica **pronta** para o MISU.
- O contador "mesas feitas hoje" conta mesas distintas fechadas **no dia de Lisboa** (zera à meia-noite). Tocar mostra a lista com a hora de fecho.

## 3.1 Mesas de dois lados no mesmo dia

A supervisão pode passar **uma mesa** para outro dia de prova (Menu Supervisão → Provas de uma mesa → «Passar esta mesa para esse dia»; por defeito o dia útil seguinte). A mesa **mantém o seu lado** e leva as ordens consigo. Nesse dia os provadores podem provar mesas de **A e B**; o mapa da logística mostra os dois lados. Só se passa uma mesa que ainda não tenha MISU/levantamento/contagem.

## 3.2 Encomenda

Obrigatória em Colocar. **0 = sem encomenda** (a ordem fecha sempre OK). A supervisão pode mudá-la em Ordens («Mudar a encomenda para esta quantidade») ou na edição da ordem; voltar a colocar a mesma OP também a atualiza.

## 4. MISU

- Trabalha **à mesa**, mas **aponta por ordem**, em **frascos** (a app calcula as rolhas = frascos × rolhas por frasco da colocação; internamente guarda rolhas).
- Ordem **sem contadeira**: aponta **ligeiras e fortes**. Aprovadas = rolhas da ordem − ligeiras − fortes − partidas.
- Ordem **com contadeira**: aponta **só fortes** (as ligeiras são da contadeira).
- Validação: ligeiras + fortes + partidas **não podem passar** as rolhas da ordem nessa mesa.
- **Depois de guardado fica bloqueado**; só a supervisão altera (reabrir MISU ou editar valores).
- O MISU não regista QVs (as QVs são da colocação e da logística/contadeira).

## 5. Levantamento (logística) — **por ordem, não por mesa**

- Só se pode levantar uma ordem quando **todas as suas mesas** têm provas concluídas **e** o MISU registado em todas.
- **Ordem sem contadeira**: um só passo — escreve-se as **QVs** (0 se não houver) e **levanta-se**. Depois de levantada, só a supervisão altera.
- **Ordem com contadeira**: a logística **só levanta**; as QVs registam-se **na contadeira**.
- Uma mesa só fica "levantada" quando **todas** as suas ordens estão levantadas.
- A vista **Ordens · logística** separa *Por levantar* (inclui em prova/MISU) de *Levantadas*, tem pesquisa de OP e mostra tipo de cliente.

## 6. Contadeira (por OP)

Só depois de a ordem estar **levantada**. Regista, para a OP e o dia:
**Rolhas OK**, **Rolhas ligeiras**, **QVs** e **Sobras**. A app só guarda se:

```
OK + ligeiras + fortes (MISU) + partidas + sobras = total de rolhas da OP
```

- **Sobras** = rolhas num **saco de 5 000 incompleto** que fica para o dia seguinte. **Fecham o dia / 1.º fecho** mas **não entram no acumulado** da ordem (amanhã diluem-se num saco de 5 000). Têm de ser **< 5 000**.
- Depois de guardada, a contagem fica bloqueada; só a supervisão altera.

## 7. Ordens de vários dias (encomenda e fechos)

- Cada dia tem o seu **fecho**. Se **"continua amanhã = Sim"**: o dia é um **1.º fecho (parcial)** — não há consolidação.
- Se **"continua amanhã = Não"**: a ordem fecha na totalidade → **consolidação**: acumulado = soma das rolhas **OK** de todos os dias (+ rolhas acrescentadas pela supervisão), **sem sobras**.
  - acumulado ≥ encomenda → **OK**.
  - acumulado < encomenda → **pendente** para a supervisão, que pode **acrescentar rolhas à encomenda** ou **aceitar a falta** (fica "OK com falta"); pode também reabrir.
- Estados de uma ordem: *em curso · 1.º fecho · OK · OK com falta · pendente*.

## 8. Supervisão (palavra-passe)

Menu: Provadores (nomes) · Provadores (métricas e CSV) · Provas de uma mesa · Colocação e levantamento (editar campos, tirar ordem/mesa) · Ordens (encomenda, decisões, **corrigir valores do dia**) · Dias de trabalho (sábado) · Fechar provas em lote · Restaurar versão anterior · Descarregar movimentos (CSV).

- A sessão **termina** ao sair do menu, mudar de separador/ecrã ou mudar de aplicação. 5 tentativas erradas bloqueiam 1 minuto.
- Qualquer correção deve manter as contas certas (a app valida e recusa o que não bate).
- Tudo fica em `movimentos`; antes de alterações importantes guarda-se uma **versão** restaurável.

## 9. Princípios que não se devem quebrar

1. **Poka-yoke**: a app impede o que não bate certo (somas, limites, ordem de etapas).
2. **Cut-off de responsabilidade**: cada etapa (provas → MISU → levantamento → contadeira) só começa quando a anterior acaba e depois de registada só a supervisão altera.
3. **Nada se perde**: histórico (`movimentos`) nunca é apagado; versões restauráveis.
4. **Contas em rolhas; colocação em frascos.**
5. **Por ordem (OP)** — mesas servem a logística física, mas o MISU/levantamento/contadeira registam por ordem.

## 3.3 Mesas de dias anteriores por levantar

Uma mesa colocada em dia anterior (últimos 7 dias) que **ainda não foi levantada** passa **sozinha para hoje** na primeira utilização da app, com as suas ordens (a ordem tem de continuar). Mantém o lado (A/B), aparece no mapa com a data de origem («de dd/mm») e as provas já feitas nos dias anteriores **continuam a contar**. Mesas já levantadas ou contadas não voltam.

## 3.4 Contadeira ao longo do dia

A contadeira **não espera** pelo fim: assim que o MISU entrega pelo menos uma mesa da OP, pode **lançar contagens** (cada saco/lote: OK, rejeitadas, QVs, sobras, sobras de rejeitadas). As contagens somam-se e aparecem na lista «Contagens de hoje» com o que falta contar. O **fecho da OP** («Fechar a contagem da OP») só se faz depois de a logística levantar a ordem e só se a conta bater: OK + rejeitadas + fortes + partidas + abatidas + sobras = total de rolhas. Depois de fechada, só a supervisão altera; só a supervisão apaga uma contagem lançada por engano.

## 3.5 Rolhas abatidas (frascos vazios ou com 1 rolha)

Em Levantar → Ordens · logística, quem levanta pode indicar as **rolhas a abater** (nº de ROLHAS, como as partidas). Abate ao total: sem contadeira, aprovadas = rolhas − ligeiras − fortes − partidas − abatidas; com contadeira entra na conta de fecho. A supervisão pode corrigir em Ordens → Valores do dia.

## 3.6 Provas reais vs. fecho em lote

As provas criadas pela supervisão em «Fechar provas em lote» fecham a mesa mas são marcadas como **simuladas**: **não entram** nas métricas nem nos contadores dos provadores (só entra o que aconteceu de facto no gemba).

## 3.7 Margem de erro das contagens

O fecho da contadeira (e a correção da supervisora) aceita uma diferença entre o total colocado e a soma das contagens até uma **margem em %** do total da OP (por defeito 1 %; 0 = tem de bater). Define-se em Menu Supervisão → «Margem de erro das contagens (%)». A diferença aceite fica guardada e visível na contagem fechada.

## 3.8 Frascos partidos no levantamento

Além de na colocação, quem levanta pode corrigir os **frascos partidos** (e, se quiser, o nº real de rolhas partidas) **por mesa** em Levantar → Ordens · logística, antes de levantar. A supervisão altera depois.
