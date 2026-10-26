const BASE = process.env.TEST_BASE || 'http://localhost:3000';
const pool = require('../db');
const plan = require('../planeamento');

async function api(method, url, body, raw) {
  const r = await fetch(BASE + url, {
    method,
    headers: raw ? { 'Content-Type': 'application/octet-stream' } : { 'Content-Type': 'application/json' },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch (e) { /* sem corpo */ }
  return { status: r.status, body: j };
}
async function limpar() {
  await pool.query('DELETE FROM registos');
  await pool.query('DELETE FROM lotes');
  await pool.query('DELETE FROM lote_ops');
}
const hoje = plan.hojeLisboa;
function lote(mesa, n = 2, ordem = 'OP1') {
  return api('POST', '/api/lotes', { mesa, ordem, numeroProvadores: n, dataPlaneamento: hoje() });
}
// cria registo fechado há `min` minutos (para testar a regra dos 30 min sem esperar)
async function fechadoHa(mesa, aprovador, min) {
  await pool.query(
    `INSERT INTO registos (mesa, aprovador, hora_abertura, hora_fecho, estado)
     VALUES ($1,$2, now() - ($3 || ' minutes')::interval - interval '5 minutes', now() - ($3 || ' minutes')::interval, 'Fechado')`,
    [mesa, aprovador, String(min)]);
}
function proximoUtil(desde = hoje()) { return plan.diaUtilSeguinte(desde); }
module.exports = { api, limpar, lote, fechadoHa, hoje, proximoUtil, pool, plan };
