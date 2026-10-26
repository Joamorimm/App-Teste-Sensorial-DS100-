const XLSX = require('xlsx');
const LAYOUT = require('./layout');

const MESAS = { A: Object.keys(LAYOUT.A.cap).length, B: Object.keys(LAYOUT.B.cap).length }; // A=42, B=43
const CAPACIDADE_LADO = { A: Object.values(LAYOUT.A.cap).reduce((a, b) => a + b, 0), B: Object.values(LAYOUT.B.cap).reduce((a, b) => a + b, 0) };
const capMesa = (lado, n) => LAYOUT[lado].cap[String(n)] || 0;
const MESAS_POR_LADO = 43; // máximo (lado B)
const ESTADOS = ['Liberada', 'Em Processo', 'Entregue Logística'];
const ANCORA_LADO_B = Date.UTC(2026, 9, 21); // prova de 21/10/2026 = lado B; depois alterna A/B só em dias úteis

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };

function hojeLisboa() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' });
}
// Sábados incluídos como dia útil pela supervisora (exceção pontual). Carregados da base de dados pelo servidor.
let DIAS_EXTRA = new Set();
function definirDiasExtra(lista) { DIAS_EXTRA = new Set((lista || []).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x) && parseISO(x).getUTCDay() === 6)); }
const ehUtil = (d) => ![0, 6].includes(d.getUTCDay()) || (d.getUTCDay() === 6 && DIAS_EXTRA.has(iso(d)));
const ehDiaUtil = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && ehUtil(parseISO(s));
function diaUtilAnterior(s) {
  let d = parseISO(s);
  do { d = new Date(d.getTime() - 86400000); } while (!ehUtil(d));
  return iso(d);
}
// Lado da PROVA alterna de dia útil para dia útil (segunda a sexta): 21/10 = B, 22/10 = A, 23/10 = B, 26/10 = A...
// A logística põe os frascos no lado A/B no dia anterior, para os provadores trabalharem esse lado no dia seguinte.
// Fim de semana usa o último dia útil.
function ladoDoDia(s) {
  let d = parseISO(s);
  if (Number.isNaN(d.getTime())) throw new Error('Data inválida.');
  while (!ehUtil(d)) d = new Date(d.getTime() - 86400000);
  const ancora = ANCORA_LADO_B;
  const passo = d.getTime() >= ancora ? 1 : -1;
  let n = 0;
  for (let t = ancora; t !== d.getTime(); t += passo * 86400000) {
    const x = new Date(t + (passo > 0 ? 86400000 : 0));
    if (ehUtil(x)) n += 1;
  }
  return n % 2 === 0 ? 'B' : 'A';
}
function diaUtilSeguinte(s) {
  let d = parseISO(s);
  do { d = new Date(d.getTime() + 86400000); } while (!ehUtil(d));
  return iso(d);
}
function ddmmyyyyParaISO(t) {
  const m = String(t || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${pad(m[2])}-${pad(m[1])}` : null;
}
function formatarIntervalo(lado, ini, fim) {
  return ini === fim ? `${lado}${ini}` : `${lado}${ini}-${lado}${fim}`;
}

// "B1-B13", "B1-13", "B5", "B10; B11; B12" -> ['B1','B2',...]
function expandirIntervalos(texto) {
  const mesas = [];
  for (const tok of String(texto || '').split(/[;,\s]+/).map((t) => t.trim().toUpperCase()).filter(Boolean)) {
    const m = tok.match(/^([AB])(\d+)(?:-([AB]?)(\d+))?$/);
    if (!m) throw new Error(`Intervalo inválido: "${tok}"`);
    const lado = m[1];
    if (m[3] && m[3] !== lado) throw new Error(`Intervalo mistura lados: "${tok}"`);
    const ini = Number(m[2]);
    const fim = m[4] ? Number(m[4]) : ini;
    if (ini < 1 || fim < ini || fim > MESAS[lado]) throw new Error(`Mesas fora do intervalo 1-${MESAS[lado]} do lado ${lado}: "${tok}"`);
    for (let n = ini; n <= fim; n++) mesas.push(`${lado}${n}`);
  }
  return mesas;
}

function lerPlaneamento(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const nome = wb.SheetNames.find((n) => n.trim().toUpperCase() === 'DS100');
  if (!nome) throw new Error('O ficheiro não tem a folha "DS100".');
  return XLSX.utils.sheet_to_json(wb.Sheets[nome], { defval: null });
}

const LINHA = 7; // cada mesa tem 7 frascos de altura (7 por fila)

// Próximo frasco livre numa mesa depois de uma OP terminar no frasco `usado`:
// arredonda às filas completas (de 7) e deixa 1 fila vazia de separação.
// Ex.: termina no 360 -> 52 filas x 7 = 364, + 7 = 371 (a OP seguinte começa no frasco 372).
function inicioSeguinte(usado) {
  return Math.ceil(usado / LINHA) * LINHA + LINHA;
}

function gerarProposta(linhas, dataProva, ladoForcado) {
  if (!ehUtil(parseISO(dataProva))) throw new Error('Escolhe um dia útil (segunda a sexta).');
  const dataProducao = diaUtilAnterior(dataProva);
  const lado = ladoForcado === 'A' || ladoForcado === 'B' ? ladoForcado : ladoDoDia(dataProva);
  const total = MESAS[lado];
  const capDe = (n) => (n <= total ? capMesa(lado, n) : 483);
  const itens = [];
  let mesa = 1;     // mesa atual
  let usado = 0;    // frascos já ocupados (offset) na mesa atual

  for (const r of linhas) {
    const estado = String(r['Estado'] || '').trim();
    if (!ESTADOS.includes(estado)) continue;
    const dias = String(r['Dia'] || '').split('·').map(ddmmyyyyParaISO);        // coluna P
    const idx = dias.indexOf(dataProducao);
    if (idx === -1) continue;

    const uteis = String(r['Dia útil'] || '').split('·');                        // coluna Q
    const m = (uteis[idx] || '').match(/\((\d+)f\)/);
    const frascos = m ? Number(m[1]) : (dias.length === 1 ? Number(r['Frascos']) || 0 : 0);
    if (!frascos) continue;

    // preenche a mesa atual a partir do 1.º frasco livre, depois as mesas seguintes
    if (usado >= capDe(mesa)) { mesa += 1; usado = 0; }
    let restante = frascos;
    const segmentos = [];
    while (restante > 0) {
      const livre = capDe(mesa) - usado;
      const poe = Math.min(restante, livre);
      segmentos.push({ mesa, de: usado + 1, ate: usado + poe });
      restante -= poe;
      usado += poe;
      if (restante > 0) { mesa += 1; usado = 0; }
    }
    const fimMesa = mesa, fimUsado = usado;
    // onde começa a próxima OP: no mesmo sítio da mesa (com separação) ou na mesa seguinte
    const prox = inicioSeguinte(fimUsado);
    if (prox >= capDe(mesa)) { mesa += 1; usado = 0; } else { usado = prox; }

    const dentro = segmentos.filter((sg) => sg.mesa <= total);
    const primeira = segmentos[0].mesa;
    const ultima = dentro.length ? dentro[dentro.length - 1].mesa : null;
    itens.push({
      op: String(r['OP']).trim(),
      alias: r['Alias'] || '',
      produto: r['Produto'] || '',
      estado,
      frascos,
      mesasNecessarias: segmentos.length,
      intervalo: ultima ? formatarIntervalo(lado, primeira, ultima) : '',
      faltam: segmentos.length - dentro.length,
      provadores: Number(r['Provadores']) || 2,
      segmentos: segmentos.map((sg) => ({ mesa: lado + sg.mesa, de: sg.de, ate: sg.ate })),
      partilhaInicio: segmentos[0].de > 1,          // começa numa mesa onde já há outra OP
      fim: { mesa: lado + fimMesa, frasco: fimUsado }, // último frasco ocupado
    });
  }

  const mesasUsadas = usado > 0 ? mesa : mesa - 1;
  return {
    dataProva, dataProducao, lado,
    capacidade: CAPACIDADE_LADO[lado], capacidadeMedia: Math.round(CAPACIDADE_LADO[lado] / total),
    mesasPorLado: total,
    totalNecessarias: Math.max(0, mesasUsadas),
    totalFrascos: itens.reduce((s2, i) => s2 + i.frascos, 0),
    semCapacidade: Math.max(0, mesasUsadas - total),
    itens,
  };
}

module.exports = { definirDiasExtra, ehDiaUtil, inicioSeguinte, LAYOUT, MESAS, MESAS_POR_LADO, CAPACIDADE_LADO, hojeLisboa, diaUtilAnterior, diaUtilSeguinte, ladoDoDia, expandirIntervalos, lerPlaneamento, gerarProposta };
