const test = require('node:test');
const assert = require('node:assert');
const XLSX = require('xlsx');
const plan = require('../planeamento');

function xlsx(linhas) {
  const cab = ['OP', 'Alias', 'Produto', 'Provadores', 'Estado', 'Frascos', 'Dia', 'Dia útil'];
  const ws = XLSX.utils.aoa_to_sheet([cab, ...linhas]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'DS100');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
const prop = (linhas, dia) => plan.gerarProposta(plan.lerPlaneamento(xlsx(linhas)), dia);

test('layout: capacidades totais batem com o ficheiro da Joana', () => {
  assert.strictEqual(plan.CAPACIDADE_LADO.A, 19306);
  assert.strictEqual(plan.CAPACIDADE_LADO.B, 19411);
  assert.strictEqual(plan.MESAS.A, 42);
  assert.strictEqual(plan.MESAS.B, 43);
});
test('layout: todas as mesas aparecem exatamente uma vez nas filas', () => {
  for (const l of ['A', 'B']) {
    const todas = plan.LAYOUT[l].filas.flat().sort((a, b) => a - b);
    assert.deepStrictEqual(todas, Array.from({ length: plan.MESAS[l] }, (_, i) => i + 1));
  }
});
test('layout: capacidades são múltiplos de 7 (7 filas de altura)', () => {
  for (const l of ['A', 'B']) for (const c of Object.values(plan.LAYOUT[l].cap)) assert.strictEqual(c % 7, 0);
});
test('lado: alterna em dias úteis consecutivos', () => {
  assert.strictEqual(plan.ladoDoDia('2026-10-21'), 'B');
  assert.strictEqual(plan.ladoDoDia('2026-10-22'), 'A');
  assert.strictEqual(plan.ladoDoDia('2026-10-23'), 'B');
  assert.strictEqual(plan.ladoDoDia('2026-10-26'), 'A');
  assert.strictEqual(plan.ladoDoDia('2026-10-20'), 'A'); // antes da âncora também alterna
});
test('lado: sexta e segunda seguintes continuam a alternar', () => {
  assert.notStrictEqual(plan.ladoDoDia('2026-10-23'), plan.ladoDoDia('2026-10-26'));
});
test('lado: em 60 dias úteis nunca repete o mesmo lado dois dias seguidos', () => {
  let d = '2026-08-03';
  let ant = plan.ladoDoDia(d);
  for (let i = 0; i < 60; i++) {
    d = plan.diaUtilSeguinte(d);
    const l = plan.ladoDoDia(d);
    assert.notStrictEqual(l, ant, d);
    ant = l;
  }
});
test('lado: fim de semana usa o último dia útil', () => {
  assert.strictEqual(plan.ladoDoDia('2026-10-24'), plan.ladoDoDia('2026-10-23'));
});
test('dia útil anterior/seguinte saltam fins de semana', () => {
  assert.strictEqual(plan.diaUtilAnterior('2026-10-19'), '2026-10-16');
  assert.strictEqual(plan.diaUtilSeguinte('2026-10-16'), '2026-10-19');
});
test('expandirIntervalos: formatos válidos', () => {
  assert.deepStrictEqual(plan.expandirIntervalos('B1-B3'), ['B1', 'B2', 'B3']);
  assert.deepStrictEqual(plan.expandirIntervalos('A5'), ['A5']);
  assert.deepStrictEqual(plan.expandirIntervalos('b1-3; b7'), ['B1', 'B2', 'B3', 'B7']);
});
test('expandirIntervalos: rejeita lixo, lados misturados e fora do limite', () => {
  assert.throws(() => plan.expandirIntervalos('X1'));
  assert.throws(() => plan.expandirIntervalos('A1-B3'));
  assert.throws(() => plan.expandirIntervalos('A1-A43'), /lado A/);
  assert.doesNotThrow(() => plan.expandirIntervalos('B1-B43'));
  assert.throws(() => plan.expandirIntervalos('A0'));
});
test('proposta: usa o frasco do dia útil anterior (colunas P/Q) e ignora outros dias', () => {
  const p = prop([['15007551', 'x', 'y', 2, 'Em Processo', 71326,
    '19/10/2026 · 20/10/2026 · 21/10/2026', '3ªF (274f) · 4ªF (13000f) · 5ªF (15000f)']], '2026-10-21');
  assert.strictEqual(p.dataProducao, '2026-10-20');
  assert.strictEqual(p.itens.length, 1);
  assert.strictEqual(p.itens[0].frascos, 13000);
});
test('proposta: só estados Liberada / Em Processo / Entregue Logística', () => {
  const l = (op, est) => [op, '', '', 2, est, 100, '20/10/2026', '4ªF (100f)'];
  const p = prop([l('1', 'Liberada'), l('2', 'Em Processo'), l('3', 'Entregue Logística'),
    l('4', 'Aberto'), l('5', 'Terminada'), l('6', 'Concluída Planeamento')], '2026-10-21');
  assert.deepStrictEqual(p.itens.map((i) => i.op), ['1', '2', '3']);
});
test('proposta: mesas consecutivas; a OP seguinte aproveita o fim da mesa partilhada', () => {
  const l = (op, f) => [op, '', '', 2, 'Liberada', f, '20/10/2026', `4ªF (${f}f)`];
  const p = prop([l('1', 483), l('2', 484), l('3', 10)], '2026-10-21');
  assert.strictEqual(p.lado, 'B');
  assert.deepStrictEqual(p.itens.map((i) => i.intervalo), ['B1', 'B2-B3', 'B3']);
});
test('proposta: respeita a capacidade real de cada mesa (B25 = 245)', () => {
  // B1..B24 = 24*483 = 11592; B25 = 245 -> 11837 cabe em 25 mesas; 11838 precisa de 26
  const l = (f) => ['1', '', '', 2, 'Liberada', f, '20/10/2026', `4ªF (${f}f)`];
  assert.strictEqual(prop([l(11837)], '2026-10-21').itens[0].intervalo, 'B1-B25');
  assert.strictEqual(prop([l(11838)], '2026-10-21').itens[0].intervalo, 'B1-B26');
});
test('proposta: sem capacidade assinala as mesas em falta', () => {
  const p = prop([['1', '', '', 2, 'Liberada', 99999, '20/10/2026', '4ªF (99999f)']], '2026-10-21');
  assert.ok(p.semCapacidade > 0);
  assert.ok(p.itens[0].faltam > 0);
});
test('proposta: fim de semana é recusado', () => {
  assert.throws(() => prop([], '2026-10-10'), /dia útil/);
});
test('proposta: OP sem frascos fica de fora; 1 só dia sem "Dia útil" usa a coluna Frascos', () => {
  const p = prop([['1', '', '', 2, 'Liberada', 300, '20/10/2026', ''], ['2', '', '', 2, 'Liberada', 0, '20/10/2026', '']], '2026-10-21');
  assert.deepStrictEqual(p.itens.map((i) => i.op), ['1']);
});
test('proposta: provadores por defeito = 2', () => {
  const p = prop([['1', '', '', null, 'Liberada', 100, '20/10/2026', '4ªF (100f)']], '2026-10-21');
  assert.strictEqual(p.itens[0].provadores, 2);
});
test('ficheiro sem folha DS100 dá erro claro', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a']]), 'Outra');
  assert.throws(() => plan.lerPlaneamento(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })), /DS100/);
});

test('regra das filas: OP termina no frasco 360 -> próxima OP só a partir do 372 (371 = 52 filas x 7 + 7)', () => {
  assert.strictEqual(plan.inicioSeguinte(360), 371);
  assert.strictEqual(483 - plan.inicioSeguinte(360), 112);
  const l = (op, f) => [op, '', '', 2, 'Liberada', f, '20/10/2026', `3ªF (${f}f)`];
  const p = prop([l('1', 360), l('2', 200)], '2026-10-21'); // lado B, mesa B1 com 483
  assert.deepStrictEqual(p.itens[0].segmentos, [{ mesa: 'B1', de: 1, ate: 360 }]);
  assert.deepStrictEqual(p.itens[1].segmentos, [{ mesa: 'B1', de: 372, ate: 483 }, { mesa: 'B2', de: 1, ate: 88 }]);
  assert.strictEqual(p.itens[1].partilhaInicio, true);
  assert.strictEqual(p.itens[1].intervalo, 'B1-B2');
});
test('regra das filas: múltiplo exato de 7 também deixa uma fila vazia; mesa cheia passa à seguinte', () => {
  assert.strictEqual(plan.inicioSeguinte(364), 371);
  assert.strictEqual(plan.inicioSeguinte(1), 14);
  const l = (op, f) => [op, '', '', 2, 'Liberada', f, '20/10/2026', `3ªF (${f}f)`];
  const p = prop([l('1', 483), l('2', 100)], '2026-10-21');
  assert.strictEqual(p.itens[1].segmentos[0].mesa, 'B2');
  assert.strictEqual(p.itens[1].segmentos[0].de, 1);
  // termina a 480 de 483: 480->487 >= 483, a seguinte vai para a mesa nova
  const q = prop([l('1', 480), l('2', 50)], '2026-10-21');
  assert.strictEqual(q.itens[1].segmentos[0].mesa, 'B2');
});
test('regra das filas: total de mesas conta mesas partilhadas uma só vez', () => {
  const l = (op, f) => [op, '', '', 2, 'Liberada', f, '20/10/2026', `3ªF (${f}f)`];
  const p = prop([l('1', 360), l('2', 100)], '2026-10-21'); // as duas cabem na B1
  assert.strictEqual(p.totalNecessarias, 1);
});
