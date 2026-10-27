const test = require('node:test');
const assert = require('node:assert');
const XLSX = require('xlsx');
const { api, limpar, lote, fechadoHa, hoje, proximoUtil, plan, pool } = require('./helpers');

test.beforeEach(limpar);
test.after(() => pool.end());

test('saúde e lista de aprovadores (9 seed)', async () => {
  assert.strictEqual((await api('GET', '/api/saude')).status, 200);
  const r = await api('GET', '/api/aprovadores');
  assert.strictEqual(r.body.length, 9);
  assert.ok(r.body.some((a) => a.nome === 'Tânia Gonçalves'));
});

test('supervisora altera o nº de provadores de uma mesa (2 → 3)', async () => {
  const hoje = plan.hojeLisboa();
  const Lh = await require('../logic').ladoHoje();
  await api('POST', '/api/logistica/ordem/confirmar', { data: hoje, pin: '8126', tipo: 'EUR', dsrol: false, continua: false, encomenda: 100000, rolhasPorFrasco: 2, ordem: '15102600', frascos: 10, contadeira: false });
  const m = `${Lh}1`;
  assert.strictEqual((await api('POST', '/api/supervisora/registos', { pin: '8126', mesa: m })).body.provadores, 2);
  assert.strictEqual((await api('POST', `/api/supervisora/mesa/${m}`, { provadores: 3 })).status, 401);
  assert.strictEqual((await api('POST', `/api/supervisora/mesa/${m}`, { pin: '8126', provadores: 9 })).status, 400);
  assert.strictEqual((await api('POST', `/api/supervisora/mesa/${m}`, { pin: '8126', provadores: 3 })).status, 200);
  assert.strictEqual((await api('POST', '/api/supervisora/registos', { pin: '8126', mesa: m })).body.provadores, 3);
});

test('versões: restaurar o estado anterior com a palavra-passe da supervisora', async () => {
  const hoje = plan.hojeLisboa();
  const b = { data: hoje, pin: '8126', tipo: 'EUR', dsrol: false, continua: false, encomenda: 500, rolhasPorFrasco: 2, contadeira: false };
  assert.strictEqual((await api('POST', '/api/logistica/ordem/confirmar', { ...b, ordem: '15102700', frascos: 10 })).status, 200);
  assert.strictEqual((await api('POST', '/api/supervisora/reset', { pin: '8126', confirmar: 'APAGAR' })).status, 200);
  assert.strictEqual((await api('GET', '/api/levantamento')).body.ordens.length, 0);
  const v = (await api('POST', '/api/supervisora/versoes', { pin: '8126' })).body.versoes;
  const antes = v.find((x) => /limpeza/.test(x.motivo));
  assert.ok(antes);
  assert.strictEqual((await api('POST', '/api/supervisora/versoes/restaurar', { pin: '8126', id: antes.id })).status, 200);
  const o = (await api('GET', '/api/levantamento')).body.ordens;
  assert.deepStrictEqual(o.map((x) => x.op), ['15102700']);
  assert.strictEqual((await api('POST', '/api/supervisora/versoes/restaurar', { pin: '8126', id: 999999 })).status, 404);
});

test('métricas dos provadores (supervisora)', async () => {
  await lote('A1', '15007551', 2);
  await fechadoHa('A1', 'Marta Santos', 30);
  assert.strictEqual((await api('POST', '/api/supervisora/provadores-metricas', { dias: 7 })).status, 401);
  const r = (await api('POST', '/api/supervisora/provadores-metricas', { pin: '8126', dias: 7 })).body;
  assert.strictEqual(r.resumo.mesas, 1);
  const m = r.provadores.find((x) => x.nome === 'Marta Santos');
  assert.deepStrictEqual([m.mesas, m.provasFechadas, m.abertas], [1, 1, 0]);
  assert.ok(m.mediaMin >= 0);
});

test('fechar provas em lote: intervalo de mesas com exceção e 2 provadores', async () => {
  const hoje = plan.hojeLisboa();
  const b = { data: hoje, pin: '8126', tipo: 'EUR', dsrol: false, continua: false, encomenda: 100000, rolhasPorFrasco: 2, contadeira: false };
  const Lh = await require('../logic').ladoHoje();
  assert.strictEqual((await api('POST', '/api/logistica/ordem/confirmar', { ...b, ordem: '15102800', frascos: 1000 })).status, 200);
  const mesas = (await api('GET', `/api/logistica/mesas?data=${hoje}`)).body.mesas.filter((m) => m.estado !== 'sem_lote').map((m) => m.mesa);
  assert.ok(mesas.length >= 3);
  const exc = mesas[1];
  assert.strictEqual((await api('POST', '/api/supervisora/fechar-provas', { lado: Lh, de: 1, ate: 50, excecoes: [exc], provadores: 2 })).status, 401);
  const r = await api('POST', '/api/supervisora/fechar-provas', { pin: '8126', lado: Lh, de: 1, ate: 50, excecoes: [exc], provadores: 2 });
  assert.strictEqual(r.status, 200);
  assert.ok(!r.body.fechadas.includes(exc) && r.body.fechadas.length === mesas.length - 1);
  const est = (await api('GET', `/api/logistica/mesas?data=${hoje}`)).body.mesas;
  assert.strictEqual(est.find((m) => m.mesa === mesas[0]).estado, 'misu');
  assert.strictEqual(est.find((m) => m.mesa === exc).estado, 'em_prova');
});

test('rolhas partidas reais (frascos vazios ou com menos rolhas) contam no total', async () => {
  const hoje = plan.hojeLisboa();
  const Lh = await require('../logic').ladoHoje();
  const b = { data: hoje, pin: '8126', tipo: 'EUR', dsrol: false, continua: false, encomenda: 100000, rolhasPorFrasco: 2, contadeira: false, ordem: '15102900', frascos: 10 };
  const m = `${Lh}1`;
  assert.strictEqual((await api('POST', '/api/logistica/ordem/confirmar', { ...b, distribuicao: [{ mesa: m, partidos: 2, rolhasPartidas: 999 }] })).status, 400);   // mais que as rolhas
  assert.strictEqual((await api('POST', '/api/logistica/ordem/confirmar', { ...b, distribuicao: [{ mesa: m, partidos: 2, rolhasPartidas: 3 }] })).status, 200);   // 2 frascos partidos, mas só 3 rolhas
  let mm = (await api('GET', `/api/logistica/mesas?data=${hoje}`)).body.mesas.find((x) => x.mesa === m);
  assert.deepStrictEqual([mm.frascosPartidos, mm.rolhasPartidas, mm.totalRolhas], [2, 3, 20]);
  assert.strictEqual(mm.segmentos[0].rolhasPartidas, 3);
  // por omissão (sem indicar): frascos partidos x rolhas por frasco
  assert.strictEqual((await api('POST', '/api/logistica/ordem/remover', { data: hoje, ordem: '15102900', pin: '8126' })).status, 200);
  assert.strictEqual((await api('POST', '/api/logistica/ordem/confirmar', { ...b, distribuicao: [{ mesa: m, partidos: 2 }] })).status, 200);
  mm = (await api('GET', `/api/logistica/mesas?data=${hoje}`)).body.mesas.find((x) => x.mesa === m);
  assert.strictEqual(mm.rolhasPartidas, 4);
  // a supervisora corrige o nº real
  assert.strictEqual((await api('POST', '/api/supervisora/ordem', { pin: '8126', data: hoje, mesa: m, op: '15102900', rolhasPartidas: 5 })).status, 200);
  mm = (await api('GET', `/api/logistica/mesas?data=${hoje}`)).body.mesas.find((x) => x.mesa === m);
  assert.strictEqual(mm.rolhasPartidas, 5);
});

test('supervisora corrige valores da contadeira e QVs a qualquer momento', async () => {
  const hoje = plan.hojeLisboa();
  const b = { data: hoje, pin: '8126', tipo: 'EUR', dsrol: false, continua: false, encomenda: 100000, rolhasPorFrasco: 2 };
  assert.strictEqual((await api('POST', '/api/logistica/ordem/confirmar', { ...b, ordem: '15102950', frascos: 100, contadeira: true })).status, 200);
  assert.strictEqual((await api('POST', '/api/logistica/ordem/confirmar', { ...b, ordem: '15102951', frascos: 10, contadeira: false })).status, 200);
  const V = (x) => api('POST', '/api/supervisora/ordem-valores', x);
  assert.strictEqual((await V({ op: '15102950', aprovadas: 190, ligeiras: 6, sobras: 4, qvs: 1 })).status, 401);
  assert.strictEqual((await V({ pin: '8126', op: '15102950', aprovadas: 190, ligeiras: 6, sobras: 4, qvs: 1 })).status, 200);       // 190+6+0+0+4 = 200
  assert.strictEqual((await V({ pin: '8126', op: '15102950', aprovadas: 190, ligeiras: 6, sobras: 5, qvs: 1 })).status, 400);       // não bate
  assert.strictEqual((await V({ pin: '8126', op: '15102950', aprovadas: 190, ligeiras: 6, sobras: 4, sobrasRej: -3, qvs: 1 })).status, 400);  // sobras rejeitadas inválidas
  assert.strictEqual((await V({ pin: '8126', op: '15102950', aprovadas: 190, ligeiras: 6, sobras: 4, sobrasRej: 12, qvs: 1 })).status, 200); // só informação
  assert.strictEqual((await V({ pin: '8126', op: '15102950', aprovadas: 100, ligeiras: 0, sobras: 5000, qvs: 1 })).status, 400);    // sobras < 5000
  assert.strictEqual((await V({ pin: '8126', op: '15102951', qvs: 9 })).status, 200);                                               // sem contadeira: só QVs
  assert.strictEqual((await V({ pin: '8126', op: '15109999', qvs: 9 })).status, 404);
  const l = (await api('POST', '/api/supervisora/ordens', { pin: '8126' })).body.ordens;
  const v = l.find((x) => x.op === '15102950').valores[0];
  assert.deepStrictEqual([v.aprovadas, v.ligeiras, v.sobras, v.qvs, v.contadeira, v.sobrasRej], [190, 6, 4, 1, true, 12]);
  assert.strictEqual(l.find((x) => x.op === '15102951').valores[0].qvs, 9);
});

test('mesa sem lote hoje abre de imediato (não planeada)', async () => {
  const e = (await api('GET', '/api/mesa/Z99?aprovador=Marta Santos')).body;
  assert.strictEqual(e.planeado, false);
  assert.strictEqual(e.podeAbrir, true);
});

test('abrir + concluir: ciclo normal e contador de mesas feitas', async () => {
  await lote('A1');
  const ab = await api('POST', '/api/mesa/a1/abrir', { aprovador: 'Marta Santos' });
  assert.strictEqual(ab.status, 200);
  const id = ab.body.registo.id;
  assert.strictEqual((await api('GET', '/api/mesa/A1?aprovador=Marta Santos')).body.mesaAbertaPorMim, true);
  assert.strictEqual((await api('POST', `/api/registo/${id}/concluir`)).status, 200);
  assert.strictEqual((await api('GET', '/api/aprovador/Marta Santos/mesas-hoje')).body.mesas, 1);
});

test('mesa em uso por outro provador não abre', async () => {
  await lote('A1');
  await api('POST', '/api/mesa/A1/abrir', { aprovador: 'Marta Santos' });
  const r = await api('POST', '/api/mesa/A1/abrir', { aprovador: 'Tânia Lino' });
  assert.strictEqual(r.status, 409);
  const e = (await api('GET', '/api/mesa/A1?aprovador=Tânia Lino')).body;
  assert.strictEqual(e.mesaAbertaPorOutro, true);
  assert.strictEqual(e.quemTemMesa, 'Marta Santos');
});

test('regra dos 30 min: bloqueia aos 10 min e liberta aos 31 min', async () => {
  await lote('A1');
  await fechadoHa('A1', 'Marta Santos', 10);
  let e = (await api('GET', '/api/mesa/A1?aprovador=Tânia Lino')).body;
  assert.strictEqual(e.podeAbrir, false);
  assert.ok(e.minutosRestantes > 0 && e.minutosRestantes <= 20);
  assert.strictEqual((await api('POST', '/api/mesa/A1/abrir', { aprovador: 'Tânia Lino' })).status, 409);
  await limpar();
  await lote('A1');
  await fechadoHa('A1', 'Marta Santos', 31);
  e = (await api('GET', '/api/mesa/A1?aprovador=Tânia Lino')).body;
  assert.strictEqual(e.podeAbrir, true);
});

test('o mesmo provador não repete a mesma mesa no mesmo dia', async () => {
  await lote('A1', 3);
  await fechadoHa('A1', 'Marta Santos', 90);
  const e = (await api('GET', '/api/mesa/A1?aprovador=Marta Santos')).body;
  assert.strictEqual(e.jaFezHoje, true);
  assert.strictEqual(e.podeAbrir, false);
});

test('lote completo (2 de 2) bloqueia novas aberturas', async () => {
  await lote('A1', 2);
  await fechadoHa('A1', 'Marta Santos', 120);
  await fechadoHa('A1', 'Tânia Lino', 60);
  const e = (await api('GET', '/api/mesa/A1?aprovador=Teresa Pinto')).body;
  assert.strictEqual(e.loteCompleto, true);
  assert.strictEqual(e.podeAbrir, false);
});

test('um provador só pode ter uma mesa aberta de cada vez', async () => {
  await lote('A1');
  await lote('A2');
  await api('POST', '/api/mesa/A1/abrir', { aprovador: 'Marta Santos' });
  const e = (await api('GET', '/api/mesa/A2?aprovador=Marta Santos')).body;
  assert.strictEqual(e.outraMesaAberta, true);
  assert.strictEqual(e.outraMesaCodigo, 'A1');
  assert.strictEqual((await api('POST', '/api/mesa/A2/abrir', { aprovador: 'Marta Santos' })).status, 409);
});

test('concorrência: 4 provadores a abrir a mesma mesa em simultâneo, só um ganha', async () => {
  await lote('A1');
  const nomes = ['Marta Santos', 'Tânia Lino', 'Teresa Pinto', 'Raquel Santos'];
  const rs = await Promise.all(nomes.map((a) => api('POST', '/api/mesa/A1/abrir', { aprovador: a })));
  assert.strictEqual(rs.filter((r) => r.status === 200).length, 1);
  assert.strictEqual((await pool.query("SELECT 1 FROM registos WHERE mesa='A1' AND estado='Aberto'")).rowCount, 1);
});

test('concluir duas vezes (duplo toque) não cria dados inconsistentes', async () => {
  await lote('A1');
  const id = (await api('POST', '/api/mesa/A1/abrir', { aprovador: 'Marta Santos' })).body.registo.id;
  const [a, b] = await Promise.all([api('POST', `/api/registo/${id}/concluir`), api('POST', `/api/registo/${id}/concluir`)]);
  assert.ok([a.status, b.status].includes(200));
  assert.strictEqual((await pool.query("SELECT 1 FROM registos WHERE estado='Fechado'")).rowCount, 1);
  assert.strictEqual((await pool.query("SELECT 1 FROM registos WHERE estado='Aberto'")).rowCount, 0);
});

test('validação de pedidos: falta de campos', async () => {
  assert.strictEqual((await api('GET', '/api/mesa/A1')).status, 400);
  assert.strictEqual((await api('POST', '/api/mesa/A1/abrir', {})).status, 400);
  assert.strictEqual((await api('POST', '/api/lotes', {})).status, 400);
});

test('lado oposto bloqueado: se hoje é B, mesas A não abrem (planeadas ou não)', async () => {
  await lote('B1');
  await lote('B2');
  const e = (await api('GET', '/api/mesa/A5?aprovador=Marta Santos')).body;
  assert.strictEqual(e.ladoHoje, 'B');
  assert.strictEqual(e.ladoErrado, true);
  assert.strictEqual(e.podeAbrir, false);
  assert.strictEqual((await api('POST', '/api/mesa/A5/abrir', { aprovador: 'Marta Santos' })).status, 409);
  assert.strictEqual((await api('GET', '/api/mesa/B7?aprovador=Marta Santos')).body.podeAbrir, true); // B não planeada abre
  assert.strictEqual((await api('POST', '/api/mesa/B1/abrir', { aprovador: 'Marta Santos' })).status, 200);
});

test('lado oposto: se hoje é A, mesas B bloqueadas', async () => {
  await lote('A1');
  const e = (await api('GET', '/api/mesa/B3?aprovador=Marta Santos')).body;
  assert.strictEqual(e.ladoHoje, 'A');
  assert.strictEqual(e.podeAbrir, false);
});

test('sem lotes hoje, o lado vem do calendário (alternância)', async () => {
  const esperado = plan.ladoDoDia(hoje());
  const e = (await api('GET', '/api/mesa/A1?aprovador=Marta Santos')).body;
  assert.strictEqual(e.ladoHoje, esperado);
});

// ---- Supervisão / planeamento ----
function xlsxBuf(linhas) {
  const ws = XLSX.utils.aoa_to_sheet([['OP', 'Alias', 'Produto', 'Provadores', 'Estado', 'Frascos', 'Dia', 'Dia útil'], ...linhas]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'DS100');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

test('proposta via API: gera e rejeita data inválida, fim de semana, ficheiro vazio ou errado', async () => {
  const dia = proximoUtil();
  const [y, m, d] = hoje().split('-');
  const buf = xlsxBuf([['1', '', '', 2, 'Liberada', 500, `${d}/${m}/${y}`, '1ªF (500f)']]);
  assert.strictEqual((await api('POST', `/api/planeamento/proposta?data=${dia}`, buf, true)).status, 200);
  assert.strictEqual((await api('POST', '/api/planeamento/proposta?data=lixo', buf, true)).status, 400);
  assert.strictEqual((await api('POST', '/api/planeamento/proposta?data=2026-10-24', buf, true)).status, 400);
  assert.strictEqual((await api('POST', `/api/planeamento/proposta?data=${dia}`, Buffer.alloc(0), true)).status, 400);
  assert.strictEqual((await api('POST', `/api/planeamento/proposta?data=${dia}`, Buffer.from('isto não é excel'), true)).status, 400);
});

test('confirmar: grava, substitui o dia e os lotes aparecem na lista', async () => {
  const dia = proximoUtil();
  const L = plan.ladoDoDia(dia);
  let r = await api('POST', '/api/planeamento/confirmar', { dataProva: dia, itens: [{ op: '111', provadores: 2, intervalo: `${L}1-${L}3` }] });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.mesas, 3);
  r = await api('POST', '/api/planeamento/confirmar', { dataProva: dia, itens: [{ op: '222', provadores: 3, intervalo: `${L}5` }] });
  const lst = (await api('GET', `/api/lotes?data=${dia}`)).body;
  assert.deepStrictEqual(lst.map((x) => x.mesa), [`${L}5`]);
  assert.strictEqual(lst[0].numero_provadores, 3);
});

test('confirmar: recusa passado, fim de semana, lado errado, duplicada, inválido, pedido mal formado', async () => {
  const dia = proximoUtil();
  const L = plan.ladoDoDia(dia);
  const O = L === 'A' ? 'B' : 'A';
  const c = (b) => api('POST', '/api/planeamento/confirmar', b);
  assert.strictEqual((await c({ dataProva: '2020-01-01', itens: [] })).status, 400);
  assert.strictEqual((await c({ dataProva: '2026-10-24', itens: [] })).status, 400);
  assert.strictEqual((await c({ dataProva: dia, itens: [{ op: '1', provadores: 2, intervalo: `${O}1` }] })).status, 400);
  assert.strictEqual((await c({ dataProva: dia, itens: [{ op: '1', provadores: 2, intervalo: `${L}1-${L}3` }, { op: '1', provadores: 2, intervalo: `${L}3` }] })).status, 400);
  assert.strictEqual((await c({ dataProva: dia, itens: [{ op: '1', provadores: 2, intervalo: 'abc' }] })).status, 400);
  assert.strictEqual((await c({ dataProva: dia, itens: [{ op: '1', provadores: 2, intervalo: `${L}99` }] })).status, 400);
  assert.strictEqual((await c({ dataProva: 'x', itens: 'y' })).status, 400);
});

test('confirmar: pedido inválido não apaga o que já estava gravado', async () => {
  const dia = proximoUtil();
  const L = plan.ladoDoDia(dia);
  await api('POST', '/api/planeamento/confirmar', { dataProva: dia, itens: [{ op: '1', provadores: 2, intervalo: `${L}1-${L}2` }] });
  await api('POST', '/api/planeamento/confirmar', { dataProva: dia, itens: [{ op: '9', provadores: 2, intervalo: `${L}99` }] });
  assert.strictEqual((await api('GET', `/api/lotes?data=${dia}`)).body.length, 2);
});

test('confirmar: mesa partilhada por duas OPs grava um lote com as duas OPs', async () => {
  const dia = proximoUtil();
  const L = plan.ladoDoDia(dia);
  const r = await api('POST', '/api/planeamento/confirmar', { dataProva: dia, itens: [
    { op: '111', provadores: 2, intervalo: `${L}1-${L}2` }, { op: '222', provadores: 3, intervalo: `${L}2-${L}3` }] });
  assert.strictEqual(r.status, 200);
  const lst = (await api('GET', `/api/lotes?data=${dia}`)).body;
  assert.strictEqual(lst.length, 3);
  const m2 = lst.find((x) => x.mesa === `${L}2`);
  assert.strictEqual(m2.ordem, '111 + 222');
  assert.strictEqual(m2.numero_provadores, 3);
});

test('registo guarda as OPs da mesa inteira (mesa partilhada) para ficar conforme', async () => {
  await lote('A1', 2, '111 + 222');
  const ab = await api('POST', '/api/mesa/A1/abrir', { aprovador: 'Marta Santos' });
  assert.strictEqual(ab.body.registo.ordem, '111 + 222');
  const r = await pool.query("SELECT ordem FROM registos WHERE mesa='A1'");
  assert.strictEqual(r.rows[0].ordem, '111 + 222');
});

// ---- Levantamento: MISU / Contadeira / Logística ----
async function loteCompleto(mesa, cont, extra = {}) {
  await lote(mesa, 1, extra.o || 'OP1');
  await pool.query(`UPDATE lotes SET rolhas_por_frasco = $2, total_frascos_cliente = $3, contadeira = $4, qvs_colocacao = $5, frascos_partidos = $6, tipo = 'EUR', dsrol = false
     WHERE mesa = $1 AND data_planeamento = $7`, [mesa, extra.r ?? 2, extra.f ?? 5000, cont, extra.q ?? 10, extra.p ?? 3, hoje()]);
  await fechadoHa(mesa, 'Marta Santos', 60);
}
const lev = async (mesa) => (await api('GET', '/api/levantamento')).body.mesas.find((m) => m.mesa === mesa);

test('levantamento: total de rolhas = frascos x rolhas por frasco; frascos partidos visíveis', async () => {
  await loteCompleto('A1', false);
  const m = await lev('A1');
  assert.strictEqual(m.totalRolhas, 10000);
  assert.strictEqual(m.rolhasPartidas, 6);
  assert.strictEqual(m.frascosPartidos, 3);
  assert.strictEqual(m.estadoProva, 'pronta');
});

test('MISU sem contadeira: aponta ligeiras e fortes e a logística fica com total - contaminados', async () => {
  await loteCompleto('A1', false);
  const r = await api('POST', '/api/misu/A1', { ligeiros: 100, fortes: 50, qvs: 5 });
  assert.strictEqual(r.status, 200);
  const m = await lev('A1');
  assert.strictEqual(m.contaminados, 150);
  assert.strictEqual(m.aprovadas, 9844);
  assert.strictEqual(m.aprovadasOrigem, 'subtracao');
  assert.strictEqual(m.misuEstado, 'feito');
});

test('MISU: valida números, exige ligeiras e fortes, e não deixa passar do total da mesa', async () => {
  await loteCompleto('A1', false);
  assert.strictEqual((await api('POST', '/api/misu/A1', { ligeiros: 10 })).status, 400);
  assert.strictEqual((await api('POST', '/api/misu/A1', { ligeiros: -1, fortes: 0 })).status, 400);
  assert.strictEqual((await api('POST', '/api/misu/A1', { ligeiros: 1.5, fortes: 0 })).status, 400);
  assert.strictEqual((await api('POST', '/api/misu/A1', { ligeiros: 9000, fortes: 2000 })).status, 400);
  assert.strictEqual((await api('POST', '/api/misu/A1', { ligeiros: 0, fortes: 0 })).status, 200);
  assert.strictEqual((await lev('A1')).aprovadas, 9994);
});

test('MISU: mesa que ainda não está concluída pelos provadores ou sem lote é recusada', async () => {
  await lote('A1', 2);
  assert.strictEqual((await api('POST', '/api/misu/A1', { ligeiros: 1, fortes: 1 })).status, 409);
  assert.strictEqual((await api('POST', '/api/misu/A9', { ligeiros: 1, fortes: 1 })).status, 404);
});

test('MISU com contadeira: só conta aromas fortes (ligeiros ficam para a contadeira) e tem de os apontar ANTES de entregar à contadeira', async () => {
  await loteCompleto('A1', true);
  assert.strictEqual((await api('POST', '/api/misu/A1', { qvs: 4 })).status, 400);                 // só QVs: não pode entregar
  assert.strictEqual((await api('POST', '/api/misu/A1', { ligeiros: 5, qvs: 4 })).status, 400);    // falta o forte (ligeiros não contam)
  let m = await lev('A1');
  assert.strictEqual(m.misuEstado, 'pendente');
  assert.strictEqual((await api('POST', '/api/misu/A1', { ligeiros: 5, fortes: 3, qvs: 4 })).status, 200);   // ligeiros ignorados
  m = await lev('A1');
  assert.strictEqual(m.misuEstado, 'entregue');
  assert.strictEqual(m.contaminados, 3);
  assert.strictEqual(m.ligeiros, 0);
  assert.strictEqual(m.qvs.misu, 4);
  assert.strictEqual(m.aprovadas, null);              // as aprovadas vêm da contadeira, por OP
  assert.strictEqual(m.contadeiraPendente, true);
});

test('cut off de responsabilidade: depois de entregar à contadeira o MISU já não mexe na mesa', async () => {
  await loteCompleto('A1', true);
  assert.strictEqual((await api('POST', '/api/misu/A1', { ligeiros: 1, fortes: 1, qvs: 2 })).status, 200);   // entrega
  const r = await api('POST', '/api/misu/A1', { ligeiros: 2, fortes: 2, qvs: 9 });
  assert.strictEqual(r.status, 409);
  assert.match(r.body.erro, /contadeira/);
  const m = await lev('A1');
  assert.strictEqual(m.qvs.misu, 2);
  assert.strictEqual(m.contaminados, 1);   // não mudou
});

test('sem contadeira o MISU aponta à mão e pode corrigir; a contadeira não entra', async () => {
  await loteCompleto('A1', false);
  assert.strictEqual((await api('POST', '/api/misu/A1', { ligeiros: 5, fortes: 5 })).status, 200);
  assert.strictEqual((await api('POST', '/api/misu/A1', { ligeiros: 6, fortes: 5 })).status, 200);
  assert.strictEqual((await api('POST', '/api/contadeira/op/OP1', { aprovadas: 1 })).status, 404);   // a contadeira não entra
  assert.strictEqual((await lev('A1')).contaminados, 11);
});

test('contadeira trabalha à OP (não à mesa): só entra depois de o MISU entregar TODAS as mesas da OP', async () => {
  await loteCompleto('A1', true, { o: '15007551' });
  await loteCompleto('A2', true, { o: '15007551' });
  await loteCompleto('A3', false, { o: '15102461' });
  const c = (op, b) => api('POST', `/api/contadeira/op/${op}`, b);
  assert.strictEqual((await c('15007551', { aprovadas: 100 })).status, 409);       // MISU ainda não entregou
  await api('POST', '/api/misu/A1', { ligeiros: 400, fortes: 100, qvs: 1 });
  assert.strictEqual((await c('15007551', { aprovadas: 100 })).status, 409);       // falta a A2
  await api('POST', '/api/misu/A2', { ligeiros: 300, fortes: 200, qvs: 1 });
  assert.strictEqual((await c('15007551', { aprovadas: 18000 })).status, 200);
  assert.strictEqual((await c('15102461', { aprovadas: 1 })).status, 404);          // OP sem contadeira
  assert.strictEqual((await c('99999999', { aprovadas: 1 })).status, 404);
  const j = (await api('GET', '/api/levantamento')).body;
  const o = j.ops.find((x) => x.op === '15007551');
  assert.strictEqual(o.nMesas, 2);
  assert.deepStrictEqual(o.mesas, ['A1', 'A2']);
  assert.strictEqual(o.totalRolhas, 20000);
  assert.strictEqual(o.aprovadas, 18000);
  assert.strictEqual(o.contaminados, 300);
  assert.strictEqual(o.estado, 'feito');
  assert.strictEqual(j.ops.length, 1);                                               // só OPs com mesas que vão à contadeira
  const a1 = j.mesas.find((m) => m.mesa === 'A1');
  assert.strictEqual(a1.contagensOp[0].aprovadas, 18000);
  assert.strictEqual(a1.contadeiraPendente, false);
});

test('contadeira por OP: valida valores e o total da OP; atualização parcial mantém o resto', async () => {
  await loteCompleto('A1', true, { o: '15007551' });
  await api('POST', '/api/misu/A1', { ligeiros: 700, fortes: 300, qvs: 0 });
  const c = (b) => api('POST', '/api/contadeira/op/15007551', b);
  assert.strictEqual((await c({})).status, 400);
  assert.strictEqual((await c({ aprovadas: -1 })).status, 400);
  assert.strictEqual((await c({ aprovadas: 1.5 })).status, 400);
  assert.strictEqual((await c({ aprovadas: 10001 })).status, 400);                  // total da OP = 10000
  assert.strictEqual((await c({ aprovadas: 9695 })).status, 400);                   // 9695 + 300 fortes + 6 partidas > 10000
  assert.strictEqual((await c({ aprovadas: 9694 })).status, 200);
  const o = (await api('GET', '/api/levantamento')).body.ops[0];
  assert.strictEqual(o.aprovadas, 9694);
  assert.strictEqual(o.contaminados, 300);   // só fortes, vêm do MISU
});

test('contadeira por OP: uma OP em várias mesas, e uma mesa partilhada entra nas duas OPs', async () => {
  await loteCompleto('A1', true, { o: '111111' });
  await loteCompleto('A2', true, { o: '111111 + 222222' });
  await loteCompleto('A3', true, { o: '222222' });
  const j = (await api('GET', '/api/levantamento')).body;
  const o1 = j.ops.find((x) => x.op === '111111'), o2 = j.ops.find((x) => x.op === '222222');
  assert.deepStrictEqual(o1.mesas, ['A1', 'A2']);
  assert.deepStrictEqual(o2.mesas, ['A2', 'A3']);
  assert.strictEqual(o1.partilhada, true);
  for (const m of ['A1', 'A2', 'A3']) await api('POST', `/api/misu/${m}`, { ligeiros: 0, fortes: 0, qvs: 0 });
  assert.strictEqual((await api('POST', '/api/contadeira/op/111111', { aprovadas: 15000 })).status, 200);   // sem teto em OPs com mesa partilhada
  assert.strictEqual((await api('POST', '/api/contadeira/op/222222', { aprovadas: 100 })).status, 200);
});

test('contadeira por OP: espera pelas provas', async () => {
  await lote('A1', 2, '15007551');
  await pool.query(`UPDATE lotes SET contadeira = true WHERE mesa = 'A1'`);
  assert.strictEqual((await api('POST', '/api/contadeira/op/15007551', { aprovadas: 1 })).status, 409);
});

test('QVs: soma colocação (ecrã 1) + MISU + logística', async () => {
  await loteCompleto('A1', false, { q: 10 });
  await api('POST', '/api/misu/A1', { ligeiros: 1, fortes: 1, qvs: 5 });
  let m = await lev('A1');
  assert.deepStrictEqual(m.qvs, { colocacao: 10, misu: 5, logistica: 0, total: 15 });
  assert.strictEqual((await api('POST', '/api/logistica/qvs/A1', { qvs: 2 })).status, 200);
  m = await lev('A1');
  assert.deepStrictEqual(m.qvs, { colocacao: 10, misu: 5, logistica: 2, total: 17 });
  assert.strictEqual((await api('POST', '/api/logistica/qvs/A1', { qvs: -3 })).status, 400);
  assert.strictEqual((await api('POST', '/api/logistica/qvs/A1', {})).status, 400);
});

test('mapa vermelho/verde: vermelho = vez do MISU, verde = vez da logística (contaminados à frente)', async () => {
  const L = (await api('GET', '/api/logistica/mesas')).body.lado;
  await loteCompleto(`${L}1`, false);
  await loteCompleto(`${L}2`, true);
  await lote(`${L}3`, 2);                                   // ainda em provas
  const est = async (n) => (await api('GET', '/api/logistica/mesas')).body.mesas.find((m) => m.mesa === `${L}${n}`).estado;
  assert.strictEqual(await est(1), 'misu');
  assert.strictEqual(await est(2), 'misu');
  assert.strictEqual(await est(3), 'em_prova');
  await api('POST', `/api/misu/${L}1`, { ligeiros: 1, fortes: 1 });
  await api('POST', `/api/misu/${L}2`, { ligeiros: 1, fortes: 1 });   // entrega à contadeira
  assert.strictEqual(await est(1), 'pronta');
  assert.strictEqual(await est(2), 'pronta');
  assert.strictEqual((await api('POST', '/api/logistica/levantar', { mesa: `${L}1` })).status, 200);
  assert.strictEqual(await est(1), 'levantada');
  const j = (await api('GET', '/api/levantamento')).body.mesas;
  assert.strictEqual(j.find((m) => m.mesa === `${L}1`).fase, 'levantada');
  assert.strictEqual(j.find((m) => m.mesa === `${L}2`).fase, 'logistica');
  assert.strictEqual(j.find((m) => m.mesa === `${L}3`).fase, 'em_prova');
});

test('MISU trabalha à mesa, não à OP: mesa partilhada por várias OPs funciona como uma só mesa', async () => {
  await loteCompleto('A1', false);
  await pool.query(`UPDATE lotes SET ordem = '15102461 + 15007567' WHERE mesa = 'A1' AND data_planeamento = $1`, [hoje()]);
  assert.strictEqual((await api('POST', '/api/misu/A1', { ligeiros: 10, fortes: 5 })).status, 200);
  assert.strictEqual((await lev('A1')).aprovadas, 9979);
});

test('MISU só vê as mesas do dia da prova: lote de outro dia não conta (as mesas fecham no próprio dia)', async () => {
  await lote('A1', 1);
  await pool.query(`UPDATE lotes SET data_planeamento = data_planeamento - 1 WHERE mesa = 'A1'`);
  assert.strictEqual((await api('POST', '/api/misu/A1', { ligeiros: 1, fortes: 1 })).status, 404);
  assert.strictEqual((await api('GET', '/api/levantamento')).body.mesas.length, 0);
});

test('rolhas por frasco 1 / 2 / 4 multiplicam os frascos', async () => {
  for (const r of [1, 2, 4]) {
    await limpar();
    await loteCompleto('A1', false, { r, f: 1000, p: 10 });
    const m = await lev('A1');
    assert.strictEqual(m.totalRolhas, 1000 * r);
    assert.strictEqual(m.rolhasPartidas, 10 * r);
  }
});

test('provadores veem os frascos partidos da mesa', async () => {
  await loteCompleto('A1', false, { r: 4, p: 5 });
  const e = (await api('GET', '/api/mesa/A1?aprovador=Tânia Lino')).body;
  assert.strictEqual(e.frascosPartidos, 5);
  assert.strictEqual(e.rolhasPartidas, 20);
});

// ---- Logística: colocar mesas ----
const corpo = (dia, L, extra = {}) => ({ data: dia, mesas: [`${L}1`, `${L}2`], ordem: '15007551', rolhasPorFrasco: 2, totalFrascosCliente: 5000, contadeira: true, qvs: 7, tipo: 'EUR', dsrol: false, frascosPartidos: 3, ...extra });

test('colocar: grava a OP e os campos nas mesas e aparecem no mapa de amanhã', async () => {
  const dia = proximoUtil();
  const L = plan.ladoDoDia(dia);
  const r = await api('POST', '/api/logistica/colocar', corpo(dia, L));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.mesas, 2);
  const j = (await api('GET', `/api/logistica/mesas?data=${dia}`)).body;
  const m = j.mesas.find((x) => x.mesa === `${L}1`);
  assert.strictEqual(m.estado, 'colocada');
  assert.strictEqual(m.ordem, '15007551');
  assert.strictEqual(m.rolhasPorFrasco, 2);
  assert.strictEqual(m.totalFrascosCliente, 5000);
  assert.strictEqual(m.contadeira, true);
  assert.strictEqual(m.qvs, 7);
  assert.strictEqual(m.totalRolhas, 10000);
  assert.strictEqual(m.rolhasPartidas, 6);
  assert.strictEqual(m.tipo, 'EUR');
  assert.strictEqual(m.dsrol, false);
  assert.strictEqual(m.frascosPartidos, 3);
  assert.strictEqual(j.mesas.find((x) => x.mesa === `${L}3`).estado, 'sem_lote');
});

test('colocar: a data da prova é sempre o dia útil seguinte à logística (n+1)', async () => {
  const dia = proximoUtil();
  const L = plan.ladoDoDia(dia);
  assert.strictEqual((await api('POST', '/api/logistica/colocar', corpo(dia, L))).status, 200);
  const depois = plan.diaUtilSeguinte(dia);
  const r = await api('POST', '/api/logistica/colocar', corpo(depois, plan.ladoDoDia(depois), { mesas: [`${plan.ladoDoDia(depois)}1`] }));
  assert.strictEqual(r.status, 400);
  assert.match(r.body.erro, /dia útil seguinte/);
  assert.strictEqual((await api('POST', '/api/logistica/colocar', corpo(hoje(), plan.ladoDoDia(hoje())))).status, 401);
});

test('colocar: nº de ordem tem de começar por 150, 151 ou 950', async () => {
  const dia = proximoUtil();
  const L = plan.ladoDoDia(dia);
  for (const bom of ['15007551', '15102461', '95012345']) {
    assert.strictEqual((await api('POST', '/api/logistica/colocar', corpo(dia, L, { ordem: bom }))).status, 200, bom);
  }
  for (const mau of ['14007551', '12345678', '15', 'abc', '150-123', '', '250123456']) {
    assert.strictEqual((await api('POST', '/api/logistica/colocar', corpo(dia, L, { ordem: mau }))).status, 400, mau);
  }
});

test('colocar: rolhas por frasco só 1, 2 ou 4', async () => {
  const dia = proximoUtil();
  const L = plan.ladoDoDia(dia);
  for (const ok of [1, 2, 4]) assert.strictEqual((await api('POST', '/api/logistica/colocar', corpo(dia, L, { rolhasPorFrasco: ok }))).status, 200);
  for (const mau of [0, 3, 5, 8, null, 'x']) assert.strictEqual((await api('POST', '/api/logistica/colocar', corpo(dia, L, { rolhasPorFrasco: mau }))).status, 400, String(mau));
});

test('colocar: valida total de frascos, contadeira, mesas, lado, data', async () => {
  const dia = proximoUtil();
  const L = plan.ladoDoDia(dia);
  const O = L === 'A' ? 'B' : 'A';
  const c = (extra) => api('POST', '/api/logistica/colocar', corpo(dia, L, extra));
  assert.strictEqual((await c({ totalFrascosCliente: 0 })).status, 400);
  assert.strictEqual((await c({ totalFrascosCliente: 'x' })).status, 400);
  assert.strictEqual((await c({ contadeira: 'sim' })).status, 400);
  assert.strictEqual((await c({ contadeira: false })).status, 200);
  assert.strictEqual((await c({ mesas: [] })).status, 400);
  assert.strictEqual((await c({ mesas: [`${O}1`] })).status, 400);       // lado errado
  assert.strictEqual((await c({ mesas: [`${L}99`] })).status, 400);       // mesa inexistente
  assert.strictEqual((await c({ data: '2020-01-01' })).status, 400);       // passado
  assert.strictEqual((await c({ data: '2026-10-24' })).status, 400);       // fim de semana
  assert.strictEqual((await c({ qvs: '' })).status, 200);                  // QVs opcional
  assert.strictEqual((await c({ qvs: -1 })).status, 400);
  assert.strictEqual((await c({ qvs: 'abc' })).status, 400);
});

test('colocar: tipo EUR/GRUPO/AMOSTRA; amostra = 3 provadores; DSROL e frascos partidos', async () => {
  const dia = proximoUtil();
  const L = plan.ladoDoDia(dia);
  for (const t of ['EUR', 'GRUPO']) assert.strictEqual((await api('POST', '/api/logistica/colocar', corpo(dia, L, { tipo: t }))).status, 200);
  let lst = (await api('GET', `/api/lotes?data=${dia}`)).body;
  assert.strictEqual(lst[0].numero_provadores, 2);
  assert.strictEqual((await api('POST', '/api/logistica/colocar', corpo(dia, L, { tipo: 'AMOSTRA' }))).status, 200);
  lst = (await api('GET', `/api/lotes?data=${dia}`)).body;
  assert.strictEqual(lst[0].numero_provadores, 3);
  for (const mau of ['', 'eur', 'OUTRO', null]) assert.strictEqual((await api('POST', '/api/logistica/colocar', corpo(dia, L, { tipo: mau }))).status, 400, String(mau));
  assert.strictEqual((await api('POST', '/api/logistica/colocar', corpo(dia, L, { dsrol: 'sim' }))).status, 400);
  assert.strictEqual((await api('POST', '/api/logistica/colocar', corpo(dia, L, { dsrol: true }))).status, 200);
  assert.strictEqual((await api('POST', '/api/logistica/colocar', corpo(dia, L, { frascosPartidos: -1 }))).status, 400);
  assert.strictEqual((await api('POST', '/api/logistica/colocar', corpo(dia, L, { frascosPartidos: 2.5 }))).status, 400);
  assert.strictEqual((await api('POST', '/api/logistica/colocar', corpo(dia, L, { frascosPartidos: '' }))).status, 200); // vazio = 0
  const m = (await api('GET', `/api/logistica/mesas?data=${dia}`)).body.mesas.find((x) => x.mesa === `${L}1`);
  assert.strictEqual(m.frascosPartidos, 0);
});

test('colocar amanhã não pede palavra-passe; mexer em hoje só com a da supervisora', async () => {
  const dia = proximoUtil();
  const L = plan.ladoDoDia(dia);
  assert.strictEqual((await api('POST', '/api/logistica/colocar', corpo(dia, L))).status, 200);
  assert.strictEqual((await api('POST', '/api/logistica/colocar', corpo(dia, L, { pin: '0000' }))).status, 401);
  const hoje = plan.hojeLisboa();
  const Lh = await require('../logic').ladoHoje();
  assert.strictEqual((await api('POST', '/api/logistica/colocar', corpo(hoje, Lh))).status, 401);
  assert.strictEqual((await api('POST', '/api/logistica/remover', { data: hoje, mesas: [`${Lh}1`] })).status, 401);
  assert.strictEqual((await api('POST', '/api/supervisora/mesa/' + Lh + '1', { ligeiros: 1 })).status, 401);
  assert.strictEqual((await api('POST', '/api/supervisora/mesa/' + Lh + '1', { pin: '0000' })).status, 401);
  await api('POST', '/api/logistica/remover', { data: dia, mesas: [`${L}1`, `${L}2`] });
});

test('supervisora: com a palavra-passe corrige uma mesa de hoje; ligeiras+fortes não passam o total', async () => {
  const hoje = plan.hojeLisboa();
  const Lh = await require('../logic').ladoHoje();
  assert.strictEqual((await api('POST', '/api/logistica/colocar', corpo(hoje, Lh, { mesas: [`${Lh}3`], pin: '8126' }))).status, 200);
  const r = await api('POST', `/api/supervisora/mesa/${Lh}3`, { pin: '8126', misu: { ligeiros: 5, fortes: 2, qvs: 1 }, frascosPartidos: 4 });
  assert.strictEqual(r.status, 200);
  const x = (await api('GET', '/api/levantamento')).body.mesas.find((m) => m.mesa === `${Lh}3`);
  assert.strictEqual(x.ligeiros, 5); assert.strictEqual(x.fortes, 2); assert.strictEqual(x.frascosPartidos, 4);
  assert.strictEqual((await api('POST', `/api/supervisora/mesa/${Lh}3`, { pin: '8126', misu: { ligeiros: 99999999 } })).status, 400);
  assert.strictEqual((await api('POST', '/api/logistica/remover', { data: hoje, mesas: [`${Lh}3`], pin: '8126' })).status, 200);
});

test('colocar: voltar a guardar a mesma mesa atualiza; remover tira a mesa', async () => {
  const dia = proximoUtil();
  const L = plan.ladoDoDia(dia);
  await api('POST', '/api/logistica/colocar', corpo(dia, L));
  await api('POST', '/api/logistica/colocar', corpo(dia, L, { ordem: '15102461', mesas: [`${L}1`] }));
  let lst = (await api('GET', `/api/lotes?data=${dia}`)).body;
  assert.strictEqual(lst.find((x) => x.mesa === `${L}1`).ordem, '15102461');
  assert.strictEqual(lst.length, 2);
  assert.strictEqual((await api('POST', '/api/logistica/remover', { data: dia, mesas: [`${L}1`] })).status, 200);
  lst = (await api('GET', `/api/lotes?data=${dia}`)).body;
  assert.deepStrictEqual(lst.map((x) => x.mesa), [`${L}2`]);
});

test('colocar: mesas colocadas para amanhã não afetam hoje', async () => {
  const dia = proximoUtil();
  const L = plan.ladoDoDia(dia);
  await api('POST', '/api/logistica/colocar', corpo(dia, L));
  assert.strictEqual((await api('GET', `/api/lotes?data=${hoje()}`)).body.length, 0);
});

// ---- Logística ----
test('logística: estados vermelho / verde / sem lote e contagens', async () => {
  const L = (await api('GET', '/api/logistica/mesas')).body.lado;
  await lote(`${L}1`, 2);
  await lote(`${L}2`, 2);
  await lote(`${L}3`, 1);
  await fechadoHa(`${L}1`, 'Marta Santos', 90);
  await fechadoHa(`${L}1`, 'Tânia Lino', 60);
  await fechadoHa(`${L}2`, 'Marta Santos', 60);
  await api('POST', `/api/mesa/${L}3/abrir`, { aprovador: 'Teresa Pinto' });
  const j = (await api('GET', '/api/logistica/mesas')).body;
  const e = (n) => j.mesas.find((m) => m.mesa === `${L}${n}`);
  assert.strictEqual(e(1).estado, 'misu');           // provas concluídas: vez do MISU (vermelho)
  assert.strictEqual(e(2).estado, 'em_prova');
  assert.strictEqual(e(2).feitos, 1);
  assert.strictEqual(e(3).estado, 'em_prova');
  assert.strictEqual(e(3).emAnalise, true);
  assert.strictEqual(e(4).estado, 'sem_lote');
  assert.strictEqual(j.mesas.length, plan.MESAS[L]);
  assert.strictEqual(j.filas.flat().length, plan.MESAS[L]);
});

test('logística: levantar só quando completa e depois do MISU; desfazer; mesa sem lote', async () => {
  const L = (await api('GET', '/api/logistica/mesas')).body.lado;
  await lote(`${L}1`, 2);
  await fechadoHa(`${L}1`, 'Marta Santos', 60);
  assert.strictEqual((await api('POST', '/api/logistica/levantar', { mesa: `${L}1` })).status, 409);
  await fechadoHa(`${L}1`, 'Tânia Lino', 40);
  const r = await api('POST', '/api/logistica/levantar', { mesa: `${L}1` });       // provas ok mas o MISU ainda não levantou os contaminados
  assert.strictEqual(r.status, 409);
  assert.match(r.body.erro, /contaminados/);
  assert.strictEqual((await api('POST', `/api/misu/${L}1`, { ligeiros: 0, fortes: 0 })).status, 200);
  assert.strictEqual((await api('POST', '/api/logistica/levantar', { mesa: `${L}1` })).status, 200);
  const est = async () => (await api('GET', '/api/logistica/mesas')).body.mesas.find((m) => m.mesa === `${L}1`).estado;
  assert.strictEqual(await est(), 'levantada');
  assert.strictEqual((await api('POST', '/api/logistica/levantar', { mesa: `${L}1`, desfazer: true })).status, 200);
  assert.strictEqual(await est(), 'pronta');       // verde: MISU já levantou, vez da logística
  assert.strictEqual((await api('POST', '/api/logistica/levantar', { mesa: `${L}20` })).status, 409);
  assert.strictEqual((await api('POST', '/api/logistica/levantar', {})).status, 400);
});

// (último, porque bloqueia este IP durante 1 minuto)
test('poka-yoke: com contadeira, aprovadas + contaminadas tem de bater com a colocação; sem contadeira confere por construção', async () => {
  await loteCompleto('A1', true, { o: '15007551' });
  await api('POST', '/api/misu/A1', { ligeiros: 10, fortes: 10 });
  assert.strictEqual((await api('POST', '/api/contadeira/op/15007551', { aprovadas: 9974 })).status, 200);
  assert.strictEqual((await lev('A1')).desvio, null);
  // a supervisora altera a colocação a meio do processo: o levantamento deixa de bater e fica bloqueado
  assert.strictEqual((await api('POST', '/api/supervisora/mesa/A1', { pin: '8126', totalFrascosCliente: 4000 })).status, 200);
  assert.match((await lev('A1')).desvio, /Não confere/);
  const r = await api('POST', '/api/logistica/levantar', { mesa: 'A1' });
  assert.strictEqual(r.status, 409);
  assert.match(r.body.erro, /Não confere/);
  await api('POST', '/api/supervisora/mesa/A1', { pin: '8126', totalFrascosCliente: 5000 });
  assert.strictEqual((await api('POST', '/api/logistica/levantar', { mesa: 'A1' })).status, 200);
  await loteCompleto('A2', false);
  await api('POST', '/api/misu/A2', { ligeiros: 3, fortes: 2 });
  assert.strictEqual((await lev('A2')).desvio, null);
});

test('supervisora: limpar dados de teste só com palavra-passe e confirmação', async () => {
  await loteCompleto('A1', false);
  assert.strictEqual((await api('POST', '/api/supervisora/reset', { confirmar: 'APAGAR' })).status, 401);
  assert.strictEqual((await api('POST', '/api/supervisora/reset', { pin: '8126' })).status, 400);
  assert.strictEqual((await api('POST', '/api/supervisora/reset', { pin: '8126', confirmar: 'APAGAR' })).status, 200);
  assert.strictEqual((await api('GET', '/api/levantamento')).body.mesas.length, 0);
});

test('histórico: todos os movimentos ficam guardados e sobrevivem à limpeza de dados de teste', async () => {
  await loteCompleto('A1', false);
  await api('POST', '/api/misu/A1', { ligeiros: 1, fortes: 1 });
  await api('POST', '/api/logistica/levantar', { mesa: 'A1' });
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual((await api('POST', '/api/supervisora/movimentos', {})).status, 401);
  let h = (await api('POST', '/api/supervisora/movimentos', { pin: '8126', formato: 'json' })).body;
  const acoes = h.movimentos.map((m) => m.acao);
  assert.ok(acoes.includes('misu') && acoes.includes('levantamento_mesa'));
  assert.ok(!JSON.stringify(h).includes('8126'));                       // a palavra-passe nunca é guardada
  await api('POST', '/api/supervisora/reset', { pin: '8126', confirmar: 'APAGAR' });
  await new Promise((r) => setTimeout(r, 300));
  const h2 = (await api('POST', '/api/supervisora/movimentos', { pin: '8126', formato: 'json' })).body;
  assert.ok(h2.total > h.total);                                         // o histórico mantém-se e regista a própria limpeza
  assert.ok(h2.movimentos.some((m) => m.acao === 'limpeza_dados_teste'));
});

test('colocação por ordem: 5 ordens (2 e 1 rolhas) partilham a mesma mesa e respeitam os 483 frascos', async () => {
  const dia = proximoUtil();
  const L = plan.ladoDoDia(dia);
  const ordens = [['15007565', 95, 2], ['15102480', 25, 2], ['15102467', 230, 2], ['15102469', 7, 1], ['15102470', 91, 1]];
  const base = { data: dia, tipo: 'EUR', contadeira: false, dsrol: false, continua: false, encomenda: 100000 };
  for (const [op, f, r] of ordens) {
    const p = await api('POST', '/api/logistica/ordem/proposta', { ...base, ordem: op, frascos: f, rolhasPorFrasco: r });
    assert.strictEqual(p.status, 200);
    assert.strictEqual(p.body.segmentos.length, 1);
    assert.strictEqual(p.body.segmentos[0].mesa, `${L}1`);
    assert.strictEqual((await api('POST', '/api/logistica/ordem/confirmar', { ...base, ordem: op, frascos: f, rolhasPorFrasco: r, distribuicao: [{ mesa: `${L}1`, partidos: 0, qvs: 1 }] })).status, 200);
  }
  const m = (await api('GET', `/api/logistica/mesas?data=${dia}`)).body.mesas.find((x) => x.mesa === `${L}1`);
  assert.strictEqual(m.ordem, '15007565 + 15102480 + 15102467 + 15102469 + 15102470');
  assert.strictEqual(m.totalFrascosCliente, 448);
  assert.strictEqual(m.totalRolhas, 350 * 2 + 98 * 1);              // 798 rolhas
  assert.strictEqual(m.ocupado, 483);
  assert.strictEqual(m.qvs, 5);
  assert.deepStrictEqual(m.segmentos.map((s) => [s.op, s.de, s.ate]), [['15007565', 1, 95], ['15102480', 106, 130], ['15102467', 141, 370], ['15102469', 379, 385], ['15102470', 393, 483]]);
  // a mesa está cheia: a ordem seguinte vai para a mesa 2
  const p2 = await api('POST', '/api/logistica/ordem/proposta', { ...base, ordem: '15102499', frascos: 100, rolhasPorFrasco: 2 });
  assert.strictEqual(p2.body.segmentos[0].mesa, `${L}2`);
  // a mesma ordem não se coloca duas vezes
  assert.strictEqual((await api('POST', '/api/logistica/ordem/proposta', { ...base, ordem: '15007565', frascos: 5, rolhasPorFrasco: 2 })).status, 409);
  // tirar uma ordem do meio
  assert.strictEqual((await api('POST', '/api/logistica/ordem/remover', { data: dia, ordem: '15102467' })).status, 401);   // só a supervisão tira ordens
  assert.strictEqual((await api('POST', '/api/logistica/ordem/remover', { data: dia, ordem: '15102467', pin: '8126' })).status, 200);
  const m2 = (await api('GET', `/api/logistica/mesas?data=${dia}`)).body.mesas.find((x) => x.mesa === `${L}1`);
  assert.strictEqual(m2.totalRolhas, 120 * 2 + 98);
  assert.ok(!m2.ordem.includes('15102467'));
});

test('colocação por ordem: uma ordem grande reparte-se por várias mesas; valida dados e dia', async () => {
  const dia = proximoUtil();
  const L = plan.ladoDoDia(dia);
  const base = { data: dia, tipo: 'GRUPO', contadeira: true, dsrol: true, continua: false, encomenda: 100000, ordem: '15102001', rolhasPorFrasco: 4 };
  const p = await api('POST', '/api/logistica/ordem/proposta', { ...base, frascos: 1000 });
  assert.deepStrictEqual(p.body.segmentos.map((s) => [s.mesa, s.frascos]), [[`${L}1`, 483], [`${L}2`, 483], [`${L}3`, 34]]);
  assert.strictEqual(p.body.totalRolhas, 4000);
  assert.strictEqual((await api('POST', '/api/logistica/ordem/proposta', { ...base, frascos: 0 })).status, 400);
  assert.strictEqual((await api('POST', '/api/logistica/ordem/proposta', { ...base, frascos: 10, rolhasPorFrasco: 3 })).status, 400);
  assert.strictEqual((await api('POST', '/api/logistica/ordem/proposta', { ...base, frascos: 10, ordem: '123456' })).status, 400);
  assert.strictEqual((await api('POST', '/api/logistica/ordem/proposta', { ...base, frascos: 999999 })).body.semCapacidade > 0, true);
  assert.strictEqual((await api('POST', '/api/logistica/ordem/confirmar', { ...base, frascos: 999999 })).status, 400);
  assert.strictEqual((await api('POST', '/api/logistica/ordem/confirmar', { ...base, frascos: 1000, tipo: 'X' })).status, 400);
  assert.strictEqual((await api('POST', '/api/logistica/ordem/confirmar', { ...base, frascos: 1000, distribuicao: [{ mesa: `${L}3`, partidos: 99 }] })).status, 400);   // mais partidos do que frascos
  assert.strictEqual((await api('POST', '/api/logistica/ordem/confirmar', { ...base, frascos: 1000, distribuicao: [{ mesa: `${L}1`, partidos: 3 }, { mesa: `${L}2`, partidos: 0 }] })).status, 200);
  const j = (await api('GET', `/api/logistica/mesas?data=${dia}`)).body.mesas;
  assert.strictEqual(j.find((x) => x.mesa === `${L}1`).totalRolhas, 483 * 4);
  assert.strictEqual(j.find((x) => x.mesa === `${L}1`).rolhasPartidas, 12);
  assert.strictEqual(j.find((x) => x.mesa === `${L}3`).totalRolhas, 34 * 4);
  // hoje só com palavra-passe
  assert.strictEqual((await api('POST', '/api/logistica/ordem/proposta', { ...base, data: plan.hojeLisboa(), frascos: 10 })).status, 401);
  // tirar a ordem limpa as 3 mesas
  assert.strictEqual((await api('POST', '/api/logistica/ordem/remover', { data: dia, ordem: '15102001', pin: '8126' })).status, 200);
  assert.strictEqual((await api('GET', `/api/lotes?data=${dia}`)).body.length, 0);
});

test('colocação por ordem: mesa partilhada em levantamento (hoje): MISU à mesa com as rolhas somadas', async () => {
  const hoje = plan.hojeLisboa();
  const Lh = await require('../logic').ladoHoje();
  const b = { data: hoje, pin: '8126', tipo: 'EUR', contadeira: false, dsrol: false, continua: false, encomenda: 100000 };
  assert.strictEqual((await api('POST', '/api/logistica/ordem/confirmar', { ...b, ordem: '15007565', frascos: 95, rolhasPorFrasco: 2, distribuicao: [{ mesa: `${Lh}1`, partidos: 2 }] })).status, 200);
  assert.strictEqual((await api('POST', '/api/logistica/ordem/confirmar', { ...b, ordem: '15102469', frascos: 7, rolhasPorFrasco: 1 })).status, 200);
  await fechadoHa(`${Lh}1`, 'Marta Santos', 60);
  await fechadoHa(`${Lh}1`, 'Tânia Lino', 50);
  const m = await lev(`${Lh}1`);
  assert.strictEqual(m.totalRolhas, 95 * 2 + 7);
  assert.strictEqual(m.rolhasPartidas, 4);
  assert.strictEqual(m.segmentos.length, 2);
  assert.strictEqual((await api('POST', `/api/misu/${Lh}1`, { ligeiros: 10, fortes: 5 })).status, 400);             // tem de ser por ordem
  assert.strictEqual((await api('POST', `/api/misu/${Lh}1`, { ordens: { '15007565': { ligeiros: 10, fortes: 5 } } })).status, 400);   // falta a outra ordem
  assert.strictEqual((await api('POST', `/api/misu/${Lh}1`, { ordens: { '15007565': { ligeiros: 10, fortes: 5 }, '15102469': { ligeiros: 1, fortes: 1 } } })).status, 200);
  const m2 = await lev(`${Lh}1`);
  assert.strictEqual(m2.aprovadas, 197 - 17 - 4);
  assert.deepStrictEqual(m2.segmentos.map((g) => g.aprovadas), [190 - 15 - 4, 7 - 2]);   // por ordem
});

test('contadeira POR ORDEM: numa mesa partilhada, uma ordem vai à contadeira e a outra não', async () => {
  const hoje = plan.hojeLisboa();
  const Lh = await require('../logic').ladoHoje();
  const b = { data: hoje, pin: '8126', tipo: 'EUR', dsrol: false, continua: false, encomenda: 100000, rolhasPorFrasco: 2 };
  assert.strictEqual((await api('POST', '/api/logistica/ordem/confirmar', { ...b, ordem: '15007565', frascos: 100, contadeira: true })).status, 200);
  assert.strictEqual((await api('POST', '/api/logistica/ordem/confirmar', { ...b, ordem: '15102480', frascos: 25, contadeira: false })).status, 200);
  await fechadoHa(`${Lh}1`, 'Marta Santos', 60);
  await fechadoHa(`${Lh}1`, 'Tânia Lino', 50);
  let m = await lev(`${Lh}1`);
  assert.strictEqual(m.contadeira, true);                                   // a mesa passa pela contadeira (tem uma ordem com contadeira)
  assert.deepStrictEqual(m.segmentos.map((g) => g.contadeira), [true, false]);
  assert.deepStrictEqual(m.contagensOp.map((c) => c.op), ['15007565']);     // só a ordem com contadeira
  // com contadeira só fortes; sem contadeira ligeiros e fortes
  assert.strictEqual((await api('POST', `/api/misu/${Lh}1`, { ordens: { '15007565': { fortes: 4 }, '15102480': { fortes: 1 } } })).status, 400);  // falta ligeiros na ordem sem contadeira
  assert.strictEqual((await api('POST', `/api/misu/${Lh}1`, { ordens: { '15007565': { fortes: 4 }, '15102480': { ligeiros: 2, fortes: 1 } } })).status, 200);
  m = await lev(`${Lh}1`);
  assert.strictEqual(m.segmentos[0].ligeiros, 0);
  assert.strictEqual(m.segmentos[1].aprovadas, 50 - 3);                     // 25 frascos x 2 rolhas - 2 - 1
  assert.strictEqual((await api('POST', '/api/contadeira/op/15102480', { aprovadas: 1 })).status, 404);   // a outra ordem não vai à contadeira
  // novo fluxo: levanta-se primeiro (logística, com QVs) e só depois a contadeira conta
  const LV = (op, extra = {}) => api('POST', '/api/logistica/ordem/levantar', { op, ...extra });
  assert.strictEqual((await api('POST', '/api/contadeira/op/15007565', { aprovadas: 196, ligeiras: 0 })).status, 409);   // ainda não levantada
  assert.strictEqual((await LV('15007565')).status, 200);                                                  // com contadeira as QVs são apontadas na contadeira
  assert.strictEqual((await api('POST', '/api/logistica/levantar', { mesa: `${Lh}1` })).status, 409);       // a mesa não se levanta: é pela ordem
  assert.strictEqual((await api('POST', '/api/logistica/ordem/qvs', { op: '15007565', qvs: 9 })).status, 409);   // levantada: bloqueada
  let od = (await api('GET', '/api/levantamento')).body.ordens.find((x) => x.op === '15007565');
  assert.deepStrictEqual([od.fase, od.aguardaContadeira, od.resultado], ['levantada', true, 'em_curso']);
  assert.strictEqual((await api('POST', '/api/contadeira/op/15007565', { aprovadas: 196, qvs: 7 })).status, 400);   // faltam as ligeiras
  assert.strictEqual((await api('POST', '/api/contadeira/op/15007565', { aprovadas: 190, ligeiras: 2, qvs: 7 })).status, 400);   // 190+2+4 != 200
  assert.strictEqual((await api('POST', '/api/contadeira/op/15007565', { aprovadas: 194, ligeiras: 2 })).status, 400);   // faltam as QVs
  assert.strictEqual((await api('POST', '/api/contadeira/op/15007565', { aprovadas: 194, ligeiras: 2, qvs: 7 })).status, 400);   // faltam as sobras
  assert.strictEqual((await api('POST', '/api/contadeira/op/15007565', { aprovadas: 190, ligeiras: 2, qvs: 7, sobras: 5000 })).status, 400);   // sobras < 5000
  assert.strictEqual((await api('POST', '/api/contadeira/op/15007565', { aprovadas: 190, ligeiras: 2, qvs: 7, sobras: 4 })).status, 200);   // 190+2+4+4 = 200: as sobras fecham o dia
  assert.strictEqual((await api('POST', '/api/contadeira/op/15007565', { aprovadas: 196, ligeiras: 0, qvs: 1 })).status, 409);   // já registada
  assert.strictEqual((await LV('15102480', { qvs: 0 })).status, 200);
  assert.strictEqual((await lev(`${Lh}1`)).estadoProva, 'levantada');                                       // todas as ordens levantadas: mesa levantada
  od = (await api('GET', '/api/levantamento')).body.ordens.find((x) => x.op === '15007565');
  assert.deepStrictEqual([od.qvs.logistica, od.aprovadasDia, od.fase, od.aguardaContadeira], [7, 190, 'levantada', false]);   // as sobras (4) não entram nas aprovadas/acumulado
  assert.strictEqual((await LV('15102480', { desfazer: true })).status, 403);                               // só a supervisora desfaz
  assert.strictEqual((await LV('15102480', { desfazer: true, pin: '8126' })).status, 200);
  assert.notStrictEqual((await lev(`${Lh}1`)).estadoProva, 'levantada');
  // MISU registado: bloqueado (só a supervisora)
  assert.strictEqual((await api('POST', `/api/misu/${Lh}1`, { ordens: { '15007565': { fortes: 1 }, '15102480': { ligeiros: 0, fortes: 0 } } })).status, 409);
  assert.strictEqual((await api('POST', `/api/misu/${Lh}1`, { pin: '8126', ordens: { '15007565': { fortes: 4 }, '15102480': { ligeiros: 2, fortes: 1 } } })).status, 200);
});

test('ordens de vários dias: continua amanhã = 1.º fecho; somatório < encomenda = pendente (decisão da supervisora)', async () => {
  const hoje = plan.hojeLisboa();
  const Lh = await require('../logic').ladoHoje();
  const ontem = plan.diaUtilAnterior(hoje);
  const op = '15102555';
  // ontem: 1.º dia da ordem (continuava), com 1.000 rolhas aprovadas já levantadas; encomenda 3.000
  await pool.query(`INSERT INTO ordens (op, encomenda) VALUES ($1, 3000)`, [op]);
  await pool.query(`INSERT INTO ordens_dia (data, op, continua, aprovadas_final, levantada_em) VALUES ($1, $2, true, 1000, now())`, [ontem, op]);
  const b = { data: hoje, pin: '8126', tipo: 'EUR', contadeira: false, dsrol: false, rolhasPorFrasco: 2, ordem: op, frascos: 100 };
  assert.strictEqual((await api('POST', '/api/logistica/ordem/confirmar', { ...b, continua: false })).status, 400);                 // falta a encomenda
  assert.strictEqual((await api('POST', '/api/logistica/ordem/confirmar', { ...b, encomenda: 3000 })).status, 400);                 // falta "continua amanhã?"
  const info = (await api('GET', `/api/ordem/${op}`)).body;
  assert.deepStrictEqual([info.existe, info.encomenda, info.anteriores, info.continuavaOntem], [true, 3000, 1000, true]);
  assert.strictEqual((await api('POST', '/api/logistica/ordem/confirmar', { ...b, encomenda: 3000, continua: false })).status, 200);
  await fechadoHa(`${Lh}1`, 'Marta Santos', 60);
  await fechadoHa(`${Lh}1`, 'Tânia Lino', 50);
  assert.strictEqual((await api('POST', `/api/misu/${Lh}1`, { ordens: { [op]: { ligeiros: 5, fortes: 5, qvs: 2 } } })).status, 200);
  const ord = async () => (await api('GET', '/api/levantamento')).body.ordens.find((x) => x.op === op);
  let o = await ord();
  assert.deepStrictEqual([o.aprovadasDia, o.anteriores, o.acumulado, o.resultado, o.fase], [190, 1000, 1190, 'em_curso', 'pronta']);
  assert.deepStrictEqual([o.qvs.misu, o.qvs.logistica, o.qvs.total], [2, 0, 2]);
  assert.strictEqual((await api('POST', '/api/logistica/ordem/levantar', { op, qvs: 3 })).status, 200);
  o = await ord();
  assert.deepStrictEqual([o.resultado, o.falta], ['pendente', 1810]);                                              // 1.190 < 3.000 e não continua
  // supervisora: precisa de palavra-passe; acrescenta rolhas ou aceita a falta
  assert.strictEqual((await api('POST', '/api/supervisora/ordem-resultado', { op, acao: 'aceitar' })).status, 401);
  assert.strictEqual((await api('POST', '/api/supervisora/ordem-resultado', { pin: '8126', op, acao: 'acrescentar', rolhas: 0 })).status, 400);
  assert.strictEqual((await api('POST', '/api/supervisora/ordem-resultado', { pin: '8126', op, acao: 'aceitar' })).status, 200);
  assert.strictEqual((await ord()).resultado, 'ok_com_falta');
  assert.strictEqual((await api('POST', '/api/supervisora/ordem-resultado', { pin: '8126', op, acao: 'acrescentar', rolhas: 1810 })).status, 200);
  o = await ord();
  assert.deepStrictEqual([o.resultado, o.acumulado, o.rolhasAdicionais, o.aceiteFalta], ['ok', 3000, 1810, false]);
  const lista = (await api('POST', '/api/supervisora/ordens', { pin: '8126' })).body.ordens.find((x) => x.op === op);
  assert.deepStrictEqual([lista.resultado, lista.falta], ['ok', 0]);
  // com "continua amanhã" fica em 1.º fecho (parcial), mesmo abaixo da encomenda
  assert.strictEqual((await api('POST', '/api/supervisora/ordem', { pin: '8126', data: hoje, mesa: `${Lh}1`, op, continua: true })).status, 200);
  await pool.query(`UPDATE ordens SET rolhas_adicionais = 0 WHERE op = $1`, [op]);
  assert.strictEqual((await ord()).resultado, 'parcial');
});

test('identificação das ordens numa mesa partilhada: seq (A7-1, A7-2, ...) e proposta a avisar', async () => {
  const dia = proximoUtil();
  const L = plan.ladoDoDia(dia);
  const base = { data: dia, tipo: 'EUR', contadeira: false, dsrol: false, continua: false, encomenda: 100000, rolhasPorFrasco: 2 };
  const p1 = await api('POST', '/api/logistica/ordem/proposta', { ...base, ordem: '15007565', frascos: 95 });
  assert.deepStrictEqual([p1.body.segmentos[0].seq, p1.body.segmentos[0].jaTem], [1, 0]);
  await api('POST', '/api/logistica/ordem/confirmar', { ...base, ordem: '15007565', frascos: 95 });
  const p2 = await api('POST', '/api/logistica/ordem/proposta', { ...base, ordem: '15102480', frascos: 25 });
  assert.deepStrictEqual([p2.body.segmentos[0].seq, p2.body.segmentos[0].jaTem], [2, 1]);
  await api('POST', '/api/logistica/ordem/confirmar', { ...base, ordem: '15102480', frascos: 25 });
  const m = (await api('GET', `/api/logistica/mesas?data=${dia}`)).body.mesas.find((x) => x.mesa === `${L}1`);
  assert.deepStrictEqual(m.segmentos.map((s) => s.seq), [1, 2]);
});

test('supervisora: lista de provadores (adicionar, renomear, desativar, reativar) só com palavra-passe', async () => {
  const P = (b) => api('POST', '/api/supervisora/provadores', b);
  assert.strictEqual((await P({ acao: 'listar' })).status, 401);
  const l0 = (await P({ pin: '8126', acao: 'listar' })).body.provadores;
  assert.ok(l0.length >= 9);
  assert.strictEqual((await P({ pin: '8126', acao: 'adicionar', nome: 'Ana Catarina Silva' })).status, 409);   // já existe
  const l1 = (await P({ pin: '8126', acao: 'adicionar', nome: '  Rita   Costa ' })).body.provadores;
  const rita = l1.find((x) => x.nome === 'Rita Costa');
  assert.ok(rita && rita.ativo);
  assert.strictEqual((await P({ pin: '8126', acao: 'renomear', id: rita.id, nome: 'Rita Costa Lima' })).status, 200);
  assert.ok((await api('GET', '/api/aprovadores')).body.some((x) => x.nome === 'Rita Costa Lima'));
  await P({ pin: '8126', acao: 'desativar', id: rita.id });
  assert.ok(!(await api('GET', '/api/aprovadores')).body.some((x) => x.nome === 'Rita Costa Lima'));
  await P({ pin: '8126', acao: 'ativar', id: rita.id });
  assert.ok((await api('GET', '/api/aprovadores')).body.some((x) => x.nome === 'Rita Costa Lima'));
  assert.strictEqual((await P({ pin: '8126', acao: 'adicionar', nome: 'X' })).status, 400);
});

test('supervisora: ver, corrigir e apagar as provas de uma mesa', async () => {
  await lote('A1', 2);
  await fechadoHa('A1', 'Marta Santos', 60);
  await fechadoHa('A1', 'Tânia Lino', 40);
  assert.strictEqual((await api('POST', '/api/supervisora/registos', { mesa: 'A1' })).status, 401);
  const r = (await api('POST', '/api/supervisora/registos', { pin: '8126', mesa: 'A1' })).body.registos;
  assert.strictEqual(r.length, 2);
  const [a, b] = r;
  assert.strictEqual((await api('POST', `/api/supervisora/registo/${a.id}`, { pin: '8126', acao: 'editar', aprovador: 'Ninguém' })).status, 400);
  const e = await api('POST', `/api/supervisora/registo/${a.id}`, { pin: '8126', acao: 'editar', aprovador: 'Raquel Santos', abertura: '08:15', fecho: '08:40' });
  assert.strictEqual(e.status, 200);
  assert.strictEqual(e.body.registo.aprovador, 'Raquel Santos');
  assert.strictEqual(e.body.registo.abertura, '08:15');
  assert.strictEqual(e.body.registo.fecho, '08:40');
  assert.strictEqual((await api('POST', `/api/supervisora/registo/${a.id}`, { pin: '8126', acao: 'editar', abertura: '25:00' })).status, 400);
  assert.strictEqual((await api('POST', `/api/supervisora/registo/${b.id}`, { pin: '8126', acao: 'apagar' })).status, 200);
  assert.strictEqual((await api('POST', '/api/supervisora/registos', { pin: '8126', mesa: 'A1' })).body.registos.length, 1);
  assert.strictEqual((await api('POST', '/api/supervisora/registo/999999', { pin: '8126', acao: 'apagar' })).status, 404);
});

test('supervisora: editar uma ordem (frascos, rolhas, partidos, contadeira...) respeita a capacidade da mesa', async () => {
  const dia = proximoUtil();
  const L = plan.ladoDoDia(dia);
  const base = { data: dia, tipo: 'EUR', contadeira: false, dsrol: false, continua: false, encomenda: 100000, rolhasPorFrasco: 2 };
  await api('POST', '/api/logistica/ordem/confirmar', { ...base, ordem: '15007565', frascos: 95 });
  await api('POST', '/api/logistica/ordem/confirmar', { ...base, ordem: '15102480', frascos: 25 });
  const E = (b) => api('POST', '/api/supervisora/ordem', { pin: '8126', data: dia, mesa: `${L}1`, op: '15007565', ...b });
  assert.strictEqual((await api('POST', '/api/supervisora/ordem', { data: dia, mesa: `${L}1`, op: '15007565', frascos: 90 })).status, 401);
  assert.strictEqual((await E({ frascos: 200 })).status, 400);                  // passava para cima da ordem seguinte (começa no 106)
  assert.strictEqual((await E({ frascosPartidos: 999 })).status, 400);
  assert.strictEqual((await E({ rolhasPorFrasco: 3 })).status, 400);
  assert.strictEqual((await E({ novaOrdem: '15102480' })).status, 409);         // já colocada
  assert.strictEqual((await E({ frascos: 100, rolhasPorFrasco: 4, frascosPartidos: 2, qvs: 3, contadeira: true, tipo: 'GRUPO', dsrol: true })).status, 200);
  const m = (await api('GET', `/api/logistica/mesas?data=${dia}`)).body.mesas.find((x) => x.mesa === `${L}1`);
  assert.strictEqual(m.totalRolhas, 100 * 4 + 25 * 2);
  assert.strictEqual(m.rolhasPartidas, 2 * 4);
  assert.strictEqual(m.segmentos[0].ate, 100);
  assert.strictEqual(m.segmentos[0].contadeira, true);
  assert.strictEqual((await E({ novaOrdem: '15007999' })).status, 200);
  assert.strictEqual((await api('POST', '/api/supervisora/ordem', { pin: '8126', data: '2030-01-01', mesa: `${L}1`, op: '15007999' })).status, 400);
});

test('ordens de teste (sexta 23/10 → prova de hoje): carregam-se uma só vez, com a A7 do exemplo', async () => {
  assert.strictEqual((await api('POST', '/api/supervisora/seed-teste', {})).status, 401);
  const r = await api('POST', '/api/supervisora/seed-teste', { pin: '8126' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.mesas, 9);                                   // A1..A9 (lado do dia)
  await api('POST', '/api/supervisora/seed-teste', { pin: '8126' });     // repetir não duplica
  const hojeD = plan.hojeLisboa(), L = plan.ladoDoDia(hojeD);
  const mesas = (await api('GET', '/api/logistica/mesas')).body.mesas;
  const m7 = mesas.find((x) => x.mesa === `${L}7`);
  assert.deepStrictEqual(m7.segmentos.map((s) => [s.op, s.de, s.ate, s.contadeira]), [['15007565', 1, 95, true], ['15102480', 106, 130, true], ['15102467', 141, 370, true], ['15102469', 379, 385, false], ['15102470', 393, 483, false]]);
  assert.strictEqual(m7.ocupado, 483);
  assert.strictEqual(mesas.find((x) => x.mesa === `${L}1`).totalRolhas, 483 * 2);
  assert.strictEqual(mesas.filter((x) => x.ordem).length, 9);
  const prov = await api('POST', '/api/supervisora/seed-teste', { pin: '8126', provas: true });
  assert.strictEqual(prov.status, 200);
  const lv = (await api('GET', '/api/levantamento')).body.mesas;
  assert.strictEqual(lv.filter((m) => m.estadoProva === 'pronta').length, 9);   // todas as mesas com as provas feitas, prontas para o MISU
  assert.strictEqual(lv.filter((m) => m.fase === 'misu').length, 9);
});

test('sábado como dia útil por data (exceção da supervisora)', async () => {
  const D = (b) => api('POST', '/api/supervisora/dias-extra', b);
  let s = new Date(plan.hojeLisboa() + 'T00:00:00Z');
  while (s.getUTCDay() !== 6) s = new Date(s.getTime() + 86400000);
  const sab = s.toISOString().slice(0, 10);
  assert.strictEqual((await D({ acao: 'listar' })).status, 401);
  assert.strictEqual((await D({ pin: '8126', acao: 'adicionar', data: plan.hojeLisboa() === sab ? '2030-01-02' : plan.hojeLisboa() })).status, 400);   // não é sábado
  assert.strictEqual((await D({ pin: '8126', acao: 'adicionar', data: '2020-01-04' })).status, 400);                                                      // sábado no passado
  const r = await D({ pin: '8126', acao: 'adicionar', data: sab });
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.extras.includes(sab));
  const cal = (await api('GET', '/api/calendario')).body;
  assert.ok(cal.extras.includes(sab));
  // o dia útil seguinte passa a poder ser esse sábado (se for logo a seguir a hoje)
  const doSab = new Date(sab + 'T00:00:00Z'), sexta = new Date(doSab.getTime() - 86400000).toISOString().slice(0, 10);
  if (plan.hojeLisboa() === sexta) assert.strictEqual(cal.proximo, sab);
  assert.strictEqual((await D({ pin: '8126', acao: 'remover', data: sab })).status, 200);
  assert.ok(!(await api('GET', '/api/calendario')).body.extras.includes(sab));
});

test('palavra-passe: 5 tentativas erradas bloqueiam 1 minuto (mesmo com a certa)', async () => {
  for (let i = 0; i < 5; i++) assert.strictEqual((await api('POST', '/api/logistica/pin', { pin: 'x' + i })).status, 401);
  assert.strictEqual((await api('POST', '/api/logistica/pin', { pin: '8126' })).status, 429);
});


test('contador do provador: total e lista das mesas feitas hoje', async () => {
  await lote('A1', '15007551', 2);
  await fechadoHa('A1', 'Marta Santos', 30);
  const r = (await api('GET', `/api/aprovador/${encodeURIComponent('Marta Santos')}/mesas-hoje`)).body;
  assert.strictEqual(r.mesas, 1);
  assert.strictEqual(r.lista[0].mesa, 'A1');
  assert.match(r.lista[0].hora, /^\d\d:\d\d$/);
});
