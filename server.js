const express = require('express');
const path = require('path');
const pool = require('./db');
const { obterEstadoMesa, ladoHoje } = require('./logic');
const { derivar, opsDoLote, agregarOps } = require('./levantamento');
const plan = require('./planeamento');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Aprovadores ---
app.get('/api/aprovadores', async (req, res) => {
  try {
    const r = await pool.query('SELECT id, nome FROM aprovadores WHERE ativo = true ORDER BY nome');
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao obter aprovadores' });
  }
});

// --- Mesas feitas hoje por um aprovador ---
app.get('/api/aprovador/:nome/mesas-hoje', async (req, res) => {
  try {
    const { nome } = req.params;
    const r = await pool.query(
      `SELECT COUNT(DISTINCT mesa)::int AS n FROM registos
       WHERE aprovador = $1 AND estado = 'Fechado'
         AND hora_fecho >= CURRENT_DATE AND hora_fecho < CURRENT_DATE + 1`,
      [nome]
    );
    res.json({ mesas: r.rows[0].n });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao contar mesas' });
  }
});

// --- Estado de uma mesa ---
app.get('/api/mesa/:codigo', async (req, res) => {
  try {
    const { codigo } = req.params;
    const { aprovador } = req.query;
    if (!aprovador) return res.status(400).json({ erro: 'Falta o parâmetro aprovador' });
    const estado = await obterEstadoMesa(codigo.toUpperCase(), aprovador);
    res.json(estado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao consultar estado da mesa' });
  }
});

// --- Abrir mesa ---
app.post('/api/mesa/:codigo/abrir', async (req, res) => {
  const { codigo } = req.params;
  const { aprovador } = req.body;
  if (!aprovador) return res.status(400).json({ erro: 'Falta o aprovador' });
  const mesa = codigo.toUpperCase();

  try {
    const estado = await obterEstadoMesa(mesa, aprovador);
    if (!estado.podeAbrir) {
      return res.status(409).json({ erro: 'Mesa não pode ser aberta neste momento', estado });
    }

    const r = await pool.query(
      `INSERT INTO registos (mesa, aprovador, hora_abertura, estado, ordem)
       VALUES ($1, $2, now(), 'Aberto', $3) RETURNING *`,
      [mesa, aprovador, estado.ordem]
    );
    res.json({ ok: true, registo: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      // violação do índice único (uniq_mesa_aberta) - outra abertura ganhou a corrida
      return res.status(409).json({ erro: 'Mesa já foi aberta entretanto por outro provador.' });
    }
    console.error(err);
    res.status(500).json({ erro: 'Erro ao abrir mesa' });
  }
});

// --- Concluir análise ---
app.post('/api/registo/:id/concluir', async (req, res) => {
  try {
    const { id } = req.params;
    const r = await pool.query(
      `UPDATE registos SET hora_fecho = now(), estado = 'Fechado'
       WHERE id = $1 AND estado = 'Aberto' RETURNING *`,
      [id]
    );
    if (r.rowCount === 0) {
      return res.status(409).json({ erro: 'Registo já não está aberto ou não existe.' });
    }
    res.json({ ok: true, registo: r.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao concluir análise' });
  }
});

// --- Criar/atualizar lote (planeamento manual, enquanto não há importação automática) ---
app.post('/api/lotes', async (req, res) => {
  try {
    const { mesa, ordem, numeroProvadores, dataPlaneamento } = req.body;
    if (!mesa) return res.status(400).json({ erro: 'Falta o campo mesa' });
    const data = dataPlaneamento || new Date().toISOString().slice(0, 10);
    const n = numeroProvadores || 2;
    const r = await pool.query(
      `INSERT INTO lotes (mesa, ordem, data_planeamento, numero_provadores, ativo)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (mesa, data_planeamento)
       DO UPDATE SET ordem = EXCLUDED.ordem, numero_provadores = EXCLUDED.numero_provadores, ativo = true
       RETURNING *`,
      [mesa.toUpperCase(), ordem || null, data, n]
    );
    res.json({ ok: true, lote: r.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao criar lote' });
  }
});

// --- Mesas atribuídas (lotes) de um dia ---
app.get('/api/lotes', async (req, res) => {
  try {
    const data = req.query.data || plan.hojeLisboa();
    const r = await pool.query(
      `SELECT mesa, ordem, numero_provadores FROM lotes WHERE data_planeamento = $1 AND ativo = true`, [data]);
    const num = (m) => parseInt(m.slice(1), 10);
    r.rows.sort((a, b) => a.mesa[0].localeCompare(b.mesa[0]) || num(a.mesa) - num(b.mesa));
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao obter lotes' });
  }
});

// --- Supervisora: gerar proposta de alocação a partir do ficheiro de planeamento (.xlsx) ---
app.post('/api/planeamento/proposta', express.raw({ type: '*/*', limit: '20mb' }), (req, res) => {
  try {
    const dataProva = req.query.data;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataProva || '')) return res.status(400).json({ erro: 'Data de prova inválida.' });
    if (!req.body || !req.body.length) return res.status(400).json({ erro: 'Ficheiro em falta.' });
    const linhas = plan.lerPlaneamento(req.body);
    res.json(plan.gerarProposta(linhas, dataProva, String(req.query.lado || '').toUpperCase()));
  } catch (err) {
    console.error(err);
    res.status(400).json({ erro: err.message || 'Não foi possível ler o ficheiro.' });
  }
});

// --- Supervisora: confirmar a alocação (grava os lotes do dia) ---
app.post('/api/planeamento/confirmar', async (req, res) => {
  const { dataProva, itens } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataProva || '') || !Array.isArray(itens)) {
    return res.status(400).json({ erro: 'Pedido inválido.' });
  }
  const ladoDia = ['A', 'B'].includes(String((req.body || {}).lado).toUpperCase()) ? String(req.body.lado).toUpperCase() : plan.ladoDoDia(dataProva);
  if (new Date(dataProva + 'T00:00:00Z').getUTCDay() % 6 === 0) return res.status(400).json({ erro: 'Escolhe um dia útil (segunda a sexta).' });
  if (dataProva < plan.hojeLisboa()) return res.status(400).json({ erro: 'Não é possível alocar mesas para uma data passada.' });

  let lotes = [];
  try {
    // Uma mesa pode ser partilhada por duas OPs (a 1.ª termina a meio e a 2.ª ocupa os frascos livres).
    const porMesa = new Map();
    for (const it of itens) {
      if (!it.intervalo || !String(it.intervalo).trim()) continue;
      for (const mesa of plan.expandirIntervalos(it.intervalo)) {
        if (mesa[0] !== ladoDia) throw new Error(`A mesa ${mesa} não é do lado ${ladoDia}, que é o lado escolhido para este dia.`);
        const op = String(it.op);
        const n = Number(it.provadores) || 2;
        const l = porMesa.get(mesa);
        if (!l) porMesa.set(mesa, { mesa, ops: [op], n });
        else if (l.ops.includes(op)) throw new Error(`A mesa ${mesa} aparece duas vezes na OP ${op}.`);
        else { l.ops.push(op); l.n = Math.max(l.n, n); }
        if (porMesa.get(mesa).ops.length > 3) throw new Error(`A mesa ${mesa} está atribuída a demasiadas OPs.`);
      }
    }
    lotes = [...porMesa.values()].map((l) => ({ mesa: l.mesa, ordem: l.ops.join(' + '), n: l.n }));
  } catch (err) {
    return res.status(400).json({ erro: err.message });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM lotes WHERE data_planeamento = $1', [dataProva]);
    for (const l of lotes) {
      await client.query(
        `INSERT INTO lotes (mesa, ordem, data_planeamento, numero_provadores, ativo) VALUES ($1,$2,$3,$4,true)`,
        [l.mesa, l.ordem, dataProva, l.n]);
    }
    await client.query('COMMIT');
    res.json({ ok: true, mesas: lotes.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ erro: 'Erro ao gravar a alocação.' });
  } finally {
    client.release();
  }
});

// --- Logística: estado das mesas do dia (vermelho / verde / levantada) ---
app.get('/api/logistica/mesas', async (req, res) => {
  try {
    const data = req.query.data || plan.hojeLisboa();
    const lotes = await pool.query(
      `SELECT mesa, ordem, numero_provadores, levantada_em, rolhas_por_frasco, total_frascos_cliente, contadeira, qvs_colocacao, tipo, dsrol, frascos_partidos, misu_ligeiros, misu_fortes FROM lotes
       WHERE data_planeamento = $1 AND ativo = true`, [data]);
    const lado = data === plan.hojeLisboa() ? await ladoHoje() : plan.ladoDoDia(data);
    const feitos = await pool.query(
      `SELECT mesa, COUNT(DISTINCT aprovador)::int AS n FROM registos
       WHERE estado = 'Fechado' AND hora_fecho >= CURRENT_DATE AND hora_fecho < CURRENT_DATE + 1
       GROUP BY mesa`);
    const abertos = await pool.query(`SELECT mesa FROM registos WHERE estado = 'Aberto'`);
    const nFeitos = new Map(feitos.rows.map((r) => [r.mesa, r.n]));
    const emAnalise = new Set(abertos.rows.map((r) => r.mesa));
    const porMesa = new Map(lotes.rows.map((l) => [l.mesa, l]));
    const mesas = [];
    for (let i = 1; i <= plan.MESAS[lado]; i++) {
      const codigo = lado + i;
      const l = porMesa.get(codigo);
      let estado = 'sem_lote', feitosN = 0, nec = 0;
      if (l) {
        nec = l.numero_provadores;
        feitosN = nFeitos.get(codigo) || 0;
        if (l.levantada_em) estado = 'levantada';
        else if (feitosN >= nec && !emAnalise.has(codigo)) {
          // provas concluídas: vermelho = vez do MISU (contaminados à frente); verde = vez da logística (rolhas OK)
          estado = derivar(l).misuEstado === 'pendente' ? 'misu' : 'pronta';
        } else estado = 'em_prova';
      }
      if (data > plan.hojeLisboa()) estado = l ? 'colocada' : 'sem_lote'; // dia futuro: só mostra o que a logística já colocou
      mesas.push({
        mesa: codigo, ordem: l ? l.ordem : null, estado, feitos: feitosN, necessarios: nec, emAnalise: emAnalise.has(codigo),
        rolhasPorFrasco: l ? l.rolhas_por_frasco : null, totalFrascosCliente: l ? l.total_frascos_cliente : null,
        contadeira: l ? l.contadeira : null, qvs: l ? l.qvs_colocacao : null,
        tipo: l ? l.tipo : null, dsrol: l ? l.dsrol : null, frascosPartidos: l ? l.frascos_partidos : null,
        totalRolhas: l ? derivar(l).totalRolhas : null, rolhasPartidas: l ? derivar(l).rolhasPartidas : null,
      });
    }
    res.json({ data, lado, mesas, filas: plan.LAYOUT[lado].filas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao obter mesas da logística' });
  }
});

// --- Logística: marcar / desmarcar mesa como levantada ---
// Poka-yoke final: o levantamento tem de bater certo com a colocação (total de rolhas dada pela logística).
// Devolve null se confere (ou ainda não há dados para comparar), ou o texto do desvio.
function desvioColocacao(m, ops) {
  if (!m.contadeira) return null; // sem contadeira: aprovadas = total − contaminadas − partidas, confere por construção
  for (const op of m.ops) {
    const o = ops.find((x) => x.op === op);
    if (!o) continue;
    if (o.aprovadas === null) return `A contadeira ainda não contou a OP ${op}.`;
    if (!o.partilhada && o.aprovadas + o.contaminados + o.rolhasPartidas > o.totalRolhas) {
      return `Não confere com a colocação (OP ${op}): aprovadas ${o.aprovadas} + fortes ${o.contaminados} + partidas ${o.rolhasPartidas} = ${o.aprovadas + o.contaminados + o.rolhasPartidas}, que é mais do que as ${o.totalRolhas} rolhas da colocação.`;
    }
  }
  return null;
}
app.post('/api/logistica/levantar', async (req, res) => {
  try {
    const { mesa, desfazer } = req.body || {};
    if (!mesa) return res.status(400).json({ erro: 'Falta a mesa' });
    const data = plan.hojeLisboa();
    if (!desfazer) {
      const f = await pool.query(
        `SELECT COUNT(DISTINCT aprovador)::int AS n FROM registos
         WHERE mesa = $1 AND estado = 'Fechado' AND hora_fecho >= CURRENT_DATE AND hora_fecho < CURRENT_DATE + 1`, [mesa]);
      const l = await pool.query(
        `SELECT * FROM lotes WHERE mesa = $1 AND data_planeamento = $2 AND ativo = true`, [mesa, data]);
      if (!l.rowCount) return res.status(409).json({ erro: 'Mesa sem lote hoje.' });
      if (f.rows[0].n < l.rows[0].numero_provadores) return res.status(409).json({ erro: 'Mesa ainda não está concluída pelos provadores.' });
      {
        const lista = await lotesDeHoje();
        const contagens = await contagensDeHoje();
        const ms = lista.map((x) => formatarLote(x, contagens));
        const mm = ms.find((x) => x.mesa === mesa);
        const desvio = mm && desvioColocacao(mm, agregarOps(ms, contagens));
        if (desvio) return res.status(409).json({ erro: desvio });
      }
      if (derivar(l.rows[0]).misuEstado === 'pendente') return res.status(409).json({ erro: 'Os contaminados andam sempre à frente: o MISU ainda não levantou os contaminados desta mesa.' });
    }
    await pool.query(
      `UPDATE lotes SET levantada_em = ${desfazer ? 'NULL' : 'now()'} WHERE mesa = $1 AND data_planeamento = $2`, [mesa, data]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao registar levantamento' });
  }
});

// --- Proteção por palavra-passe da supervisora (a mesma da outra app). Mudar no Railway com PIN_SUPERVISORA. ---
const PIN = () => String(process.env.PIN_SUPERVISORA || '8126');
const falhas = new Map(); // ip -> { n, ate }
function verificarPin(req, res) {
  const ip = req.ip || 'x';
  const f = falhas.get(ip) || { n: 0, ate: 0 };
  if (f.ate > Date.now()) { res.status(429).json({ erro: 'Demasiadas tentativas. Espera 1 minuto.' }); return false; }
  if (String((req.body || {}).pin || '') === PIN()) { falhas.delete(ip); return true; }
  f.n += 1;
  if (f.n >= 5) { f.n = 0; f.ate = Date.now() + 60000; }
  falhas.set(ip, f);
  res.status(401).json({ erro: 'Palavra-passe incorreta.' });
  return false;
}
app.post('/api/logistica/pin', (req, res) => { if (verificarPin(req, res)) res.json({ ok: true }); });

// --- Logística: colocar mesas (regista a OP e os dados de cada mesa para um dia de prova) ---
const PREFIXOS_OP = ['150', '151', '950'];
app.post('/api/logistica/colocar', async (req, res) => {
  try {
    const supervisora = (req.body || {}).pin !== undefined && (req.body || {}).pin !== null && (req.body || {}).pin !== '';
    if (supervisora && !verificarPin(req, res)) return;   // palavra-passe errada
    const { data, mesas, ordem, rolhasPorFrasco, totalFrascosCliente, contadeira, qvs, tipo, dsrol, frascosPartidos } = req.body || {};
    const hoje = plan.hojeLisboa();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '')) return res.status(400).json({ erro: 'Data inválida.' });
    if (new Date(data + 'T00:00:00Z').getUTCDay() % 6 === 0) return res.status(400).json({ erro: 'Escolhe um dia útil (segunda a sexta).' });
    if (data < hoje) return res.status(400).json({ erro: 'Não é possível colocar mesas para uma data passada.' });
    if (data === hoje && !supervisora) return res.status(401).json({ erro: 'Alterar as mesas de hoje (a meio do processo) só com a palavra-passe da supervisora.' });
    if (data !== plan.diaUtilSeguinte(hoje) && !(supervisora && data === hoje)) return res.status(400).json({ erro: `A data da prova é sempre o dia útil seguinte (${plan.diaUtilSeguinte(hoje)}).` });
    const op = String(ordem || '').trim();
    if (!/^\d{6,12}$/.test(op) || !PREFIXOS_OP.some((p) => op.startsWith(p))) {
      return res.status(400).json({ erro: 'Nº de ordem inválido: tem de ser só números e começar por 150, 151 ou 950.' });
    }
    if (![1, 2, 4].includes(Number(rolhasPorFrasco))) return res.status(400).json({ erro: 'Rolhas por frasco: escolhe 1, 2 ou 4.' });
    const total = Number(totalFrascosCliente);
    if (!Number.isInteger(total) || total < 1) return res.status(400).json({ erro: 'Indica o total de frascos/cliente.' });
    if (typeof contadeira !== 'boolean') return res.status(400).json({ erro: 'Indica se tem contadeira (sim ou não).' });
    if (!['EUR', 'GRUPO', 'AMOSTRA'].includes(String(tipo))) return res.status(400).json({ erro: 'Escolhe o tipo: EUR, GRUPO ou AMOSTRA.' });
    if (typeof dsrol !== 'boolean') return res.status(400).json({ erro: 'Indica DSROL (sim ou não).' });
    const partidos = frascosPartidos === undefined || frascosPartidos === null || frascosPartidos === '' ? 0 : Number(frascosPartidos);
    if (!Number.isInteger(partidos) || partidos < 0) return res.status(400).json({ erro: 'Frascos partidos: indica um número inteiro (0 ou mais).' });
    if (!Array.isArray(mesas) || !mesas.length) return res.status(400).json({ erro: 'Seleciona pelo menos uma mesa.' });
    const nProvadores = tipo === 'AMOSTRA' ? 3 : 2; // amostra = 3 provadores
    const lado = data === hoje ? await ladoHoje() : plan.ladoDoDia(data);
    const lista = [...new Set(mesas.map((m) => String(m).toUpperCase()))];
    for (const m of lista) {
      const n = Number(m.slice(1));
      if (m[0] !== lado) return res.status(400).json({ erro: `A mesa ${m} não é do lado ${lado}, que é o lado deste dia.` });
      if (!Number.isInteger(n) || n < 1 || n > plan.MESAS[lado]) return res.status(400).json({ erro: `Mesa inválida: ${m}.` });
    }
    const qn = qvs === undefined || qvs === null || qvs === '' ? 0 : Number(qvs);
    if (!Number.isInteger(qn) || qn < 0) return res.status(400).json({ erro: 'QVs: indica o nº de rolhas (número inteiro, 0 ou mais).' });
    const q = qn;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const m of lista) {
        await client.query(
          `INSERT INTO lotes (mesa, ordem, data_planeamento, numero_provadores, ativo, rolhas_por_frasco, total_frascos_cliente, contadeira, qvs_colocacao, tipo, dsrol, frascos_partidos)
           VALUES ($1,$2,$3,$8,true,$4,$5,$6,$7,$9,$10,$11)
           ON CONFLICT (mesa, data_planeamento) DO UPDATE SET ordem = EXCLUDED.ordem, ativo = true, numero_provadores = EXCLUDED.numero_provadores,
             rolhas_por_frasco = EXCLUDED.rolhas_por_frasco, total_frascos_cliente = EXCLUDED.total_frascos_cliente,
             contadeira = EXCLUDED.contadeira, qvs_colocacao = EXCLUDED.qvs_colocacao, tipo = EXCLUDED.tipo, dsrol = EXCLUDED.dsrol, frascos_partidos = EXCLUDED.frascos_partidos`,
          [m, op, data, Number(rolhasPorFrasco), total, contadeira, q, nProvadores, tipo, dsrol, partidos]);
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    res.json({ ok: true, mesas: lista.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao registar as mesas.' });
  }
});

// --- Logística: tirar mesas colocadas por engano (só dias futuros, ou hoje sem provas) ---
app.post('/api/logistica/remover', async (req, res) => {
  try {
    const supervisora = (req.body || {}).pin !== undefined && (req.body || {}).pin !== null && (req.body || {}).pin !== '';
    if (supervisora && !verificarPin(req, res)) return;
    const { data, mesas } = req.body || {};
    const hoje = plan.hojeLisboa();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '') || !Array.isArray(mesas) || !mesas.length) return res.status(400).json({ erro: 'Pedido inválido.' });
    if (data < hoje) return res.status(400).json({ erro: 'Não é possível alterar uma data passada.' });
    if (data === hoje && !supervisora) return res.status(401).json({ erro: 'Alterar as mesas de hoje só com a palavra-passe da supervisora.' });
    if (data === hoje) {
      const r = await pool.query(`SELECT 1 FROM registos WHERE mesa = ANY($1) AND hora_abertura >= CURRENT_DATE LIMIT 1`, [mesas.map((m) => String(m).toUpperCase())]);
      if (r.rowCount) return res.status(409).json({ erro: 'Já há provas registadas nestas mesas hoje.' });
    }
    await pool.query(`DELETE FROM lotes WHERE data_planeamento = $1 AND mesa = ANY($2)`, [data, mesas.map((m) => String(m).toUpperCase())]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao remover as mesas.' });
  }
});

// ===================== Levantamento: MISU, Contadeira, Logística =====================
// Lista os lotes de hoje com o estado das provas e os valores já apontados (e os derivados).
async function lotesDeHoje() {
  const hoje = plan.hojeLisboa();
  const lotes = await pool.query(`SELECT * FROM lotes WHERE data_planeamento = $1 AND ativo = true`, [hoje]);
  const feitos = await pool.query(
    `SELECT mesa, COUNT(DISTINCT aprovador)::int AS n FROM registos
     WHERE estado = 'Fechado' AND hora_fecho >= CURRENT_DATE AND hora_fecho < CURRENT_DATE + 1 GROUP BY mesa`);
  const abertos = await pool.query(`SELECT mesa FROM registos WHERE estado = 'Aberto'`);
  const nFeitos = new Map(feitos.rows.map((r) => [r.mesa, r.n]));
  const emAnalise = new Set(abertos.rows.map((r) => r.mesa));
  const num = (m) => parseInt(m.slice(1), 10);
  return lotes.rows
    .sort((a, b) => a.mesa[0].localeCompare(b.mesa[0]) || num(a.mesa) - num(b.mesa))
    .map((l) => {
      const f = nFeitos.get(l.mesa) || 0;
      let estadoProva = 'em_prova';
      if (l.levantada_em) estadoProva = 'levantada';
      else if (f >= l.numero_provadores && !emAnalise.has(l.mesa)) estadoProva = 'pronta';
      return { l, f, estadoProva };
    });
}
async function contagensDeHoje() {
  const r = await pool.query(`SELECT op, ligeiros, fortes, aprovadas, em FROM contagens_op WHERE data = $1`, [plan.hojeLisboa()]);
  return new Map(r.rows.map((c) => [c.op, c]));
}
function formatarLote({ l, f, estadoProva }, contagens) {
  const d = derivar(l);
  const m = {
    mesa: l.mesa, ordem: l.ordem, tipo: l.tipo, dsrol: l.dsrol, estadoProva,
    feitos: f, necessarios: l.numero_provadores, ...d, misuEm: l.misu_em, logEm: l.log_em, ops: opsDoLote(l.ordem),
    fase: estadoProva === 'levantada' ? 'levantada' : estadoProva !== 'pronta' ? 'em_prova' : d.misuEstado === 'pendente' ? 'misu' : 'logistica',
  };
  if (l.contadeira === true) {
    // contagem da contadeira, por OP (é o valor da OP inteira, não da mesa)
    m.contagensOp = m.ops.map((op) => {
      const c = (contagens && contagens.get(op)) || {};
      return { op, aprovadas: c.aprovadas ?? null };
    });
    m.contadeiraPendente = m.contagensOp.some((c) => c.aprovadas === null);
  }
  return m;
}
function juntarConfere(ms, contagens) {
  const ops = agregarOps(ms, contagens);
  ms.forEach((m) => { m.desvio = desvioColocacao(m, ops); });
  return ms;
}
app.get('/api/levantamento', async (req, res) => {
  try {
    const lista = await lotesDeHoje();
    const contagens = await contagensDeHoje();
    const mesas = juntarConfere(lista.map((x) => formatarLote(x, contagens)), contagens);
    res.json({ data: plan.hojeLisboa(), mesas, ops: agregarOps(mesas, contagens) });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao obter o levantamento.' }); }
});

const inteiro = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v));
const invalido = (v) => v !== undefined && (!Number.isInteger(v) || v < 0);
async function carregarPronta(mesa, res, permitirLevantada) {
  const lista = await lotesDeHoje();
  const x = lista.find((i) => i.l.mesa === String(mesa).toUpperCase());
  if (!x) { res.status(404).json({ erro: 'Esta mesa não tem lote hoje.' }); return null; }
  if (x.estadoProva !== 'pronta' && !(permitirLevantada && x.estadoProva === 'levantada')) {
    res.status(409).json({ erro: 'A mesa ainda não está concluída pelos provadores.' }); return null;
  }
  return x.l;
}

// MISU: levanta os frascos dos contaminados (aroma ligeiro e forte) e aponta as rolhas.
// Se a mesa vai à contadeira, só aponta as QVs e passa a responsabilidade (hand off) à contadeira.
app.post('/api/misu/:mesa', async (req, res) => {
  try {
    const l = await carregarPronta(req.params.mesa, res, true);
    if (!l) return;
    let lig = inteiro(req.body.ligeiros); const fort = inteiro(req.body.fortes), qvs = inteiro(req.body.qvs);
    if (invalido(lig) || invalido(fort) || invalido(qvs)) return res.status(400).json({ erro: 'Indica números inteiros (0 ou mais).' });
    const d = derivar(l);
    const cont = l.contadeira === true;
    // cut off: depois de entregue à contadeira, o MISU já não mexe na mesa
    if (l.contadeira === true && l.misu_em) return res.status(409).json({ erro: 'Esta mesa já foi entregue à contadeira. A responsabilidade passou para a contadeira.' });
    // o MISU aponta SEMPRE as rolhas de aroma ligeiro e forte antes de a mesa seguir (para a contadeira ou para a logística)
    // com contadeira o MISU só conta aromas FORTES (os ligeiros ficam para a contadeira); sem contadeira conta ligeiros e fortes
    if (cont ? fort === undefined : (lig === undefined || fort === undefined)) return res.status(400).json({ erro: cont ? 'Aponta as rolhas de aroma forte antes de entregar à contadeira.' : 'Aponta as rolhas de aroma ligeiro e de aroma forte antes de continuar.' });
    if (cont) lig = 0;
    if (d.totalRolhas !== null && lig + fort + (d.rolhasPartidas || 0) > d.totalRolhas) return res.status(400).json({ erro: `Ligeiras + fortes (${lig + fort}) + partidas (${d.rolhasPartidas || 0}) é mais do que o total da mesa (${d.totalRolhas}).` });
    await pool.query(`UPDATE lotes SET misu_ligeiros = $1, misu_fortes = $2, misu_qvs = $3, misu_em = now() WHERE id = $4`, [lig, fort, qvs ?? 0, l.id]);
    const x = (await lotesDeHoje()).find((i) => i.l.id === l.id);
    res.json({ ok: true, mesa: formatarLote(x, await contagensDeHoje()) });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao registar o levantamento do MISU.' }); }
});

// Contadeira: trabalha à OP (não à mesa). Aponta o valor que a máquina contou para a OP inteira.
// Só entra depois de o MISU ter entregado TODAS as mesas dessa OP que vão à contadeira (cut off de responsabilidade).
app.post('/api/contadeira/op/:op', async (req, res) => {
  try {
    const op = String(req.params.op).trim();
    const lista = (await lotesDeHoje()).filter((x) => x.l.contadeira === true && opsDoLote(x.l.ordem).includes(op));
    if (!lista.length) return res.status(404).json({ erro: 'Esta OP não tem mesas que vão à contadeira hoje.' });
    if (lista.some((x) => x.estadoProva === 'em_prova')) return res.status(409).json({ erro: 'Há mesas desta OP ainda não concluídas pelos provadores.' });
    if (lista.some((x) => !x.l.misu_em)) return res.status(409).json({ erro: 'O MISU ainda não entregou todas as mesas desta OP à contadeira.' });
    const apr = inteiro(req.body.aprovadas);
    if (apr === undefined || invalido(apr)) return res.status(400).json({ erro: 'Indica as rolhas aprovadas contadas pela máquina (número inteiro, 0 ou mais).' });
    const partilhada = lista.some((x) => opsDoLote(x.l.ordem).length > 1);
    const total = lista.reduce((t, x) => t + (derivar(x.l).totalRolhas || 0), 0);
    const contaminados = lista.reduce((t, x) => t + (Number(x.l.misu_ligeiros) || 0) + (Number(x.l.misu_fortes) || 0), 0);
    const partidas = lista.reduce((t, x) => t + (derivar(x.l).rolhasPartidas || 0), 0);
    if (!partilhada && total && apr + contaminados + partidas > total) {
      return res.status(400).json({ erro: `Aprovadas (${apr}) + contaminadas do MISU (${contaminados}) + partidas (${partidas}) é mais do que o total da OP (${total}).` });
    }
    await pool.query(
      `INSERT INTO contagens_op (op, data, aprovadas, em) VALUES ($1,$2,$3,now())
       ON CONFLICT (op, data) DO UPDATE SET aprovadas = $3, em = now()`,
      [op, plan.hojeLisboa(), apr]);
    const contagens = await contagensDeHoje();
    const mesas = (await lotesDeHoje()).map((x) => formatarLote(x, contagens));
    res.json({ ok: true, op: agregarOps(mesas, contagens).find((o) => o.op === op) });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao registar o valor da contadeira.' }); }
});

// Logística: aponta as QVs (qualidade visual) das rolhas aprovadas. A soma junta colocação + MISU + logística.
app.post('/api/logistica/qvs/:mesa', async (req, res) => {
  try {
    const l = await carregarPronta(req.params.mesa, res, true);
    if (!l) return;
    const qvs = inteiro(req.body.qvs);
    if (qvs === undefined || invalido(qvs)) return res.status(400).json({ erro: 'Indica as QVs (nº de rolhas, número inteiro).' });
    await pool.query(`UPDATE lotes SET log_qvs = $1, log_em = now() WHERE id = $2`, [qvs, l.id]);
    const x = (await lotesDeHoje()).find((i) => i.l.id === l.id);
    res.json({ ok: true, mesa: formatarLote(x, await contagensDeHoje()) });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao registar as QVs.' }); }
});

// --- Supervisora: limpar todos os dados de teste (começar do zero) ---
app.post('/api/supervisora/reset', async (req, res) => {
  try {
    if (!verificarPin(req, res)) return;
    if ((req.body || {}).confirmar !== 'APAGAR') return res.status(400).json({ erro: 'Falta a confirmação.' });
    await pool.query('DELETE FROM registos');
    await pool.query('DELETE FROM contagens_op');
    await pool.query('DELETE FROM lotes');
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao limpar os dados.' }); }
});

// --- Supervisora: alterar uma mesa de hoje a meio do processo (só com a palavra-passe) ---
// Permite corrigir a colocação, o que o MISU apontou, as QVs da logística e o valor da contadeira (por OP).
app.post('/api/supervisora/mesa/:mesa', async (req, res) => {
  try {
    if (!verificarPin(req, res)) return;
    const mesa = String(req.params.mesa).toUpperCase();
    const hoje = plan.hojeLisboa();
    const r = await pool.query(`SELECT * FROM lotes WHERE mesa = $1 AND data_planeamento = $2 AND ativo = true`, [mesa, hoje]);
    if (!r.rowCount) return res.status(404).json({ erro: 'Esta mesa não tem lote hoje.' });
    const l = r.rows[0];
    const b = req.body || {};
    const sets = [], vals = [];
    const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    const nao = (v) => v === undefined;
    const int0 = (v) => Number.isInteger(Number(v)) && Number(v) >= 0 && v !== '' && v !== null;

    if (!nao(b.ordem)) {
      const ops = opsDoLote(b.ordem);
      if (!ops.length || ops.some((o) => !/^\d{6,12}$/.test(o) || !PREFIXOS_OP.some((p) => o.startsWith(p)))) return res.status(400).json({ erro: 'Nº de ordem inválido: só números e a começar por 150, 151 ou 950.' });
      set('ordem', ops.join(' + '));
    }
    if (!nao(b.tipo)) {
      if (!['EUR', 'GRUPO', 'AMOSTRA'].includes(String(b.tipo))) return res.status(400).json({ erro: 'Tipo: EUR, GRUPO ou AMOSTRA.' });
      set('tipo', b.tipo); set('numero_provadores', b.tipo === 'AMOSTRA' ? 3 : 2);
    }
    if (!nao(b.rolhasPorFrasco)) { if (![1, 2, 4].includes(Number(b.rolhasPorFrasco))) return res.status(400).json({ erro: 'Rolhas por frasco: 1, 2 ou 4.' }); set('rolhas_por_frasco', Number(b.rolhasPorFrasco)); }
    if (!nao(b.totalFrascosCliente)) { if (!int0(b.totalFrascosCliente) || Number(b.totalFrascosCliente) < 1) return res.status(400).json({ erro: 'Total de frascos/cliente inválido.' }); set('total_frascos_cliente', Number(b.totalFrascosCliente)); }
    if (!nao(b.contadeira)) { if (typeof b.contadeira !== 'boolean') return res.status(400).json({ erro: 'Contadeira: sim ou não.' }); set('contadeira', b.contadeira); }
    if (!nao(b.dsrol)) { if (typeof b.dsrol !== 'boolean') return res.status(400).json({ erro: 'DSROL: sim ou não.' }); set('dsrol', b.dsrol); }
    if (!nao(b.frascosPartidos)) { if (!int0(b.frascosPartidos)) return res.status(400).json({ erro: 'Frascos partidos: número inteiro (0 ou mais).' }); set('frascos_partidos', Number(b.frascosPartidos)); }
    if (!nao(b.qvsColocacao)) { if (!int0(b.qvsColocacao)) return res.status(400).json({ erro: 'QVs da colocação: número inteiro (0 ou mais).' }); set('qvs_colocacao', Number(b.qvsColocacao)); }
    const m = b.misu || {};
    for (const [k, col] of [['ligeiros', 'misu_ligeiros'], ['fortes', 'misu_fortes'], ['qvs', 'misu_qvs']]) {
      if (!nao(m[k]) && m[k] !== null) { if (!int0(m[k])) return res.status(400).json({ erro: `MISU (${k}): número inteiro (0 ou mais).` }); set(col, Number(m[k])); }
    }
    if (!nao(b.logQvs) && b.logQvs !== null) { if (!int0(b.logQvs)) return res.status(400).json({ erro: 'QVs da logística: número inteiro (0 ou mais).' }); set('log_qvs', Number(b.logQvs)); }

    // coerência: ligeiras + fortes não pode passar o total da mesa (com os valores já corrigidos)
    const novo = { ...l };
    sets.forEach((x, i) => { novo[x.split(' = ')[0]] = vals[i]; });
    const dn = derivar(novo);
    if (dn.totalRolhas !== null && dn.ligeiros !== null && dn.fortes !== null && dn.ligeiros + dn.fortes + (dn.rolhasPartidas || 0) > dn.totalRolhas) {
      return res.status(400).json({ erro: `Ligeiras + fortes (${dn.ligeiros + dn.fortes}) + partidas (${dn.rolhasPartidas || 0}) é mais do que o total da mesa (${dn.totalRolhas}).` });
    }
    if (sets.length) {
      vals.push(l.id);
      await pool.query(`UPDATE lotes SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    }
    // valor da contadeira (por OP)
    const cts = b.contagens || {};
    for (const op of Object.keys(cts)) {
      if (!opsDoLote(novo.ordem).includes(op)) return res.status(400).json({ erro: `A OP ${op} não está nesta mesa.` });
      if (cts[op] === null || cts[op] === '') continue;
      if (!int0(cts[op])) return res.status(400).json({ erro: `Contadeira (OP ${op}): número inteiro (0 ou mais).` });
      await pool.query(
        `INSERT INTO contagens_op (op, data, aprovadas, em) VALUES ($1,$2,$3,now())
         ON CONFLICT (op, data) DO UPDATE SET aprovadas = $3, em = now()`, [op, hoje, Number(cts[op])]);
    }
    const contagens = await contagensDeHoje();
    const x = (await lotesDeHoje()).find((i) => i.l.id === l.id);
    res.json({ ok: true, mesa: formatarLote(x, contagens) });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao alterar a mesa.' }); }
});

app.get('/api/saude', (req, res) => res.json({ ok: true }));

const fs = require('fs');
const path2 = require('path');

async function migrarEArrancar() {
  try {
    const sql = fs.readFileSync(path2.join(__dirname, 'migrations', 'schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('Migração/seed aplicados.');
  } catch (err) {
    console.error('Aviso: falha ao aplicar migração automática:', err.message);
  }
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`DS100 app a correr na porta ${PORT}`));
}

migrarEArrancar();
