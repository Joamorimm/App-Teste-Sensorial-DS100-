const pool = require('./db');
const plan = require('./planeamento');
const { derivar } = require('./levantamento');

const MIN_INTERVALO = 30; // minutos entre fecho do ultimo registo e nova abertura

// Lado ativo hoje: o lado dos lotes planeados para hoje; sem lotes, o lado que o calendário (A/B alternado) indica.
async function ladoHoje() {
  const hoje = plan.hojeLisboa();
  const r = await pool.query(`SELECT mesa FROM lotes WHERE data_planeamento = $1 AND ativo = true`, [hoje]);
  if (!r.rows.length) return plan.ladoDoDia(hoje);
  const nB = r.rows.filter((l) => l.mesa[0] === 'B').length;
  return nB * 2 >= r.rows.length ? 'B' : 'A';
}

// Lados com mesas em prova hoje (pode haver A e B no mesmo dia quando a supervisora passa mesas de um dia para o outro)
async function ladosHoje() {
  const hoje = plan.hojeLisboa();
  const r = await pool.query(`SELECT DISTINCT substr(mesa, 1, 1) AS l FROM lotes WHERE data_planeamento = $1 AND ativo = true`, [hoje]);
  const set = new Set(r.rows.map((x) => x.l).filter((l) => l === 'A' || l === 'B'));
  if (!set.size) set.add(plan.ladoDoDia(hoje));
  return [...set].sort();
}

async function obterEstadoMesa(mesa, aprovador) {
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' });

  const loteRes = await pool.query(
    `SELECT * FROM lotes WHERE mesa = $1 AND data_planeamento = $2 AND ativo = true LIMIT 1`,
    [mesa, hoje]
  );
  const lote = loteRes.rows[0] || null;

  const feitosRes = await pool.query(
    `SELECT COUNT(DISTINCT aprovador)::int AS n FROM registos
     WHERE mesa = $1 AND estado = 'Fechado' AND hora_fecho >= (COALESCE((SELECT l.data_origem FROM lotes l WHERE l.mesa = registos.mesa AND l.data_planeamento = (now() AT TIME ZONE 'Europe/Lisbon')::date AND l.ativo LIMIT 1), (now() AT TIME ZONE 'Europe/Lisbon')::date)::timestamp AT TIME ZONE 'Europe/Lisbon') AND hora_fecho < (((now() AT TIME ZONE 'Europe/Lisbon')::date + 1)::timestamp AT TIME ZONE 'Europe/Lisbon')`,
    [mesa]
  );
  const feitos = feitosRes.rows[0].n;
  const necessarios = lote ? lote.numero_provadores : 0;
  const loteCompleto = lote ? feitos >= necessarios : false;

  const abertoRes = await pool.query(
    `SELECT * FROM registos WHERE mesa = $1 AND estado = 'Aberto' LIMIT 1`,
    [mesa]
  );
  const registoAberto = abertoRes.rows[0] || null;

  const jaFezHojeRes = await pool.query(
    `SELECT 1 FROM registos WHERE mesa = $1 AND aprovador = $2 AND estado = 'Fechado'
       AND hora_fecho >= (COALESCE((SELECT l.data_origem FROM lotes l WHERE l.mesa = registos.mesa AND l.data_planeamento = (now() AT TIME ZONE 'Europe/Lisbon')::date AND l.ativo LIMIT 1), (now() AT TIME ZONE 'Europe/Lisbon')::date)::timestamp AT TIME ZONE 'Europe/Lisbon') AND hora_fecho < (((now() AT TIME ZONE 'Europe/Lisbon')::date + 1)::timestamp AT TIME ZONE 'Europe/Lisbon') LIMIT 1`,
    [mesa, aprovador]
  );
  const jaFezHoje = jaFezHojeRes.rowCount > 0;

  const ultimoFechoRes = await pool.query(
    `SELECT * FROM registos WHERE mesa = $1 AND estado = 'Fechado'
       AND hora_fecho >= ((now() AT TIME ZONE 'Europe/Lisbon')::date::timestamp AT TIME ZONE 'Europe/Lisbon') AND hora_fecho < (((now() AT TIME ZONE 'Europe/Lisbon')::date + 1)::timestamp AT TIME ZONE 'Europe/Lisbon')
     ORDER BY hora_fecho DESC LIMIT 1`,
    [mesa]
  );
  const ultimoFecho = ultimoFechoRes.rows[0] || null;

  let minutosPassados = null;
  let podeAbrirAs = null;
  let minutosRestantes = 0;
  let dentroIntervalo = true;

  if (ultimoFecho) {
    const diffMs = Date.now() - new Date(ultimoFecho.hora_fecho).getTime();
    minutosPassados = Math.floor(diffMs / 60000);
    dentroIntervalo = minutosPassados >= MIN_INTERVALO;
    const podeAbrirDate = new Date(new Date(ultimoFecho.hora_fecho).getTime() + MIN_INTERVALO * 60000);
    podeAbrirAs = podeAbrirDate.toISOString();
    minutosRestantes = dentroIntervalo ? 0 : MIN_INTERVALO - minutosPassados;
  }

  // outra mesa aberta pelo mesmo aprovador?
  const outraMesaRes = await pool.query(
    `SELECT * FROM registos WHERE aprovador = $1 AND estado = 'Aberto' AND mesa <> $2 LIMIT 1`,
    [aprovador, mesa]
  );
  const outraMesaAberta = outraMesaRes.rows[0] || null;

  const mesaAbertaPorMim = registoAberto && registoAberto.aprovador === aprovador;
  const mesaAbertaPorOutro = registoAberto && !mesaAbertaPorMim;

  const dsrolOps = lote && lote.dsrol ? (await pool.query(`SELECT op FROM lote_ops WHERE data = $1 AND mesa = $2 AND dsrol = true ORDER BY de`, [hoje, mesa])).rows.map((r) => r.op) : [];
  const lado = await ladoHoje();
  const lados = await ladosHoje();
  const ladoErrado = /^[AB]/.test(mesa) && !lados.includes(mesa[0]);

  const podeAbrir =
    !ladoErrado &&
    !registoAberto &&
    !loteCompleto &&
    !jaFezHoje &&
    dentroIntervalo &&
    !outraMesaAberta;

  return {
    mesa,
    planeado: !!lote,
    ordem: lote ? lote.ordem : null,
    numeroProvadoresNecessarios: necessarios,
    numeroProvadoresFeitos: feitos,
    loteCompleto,
    mesaEmUso: !!registoAberto,
    mesaAbertaPorMim,
    mesaAbertaPorOutro,
    quemTemMesa: mesaAbertaPorOutro ? registoAberto.aprovador : null,
    registoAbertoId: registoAberto ? registoAberto.id : null,
    jaFezHoje,
    minutosPassados,
    podeAbrirAs,
    minutosRestantes,
    outraMesaAberta: !!outraMesaAberta,
    outraMesaCodigo: outraMesaAberta ? outraMesaAberta.mesa : null,
    frascosPartidos: lote ? (lote.frascos_partidos || 0) : null,
    rolhasPorFrasco: lote ? lote.rolhas_por_frasco : null,
    rolhasPartidas: lote ? derivar(lote).rolhasPartidas : null,
    tipo: lote ? lote.tipo : null,
    dsrol: lote ? !!lote.dsrol : false,
    dsrolOps,
    ladoHoje: lados.join(' e '),
    ladoErrado,
    podeAbrir,
  };
}

module.exports = { obterEstadoMesa, ladoHoje, ladosHoje, MIN_INTERVALO };
