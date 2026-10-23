// Cálculos do levantamento (MISU, Contadeira, Logística). Função pura: recebe uma linha de "lotes".
//
// Regras:
// - Total de rolhas da mesa = frascos (total frascos/cliente) x rolhas por frasco (1, 2 ou 4).
// - Rolhas em frascos partidos = frascos partidos x rolhas por frasco (informação sempre visível).
// - O MISU aponta SEMPRE, à mesa, as rolhas de aroma ligeiro e forte (contaminados) e as QVs.
// - Só depois de apontar os contaminados é que a mesa segue (cut off de responsabilidade):
//     * sem contadeira: rolhas aprovadas = total da colocação - (ligeiras + fortes) - rolhas de frascos partidos;
//     * com contadeira: a contadeira (que trabalha à OP) aponta o valor de rolhas aprovadas contado pela máquina.
// - QVs (qualidade visual, nº de rolhas) somam: colocação + MISU + logística.
function derivar(l) {
  const n = (v) => (v === null || v === undefined ? null : Number(v));
  const r = n(l.rolhas_por_frasco);
  const frascos = n(l.total_frascos_cliente);
  const partidos = n(l.frascos_partidos) || 0;
  const contadeira = l.contadeira === true;

  const totalRolhas = r && frascos ? frascos * r : null;
  const rolhasPartidas = r ? partidos * r : null;

  const lig = n(l.misu_ligeiros);
  const fort = n(l.misu_fortes);
  const contaminadosFeito = lig !== null && fort !== null;
  const contaminados = contaminadosFeito ? lig + fort : null;

  let aprovadas = null;
  const aprovadasOrigem = contadeira ? 'contadeira' : 'subtracao';
  if (!contadeira && contaminados !== null && totalRolhas !== null) aprovadas = totalRolhas - contaminados - (rolhasPartidas || 0);

  const q = { colocacao: n(l.qvs_colocacao) || 0, misu: n(l.misu_qvs) || 0, logistica: n(l.log_qvs) || 0 };
  q.total = q.colocacao + q.misu + q.logistica;

  let misuEstado;
  if (!contaminadosFeito) misuEstado = 'pendente';
  else misuEstado = contadeira ? 'entregue' : 'feito';

  return {
    rolhasPorFrasco: r, totalFrascos: frascos, frascosPartidos: partidos,
    totalRolhas, rolhasPartidas, contadeira,
    ligeiros: lig, fortes: fort, contaminados, aprovadas, aprovadasOrigem,
    qvs: q, misuEstado,
    contadeiraPendente: contadeira,
  };
}

// OPs de uma mesa (uma mesa partilhada guarda "op1 + op2")
function opsDoLote(ordem) {
  return String(ordem || '').split('+').map((x) => x.trim()).filter(Boolean);
}

// A CONTADEIRA TRABALHA À OP (não à mesa): agrega as mesas de hoje que vão à contadeira por OP.
// `mesas`: [{ mesa, ordem, contadeira, estadoProva, misuEm, totalRolhas, rolhasPartidas, frascosPartidos }]
// `contagens`: Map op -> { ligeiros, fortes, aprovadas, em }
function agregarOps(mesas, contagens) {
  const por = new Map();
  for (const m of mesas) {
    if (!m.contadeira) continue;
    const ops = opsDoLote(m.ordem);
    for (const op of ops) {
      if (!por.has(op)) por.set(op, { op, mesas: [], lig: 0, fort: 0, totalRolhas: 0, rolhasPartidas: 0, frascosPartidos: 0, partilhada: false });
      const o = por.get(op);
      o.mesas.push(m);
      if (ops.length > 1) o.partilhada = true;
      o.totalRolhas += m.totalRolhas || 0;
      o.lig += m.ligeiros || 0; o.fort += m.fortes || 0;
      o.rolhasPartidas += m.rolhasPartidas || 0;
      o.frascosPartidos += m.frascosPartidos || 0;
    }
  }
  return [...por.values()].map((o) => {
    const c = (contagens && contagens.get(o.op)) || {};
    const prontas = o.mesas.filter((m) => m.estadoProva === 'pronta' || m.estadoProva === 'levantada').length;
    const entregues = o.mesas.filter((m) => m.misuEstado === 'entregue').length;
    const feito = c.aprovadas !== undefined && c.aprovadas !== null;
    let estado = 'aguardar_provas';
    if (prontas === o.mesas.length) estado = entregues === o.mesas.length ? (feito ? 'feito' : 'por_contar') : 'aguardar_misu';
    return {
      op: o.op, mesas: o.mesas.map((m) => m.mesa), nMesas: o.mesas.length, prontas, entregues,
      totalRolhas: o.totalRolhas, rolhasPartidas: o.rolhasPartidas, frascosPartidos: o.frascosPartidos, partilhada: o.partilhada,
      ligeiros: o.lig, fortes: o.fort, contaminados: o.lig + o.fort, // apontados pelo MISU, à mesa
      aprovadas: c.aprovadas ?? null,                                  // contadas pela contadeira, à OP
      estado,
    };
  });
}

module.exports = { derivar, opsDoLote, agregarOps };
