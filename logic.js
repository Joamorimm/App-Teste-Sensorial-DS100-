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

async function obterEstadoMesa(mesa, aprovador) {
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' });

  const loteRes = await pool.query(
    `SELECT * FROM lotes WHERE mesa = $1 AND data_planeamento = $2 AND ativo = true LIMIT 1`,
    [mesa, hoje]
  );
  const lote = loteRes.rows[0] || null;

  const feitosRes = await pool.query(
    `SELECT COUNT(DISTINCT aprovador)::int AS n FROM registos
     WHERE mesa = $1 AND estado = 'Fechado' AND hora_fecho >= CURRENT_DATE AND hora_fecho < CURRENT_DATE + 1`,
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
       AND hora_fecho >= CURRENT_DATE AND hora_fecho < CURRENT_DATE + 1 LIMIT 1`,
    [mesa, aprovador]
  );
  const jaFezHoje = jaFezHojeRes.rowCount > 0;

  const ultimoFechoRes = await pool.query(
    `SELECT * FROM registos WHERE mesa = $1 AND estado = 'Fechado'
       AND hora_fecho >= CURRENT_DATE AND hora_fecho < CURRENT_DATE + 1
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

  const lado = await ladoHoje();
  const ladoErrado = /^[AB]/.test(mesa) && mesa[0] !== lado;

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
    ladoHoje: lado,
    ladoErrado,
    podeAbrir,
  };
}

module.exports = { obterEstadoMesa, ladoHoje, MIN_INTERVALO };
