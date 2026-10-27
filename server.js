const express = require('express');
const path = require('path');
const pool = require('./db');
const { obterEstadoMesa, ladoHoje } = require('./logic');
const { derivar, opsDoLote, agregarOps } = require('./levantamento');
const plan = require('./planeamento');

const app = express();
app.use(express.json());

// --- Histórico: guarda TODOS os movimentos (escritas) da aplicação na tabela `movimentos` ---
const ACOES = [
  [/^\/api\/mesa\/([^/]+)\/abrir$/, 'prova_aberta'],
  [/^\/api\/registo\/(\d+)\/concluir$/, 'prova_concluida'],
  [/^\/api\/logistica\/colocar$/, 'colocacao_mesas'],
  [/^\/api\/logistica\/remover$/, 'remocao_mesas'],
  [/^\/api\/logistica\/levantar$/, 'levantamento_mesa'],
  [/^\/api\/logistica\/ordem\/levantar$/, 'levantamento_ordem'],
  [/^\/api\/logistica\/ordem\/qvs$/, 'qvs_ordem'],
  [/^\/api\/supervisora\/ordem-resultado$/, 'decisao_ordem'],
  [/^\/api\/logistica\/qvs\/([^/]+)$/, 'qvs_logistica'],
  [/^\/api\/misu\/([^/]+)$/, 'misu'],
  [/^\/api\/contadeira\/op\/([^/]+)$/, 'contadeira'],
  [/^\/api\/supervisora\/mesa\/([^/]+)$/, 'edicao_supervisora'],
  [/^\/api\/supervisora\/reset$/, 'limpeza_dados_teste'],
  [/^\/api\/supervisora\/ordem-valores$/, 'edicao_valores_ordem'],
  [/^\/api\/supervisora\/fechar-provas$/, 'fecho_provas_lote'],
  [/^\/api\/supervisora\/versoes\/restaurar$/, 'restauro_versao'],
  [/^\/api\/supervisora\/dias-extra$/, 'edicao_dias_uteis'],
  [/^\/api\/supervisora\/seed-teste$/, 'carregar_ordens_teste'],
  [/^\/api\/supervisora\/provadores$/, 'edicao_provadores'],
  [/^\/api\/supervisora\/registo\/(\d+)$/, 'edicao_prova_mesa'],
  [/^\/api\/supervisora\/ordem$/, 'edicao_ordem'],
  [/^\/api\/logistica\/ordem\/confirmar$/, 'colocacao_ordem'],
  [/^\/api\/logistica\/ordem\/remover$/, 'remocao_ordem'],
  [/^\/api\/lotes$/, 'lote_manual'],
  [/^\/api\/planeamento\/confirmar$/, 'planeamento_confirmado'],
];
const SEM_PIN = (o) => { if (!o || typeof o !== 'object' || Buffer.isBuffer(o)) return null; const c = { ...o }; delete c.pin; return JSON.stringify(c).slice(0, 4000); };
// --- Versões: cópia dos dados antes de alterações importantes (e, no máximo, de 15 em 15 min nas restantes) ---
const TAB_VERSAO = ['aprovadores', 'lotes', 'registos', 'contagens_op', 'lote_ops', 'dias_extra', 'ordens', 'ordens_dia'];
const MOTIVOS = { colocacao_ordem: 'colocação de ordem', remocao_ordem: 'ordem retirada', levantamento_ordem: 'levantamento de ordem', misu: 'MISU', contadeira: 'contadeira', decisao_ordem: 'decisão da supervisora', edicao_supervisora: 'edição da supervisora', edicao_ordem: 'edição de ordem', edicao_prova_mesa: 'edição de provas', edicao_provadores: 'edição de provadores', edicao_dias_uteis: 'dias de trabalho', limpeza_dados_teste: 'limpeza de dados', carregar_ordens_teste: 'carga de ordens', restauro_versao: 'restauro de versão', edicao_valores_ordem: 'edição de valores da ordem', fecho_provas_lote: 'fecho de provas em lote' };
const FORTES = new Set(['edicao_valores_ordem', 'fecho_provas_lote', 'limpeza_dados_teste', 'carregar_ordens_teste', 'restauro_versao', 'edicao_supervisora', 'edicao_ordem', 'edicao_prova_mesa', 'edicao_provadores', 'decisao_ordem', 'edicao_dias_uteis', 'remocao_ordem', 'remocao_mesas']);
async function guardarVersao(motivo, cli) {
  const q = cli || pool;
  const dados = {};
  for (const t of TAB_VERSAO) dados[t] = (await q.query(`SELECT COALESCE(json_agg(t), '[]'::json) AS j FROM ${t} t`)).rows[0].j;
  const resumo = `${dados.ordens.length} ordens · ${dados.lotes.length} mesas · ${dados.registos.length} provas`;
  await q.query(`INSERT INTO versoes (motivo, resumo, dados) VALUES ($1,$2,$3)`, [motivo, resumo, JSON.stringify(dados)]);
  await q.query(`DELETE FROM versoes WHERE id NOT IN (SELECT id FROM versoes ORDER BY id DESC LIMIT 60)`);
}
app.use(async (req, res, next) => {
  if (req.method !== 'POST' || !req.path.startsWith('/api/')) return next();
  const alvo = ACOES.find(([re]) => re.test(req.path));
  if (!alvo) return next();
  if (alvo[1] !== 'prova_aberta' && alvo[1] !== 'prova_concluida') {
    try {
      const rec = (await pool.query(`SELECT 1 FROM versoes WHERE criado > now() - interval '15 minutes' LIMIT 1`)).rowCount > 0;
      if (FORTES.has(alvo[1]) || !rec) await guardarVersao('antes de: ' + (MOTIVOS[alvo[1]] || alvo[1]));
    } catch (e) { console.error('Falha a guardar versão:', e.message); }
  }
  let resposta = null;
  const j = res.json.bind(res);
  res.json = (o) => { resposta = o; return j(o); };
  res.on('finish', () => {
    const b = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : {};
    const g = req.path.match(alvo[0]) || [];
    const mesa = b.mesa || (Array.isArray(b.mesas) ? b.mesas.join(',') : null) || (['misu', 'qvs_logistica', 'edicao_supervisora'].includes(alvo[1]) ? g[1] : null) || (alvo[1] === 'prova_aberta' ? g[1] : null);
    const op = b.ordem || b.op || (alvo[1] === 'contadeira' ? g[1] : null);
    const quem = b.aprovador || b.nome || (b.pin ? 'supervisora' : null);
    pool.query(
      `INSERT INTO movimentos (acao, mesa, op, utilizador, metodo, caminho, status, ip, pedido, resposta) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [alvo[1], mesa ? String(mesa).slice(0, 200) : null, op ? String(op).slice(0, 100) : null, quem, req.method, req.path, res.statusCode, req.ip || null,
        SEM_PIN(b), resposta ? JSON.stringify(resposta).slice(0, 4000) : null]
    ).catch((e) => console.error('Falha a guardar movimento:', e.message));
  });
  next();
});
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
      `SELECT mesa, MAX(hora_fecho) AS fecho, to_char(MAX(hora_fecho) AT TIME ZONE 'Europe/Lisbon', 'HH24:MI') AS hora
       FROM registos
       WHERE aprovador = $1 AND estado = 'Fechado'
         AND hora_fecho >= ((now() AT TIME ZONE 'Europe/Lisbon')::date::timestamp AT TIME ZONE 'Europe/Lisbon')
         AND hora_fecho < (((now() AT TIME ZONE 'Europe/Lisbon')::date + 1)::timestamp AT TIME ZONE 'Europe/Lisbon')
       GROUP BY mesa ORDER BY MAX(hora_fecho) DESC`,
      [nome]
    );
    res.json({ mesas: r.rows.length, lista: r.rows.map((x) => ({ mesa: x.mesa, hora: x.hora })) });
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
  if (!plan.ehDiaUtil(dataProva)) return res.status(400).json({ erro: 'Escolhe um dia útil (segunda a sexta).' });
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
      `SELECT mesa, ordem, numero_provadores, levantada_em, rolhas_por_frasco, total_frascos_cliente, contadeira, qvs_colocacao, tipo, dsrol, frascos_partidos, misu_ligeiros, misu_fortes, total_rolhas, rolhas_partidas_total FROM lotes
       WHERE data_planeamento = $1 AND ativo = true`, [data]);
    const lado = data === plan.hojeLisboa() ? await ladoHoje() : plan.ladoDoDia(data);
    const feitos = await pool.query(
      `SELECT mesa, COUNT(DISTINCT aprovador)::int AS n FROM registos
       WHERE estado = 'Fechado' AND hora_fecho >= ((now() AT TIME ZONE 'Europe/Lisbon')::date::timestamp AT TIME ZONE 'Europe/Lisbon') AND hora_fecho < (((now() AT TIME ZONE 'Europe/Lisbon')::date + 1)::timestamp AT TIME ZONE 'Europe/Lisbon')
       GROUP BY mesa`);
    const abertos = await pool.query(`SELECT mesa FROM registos WHERE estado = 'Aberto'`);
    const nFeitos = new Map(feitos.rows.map((r) => [r.mesa, r.n]));
    const emAnalise = new Set(abertos.rows.map((r) => r.mesa));
    const porMesa = new Map(lotes.rows.map((l) => [l.mesa, l]));
    const sgs = await pool.query(`SELECT * FROM lote_ops WHERE data = $1 ORDER BY de`, [data]);
    const infoOp = await infoOrdensDia(data);
    const sgPorMesa = new Map();
    sgs.rows.forEach((s) => { if (!sgPorMesa.has(s.mesa)) sgPorMesa.set(s.mesa, []); sgPorMesa.get(s.mesa).push({ ...segFormatado(s), ...(infoOp.get(s.op) || {}) }); });
    lotes.rows.forEach((l) => { l._segs = sgPorMesa.get(l.mesa) || []; });
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
        capacidade: plan.LAYOUT[lado].cap[String(i)] || 0, ocupado: Math.max(0, ...(sgPorMesa.get(codigo) || []).map((s) => s.ate)),
        segmentos: sgPorMesa.get(codigo) || [],
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
  const opsCont = (m.segmentos || []).length ? m.segmentos.filter((s) => s.contadeira).map((s) => s.op) : m.ops;
  for (const op of opsCont) {
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
    if ((await pool.query(`SELECT 1 FROM lote_ops WHERE data = $1 AND mesa = $2 LIMIT 1`, [data, String(mesa).toUpperCase()])).rowCount) return res.status(409).json({ erro: 'Esta mesa tem ordens: o levantamento faz-se pela ORDEM (vista Ordens).' });
    if (!desfazer) {
      const f = await pool.query(
        `SELECT COUNT(DISTINCT aprovador)::int AS n FROM registos
         WHERE mesa = $1 AND estado = 'Fechado' AND hora_fecho >= ((now() AT TIME ZONE 'Europe/Lisbon')::date::timestamp AT TIME ZONE 'Europe/Lisbon') AND hora_fecho < (((now() AT TIME ZONE 'Europe/Lisbon')::date + 1)::timestamp AT TIME ZONE 'Europe/Lisbon')`, [mesa]);
      const l = await pool.query(
        `SELECT * FROM lotes WHERE mesa = $1 AND data_planeamento = $2 AND ativo = true`, [mesa, data]);
      if (!l.rowCount) return res.status(409).json({ erro: 'Mesa sem lote hoje.' });
      if (f.rows[0].n < l.rows[0].numero_provadores) return res.status(409).json({ erro: 'Mesa ainda não está concluída pelos provadores.' });
      {
        const lista = await lotesDeHoje();
        const contagens = await contagensDeHoje();
        const ms = lista.map((x) => formatarLote(x, contagens));
        const mm = ms.find((x) => x.mesa === mesa);
        if (mm && mm.misuEstado === 'pendente') return res.status(409).json({ erro: 'Os contaminados andam sempre à frente: o MISU ainda não levantou os contaminados desta mesa.' });
        const desvio = mm && desvioColocacao(mm, agregarOps(ms, contagens));
        if (desvio) return res.status(409).json({ erro: desvio });
      }
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
const pinOk = (req) => String((req.body || {}).pin || '') === PIN();
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
    if (!plan.ehDiaUtil(data)) return res.status(400).json({ erro: 'Escolhe um dia útil (segunda a sexta).' });
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

// ===================== Colocação POR ORDEM (várias ordens podem partilhar uma mesa) =====================
const { alocar } = require('./colocacao');

async function recalcularLote(client, data, mesa) {
  const r = await client.query(`SELECT * FROM lote_ops WHERE data = $1 AND mesa = $2 ORDER BY de`, [data, mesa]);
  if (!r.rowCount) {
    await client.query(`DELETE FROM lotes WHERE data_planeamento = $1 AND mesa = $2`, [data, mesa]);
    return;
  }
  const g = r.rows;
  const soma = (f) => g.reduce((t, x) => t + f(x), 0);
  const rolhas = [...new Set(g.map((x) => x.rolhas_por_frasco))];
  const amostra = g.some((x) => x.tipo === 'AMOSTRA');
  await client.query(
    `INSERT INTO lotes (mesa, ordem, data_planeamento, numero_provadores, ativo, rolhas_por_frasco, total_frascos_cliente, contadeira, qvs_colocacao, tipo, dsrol, frascos_partidos, total_rolhas, rolhas_partidas_total)
     VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (mesa, data_planeamento) DO UPDATE SET ordem = EXCLUDED.ordem, ativo = true, numero_provadores = EXCLUDED.numero_provadores,
       rolhas_por_frasco = EXCLUDED.rolhas_por_frasco, total_frascos_cliente = EXCLUDED.total_frascos_cliente, contadeira = EXCLUDED.contadeira,
       qvs_colocacao = EXCLUDED.qvs_colocacao, tipo = EXCLUDED.tipo, dsrol = EXCLUDED.dsrol, frascos_partidos = EXCLUDED.frascos_partidos,
       total_rolhas = EXCLUDED.total_rolhas, rolhas_partidas_total = EXCLUDED.rolhas_partidas_total`,
    [mesa, g.map((x) => x.op).join(' + '), data, amostra ? 3 : 2, Math.max(...rolhas), soma((x) => x.frascos), g.some((x) => x.contadeira),
      soma((x) => x.qvs), amostra ? 'AMOSTRA' : g[0].tipo, g.some((x) => x.dsrol), soma((x) => x.frascos_partidos),
      soma((x) => x.frascos * x.rolhas_por_frasco), soma((x) => (x.rolhas_partidas !== null && x.rolhas_partidas !== undefined ? x.rolhas_partidas : x.frascos_partidos * x.rolhas_por_frasco))]);
}

// valida o dia (mesma regra da colocação por mesas): amanhã é livre; hoje (a meio do processo) só com a palavra-passe da supervisora
async function contextoColocacao(req, res) {
  const b = req.body || {};
  const supervisora = b.pin !== undefined && b.pin !== null && b.pin !== '';
  if (supervisora && !verificarPin(req, res)) return null;
  const hoje = plan.hojeLisboa();
  const data = b.data;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '')) { res.status(400).json({ erro: 'Data inválida.' }); return null; }
  if (!plan.ehDiaUtil(data)) { res.status(400).json({ erro: 'Escolhe um dia útil (segunda a sexta).' }); return null; }
  if (data < hoje) { res.status(400).json({ erro: 'Não é possível colocar para uma data passada.' }); return null; }
  if (data === hoje && !supervisora) { res.status(401).json({ erro: 'Alterar as mesas de hoje (a meio do processo) só com a palavra-passe da supervisora.' }); return null; }
  if (data !== plan.diaUtilSeguinte(hoje) && !(supervisora && data === hoje)) { res.status(400).json({ erro: `A data da prova é sempre o dia útil seguinte (${plan.diaUtilSeguinte(hoje)}).` }); return null; }
  const lado = data === hoje ? await ladoHoje() : plan.ladoDoDia(data);
  return { data, hoje, lado };
}
function lerOrdem(b, res) {
  const op = String(b.ordem || '').trim();
  if (!/^\d{6,12}$/.test(op) || !PREFIXOS_OP.some((p) => op.startsWith(p))) { res.status(400).json({ erro: 'Nº de ordem inválido: tem de ser só números e começar por 150, 151 ou 950.' }); return null; }
  if (![1, 2, 4].includes(Number(b.rolhasPorFrasco))) { res.status(400).json({ erro: 'Rolhas por frasco: escolhe 1, 2 ou 4.' }); return null; }
  const frascos = Number(b.frascos);
  if (!Number.isInteger(frascos) || frascos < 1) { res.status(400).json({ erro: 'Indica a quantidade de frascos da ordem.' }); return null; }
  return { op, frascos, rolhas: Number(b.rolhasPorFrasco) };
}
async function planoDaOrdem(data, lado, op, frascos) {
  const ja = await pool.query(`SELECT 1 FROM lote_ops WHERE data = $1 AND op = $2 LIMIT 1`, [data, op]);
  if (ja.rowCount) return { erro: `A ordem ${op} já está colocada neste dia. Tira-a primeiro para a colocar de novo.` };
  const oc = await pool.query(`SELECT mesa, MAX(ate)::int AS ate FROM lote_ops WHERE data = $1 GROUP BY mesa`, [data]);
  const ocupacao = new Map(oc.rows.filter((r) => r.mesa[0] === lado).map((r) => [Number(r.mesa.slice(1)), r.ate]));
  const a = alocar(lado, ocupacao, frascos);
  return a;
}
app.post('/api/logistica/ordem/proposta', async (req, res) => {
  try {
    const ctx = await contextoColocacao(req, res); if (!ctx) return;
    const o = lerOrdem(req.body || {}, res); if (!o) return;
    const a = await planoDaOrdem(ctx.data, ctx.lado, o.op, o.frascos);
    if (a.erro) return res.status(409).json({ erro: a.erro });
    // identificação da ordem na mesa: A7-1, A7-2, ... (a mesa vai ter mais do que uma ordem quando já tem alguma)
    const ja = await pool.query(`SELECT mesa, COUNT(*)::int AS n, COALESCE(MAX(seq), COUNT(*))::int AS m FROM lote_ops WHERE data = $1 GROUP BY mesa`, [ctx.data]);
    const jaPor = new Map(ja.rows.map((x) => [x.mesa, x]));
    res.json({ lado: ctx.lado, data: ctx.data, op: o.op, frascos: o.frascos, rolhasPorFrasco: o.rolhas, totalRolhas: o.frascos * o.rolhas,
      semCapacidade: a.semCapacidade, segmentos: a.segmentos.map((s) => ({ ...s, rolhas: s.frascos * o.rolhas, seq: (jaPor.get(s.mesa)?.m || 0) + 1, jaTem: jaPor.get(s.mesa)?.n || 0 })) });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao calcular as mesas.' }); }
});
app.post('/api/logistica/ordem/confirmar', async (req, res) => {
  try {
    const ctx = await contextoColocacao(req, res); if (!ctx) return;
    const b = req.body || {};
    const o = lerOrdem(b, res); if (!o) return;
    if (!['EUR', 'GRUPO', 'AMOSTRA'].includes(String(b.tipo))) return res.status(400).json({ erro: 'Escolhe o tipo: EUR, GRUPO ou AMOSTRA.' });
    if (typeof b.contadeira !== 'boolean') return res.status(400).json({ erro: 'Indica se tem contadeira (sim ou não).' });
    if (typeof b.dsrol !== 'boolean') return res.status(400).json({ erro: 'Indica DSROL (sim ou não).' });
    if (typeof b.continua !== 'boolean') return res.status(400).json({ erro: 'Indica se a ordem continua amanhã (sim ou não).' });
    const encomenda = Number(b.encomenda);
    if (!Number.isInteger(encomenda) || encomenda < 1) return res.status(400).json({ erro: 'Indica a quantidade encomendada (nº de rolhas).' });
    const a = await planoDaOrdem(ctx.data, ctx.lado, o.op, o.frascos);
    if (a.erro) return res.status(409).json({ erro: a.erro });
    if (a.semCapacidade > 0) return res.status(400).json({ erro: `Não há mesas livres suficientes no lado ${ctx.lado}: faltam espaço para ${a.semCapacidade} frascos.` });
    // frascos partidos e QVs por mesa (a logística indica-os na proposta)
    const dist = new Map((Array.isArray(b.distribuicao) ? b.distribuicao : []).map((d) => [String(d.mesa).toUpperCase(), d]));
    for (const s of a.segmentos) {
      const d = dist.get(s.mesa) || {};
      const part = d.partidos === undefined || d.partidos === '' || d.partidos === null ? 0 : Number(d.partidos);
      const qv = d.qvs === undefined || d.qvs === '' || d.qvs === null ? 0 : Number(d.qvs);
      if (!Number.isInteger(part) || part < 0 || part > s.frascos) return res.status(400).json({ erro: `Frascos partidos da mesa ${s.mesa}: número inteiro entre 0 e ${s.frascos}.` });
      if (!Number.isInteger(qv) || qv < 0) return res.status(400).json({ erro: `QVs da mesa ${s.mesa}: número inteiro (0 ou mais).` });
      const rp = d.rolhasPartidas === undefined || d.rolhasPartidas === '' || d.rolhasPartidas === null ? null : Number(d.rolhasPartidas);
      if (rp !== null && (!Number.isInteger(rp) || rp < 0 || rp > s.frascos * o.rolhas)) return res.status(400).json({ erro: `Rolhas partidas da mesa ${s.mesa}: número inteiro entre 0 e ${s.frascos * o.rolhas}.` });
      s.partidos = part; s.qvs = qv; s.rolhasPart = rp;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const s of a.segmentos) {
        await client.query(
          `INSERT INTO lote_ops (data, mesa, op, de, ate, frascos, rolhas_por_frasco, frascos_partidos, qvs, contadeira, tipo, dsrol, rolhas_partidas, seq)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, COALESCE((SELECT MAX(seq) FROM lote_ops WHERE data = $1 AND mesa = $2), (SELECT COUNT(*) FROM lote_ops WHERE data = $1 AND mesa = $2)) + 1)`,
          [ctx.data, s.mesa, o.op, s.de, s.ate, s.frascos, o.rolhas, s.partidos, s.qvs, b.contadeira, b.tipo, b.dsrol, s.rolhasPart === undefined ? null : s.rolhasPart]);
        await recalcularLote(client, ctx.data, s.mesa);
      }
      await client.query(`INSERT INTO ordens (op, encomenda) VALUES ($1, $2) ON CONFLICT (op) DO UPDATE SET encomenda = EXCLUDED.encomenda`, [o.op, encomenda]);
      await client.query(`INSERT INTO ordens_dia (data, op, continua) VALUES ($1, $2, $3) ON CONFLICT (data, op) DO UPDATE SET continua = EXCLUDED.continua`, [ctx.data, o.op, b.continua]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    res.json({ ok: true, op: o.op, mesas: a.segmentos.map((s) => s.mesa) });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao registar a ordem.' }); }
});
app.post('/api/logistica/ordem/remover', async (req, res) => {
  try {
    if (!verificarPin(req, res)) return;   // tirar uma ordem é ação da supervisão
    const ctx = await contextoColocacao(req, res); if (!ctx) return;
    const op = String((req.body || {}).ordem || '').trim();
    const r = await pool.query(`SELECT mesa FROM lote_ops WHERE data = $1 AND op = $2`, [ctx.data, op]);
    if (!r.rowCount) return res.status(404).json({ erro: 'Esta ordem não está colocada neste dia.' });
    const mesas = r.rows.map((x) => x.mesa);
    if (ctx.data === ctx.hoje) {
      const pr = await pool.query(`SELECT 1 FROM registos WHERE mesa = ANY($1) AND hora_abertura >= ((now() AT TIME ZONE 'Europe/Lisbon')::date::timestamp AT TIME ZONE 'Europe/Lisbon') LIMIT 1`, [mesas]);
      if (pr.rowCount) return res.status(409).json({ erro: 'Já há provas registadas nestas mesas hoje.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM lote_ops WHERE data = $1 AND op = $2`, [ctx.data, op]);
      await client.query(`DELETE FROM ordens_dia WHERE data = $1 AND op = $2`, [ctx.data, op]);
      await client.query(`DELETE FROM ordens WHERE op = $1 AND NOT EXISTS (SELECT 1 FROM ordens_dia WHERE op = $1)`, [op]);
      for (const m of mesas) await recalcularLote(client, ctx.data, m);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    res.json({ ok: true, mesas });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao remover a ordem.' }); }
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
      const r = await pool.query(`SELECT 1 FROM registos WHERE mesa = ANY($1) AND hora_abertura >= ((now() AT TIME ZONE 'Europe/Lisbon')::date::timestamp AT TIME ZONE 'Europe/Lisbon') LIMIT 1`, [mesas.map((m) => String(m).toUpperCase())]);
      if (r.rowCount) return res.status(409).json({ erro: 'Já há provas registadas nestas mesas hoje.' });
    }
    await pool.query(`DELETE FROM lote_ops WHERE data = $1 AND mesa = ANY($2)`, [data, mesas.map((m) => String(m).toUpperCase())]);
    await pool.query(`DELETE FROM ordens_dia d WHERE d.data = $1 AND NOT EXISTS (SELECT 1 FROM lote_ops l WHERE l.data = d.data AND l.op = d.op)`, [data]);
    await pool.query(`DELETE FROM lotes WHERE data_planeamento = $1 AND mesa = ANY($2)`, [data, mesas.map((m) => String(m).toUpperCase())]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao remover as mesas.' });
  }
});

// ===================== Levantamento: MISU, Contadeira, Logística =====================
// Lista os lotes de hoje com o estado das provas e os valores já apontados (e os derivados).
// encomenda (da ordem) e "continua amanhã" (do dia) de cada ordem colocada num dia
async function infoOrdensDia(data) {
  const r = await pool.query(`SELECT d.op, d.continua, o.encomenda FROM ordens_dia d LEFT JOIN ordens o ON o.op = d.op WHERE d.data = $1`, [data]);
  return new Map(r.rows.map((x) => [x.op, { continua: x.continua, encomenda: x.encomenda }]));
}
function segFormatado(s) {
  return { op: s.op, seq: s.seq || null, de: s.de, ate: s.ate, frascos: s.frascos, rolhasPorFrasco: s.rolhas_por_frasco, rolhas: s.frascos * s.rolhas_por_frasco,
    frascosPartidos: s.frascos_partidos, rolhasPartidas: s.rolhas_partidas !== null && s.rolhas_partidas !== undefined ? s.rolhas_partidas : s.frascos_partidos * s.rolhas_por_frasco, qvs: s.qvs,
    misuQvs: s.misu_qvs || 0,
    ligeiros: s.misu_ligeiros === null || s.misu_ligeiros === undefined ? null : s.misu_ligeiros, fortes: s.misu_fortes === null || s.misu_fortes === undefined ? null : s.misu_fortes, contadeira: s.contadeira, tipo: s.tipo, dsrol: s.dsrol };
}
async function lotesDeHoje() {
  const hoje = plan.hojeLisboa();
  const lotes = await pool.query(`SELECT * FROM lotes WHERE data_planeamento = $1 AND ativo = true`, [hoje]);
  const sgs = await pool.query(`SELECT * FROM lote_ops WHERE data = $1 ORDER BY de`, [hoje]);
  const infoOp = await infoOrdensDia(hoje);
  const segsPorMesa = new Map();
  sgs.rows.forEach((s) => { if (!segsPorMesa.has(s.mesa)) segsPorMesa.set(s.mesa, []); segsPorMesa.get(s.mesa).push({ ...segFormatado(s), ...(infoOp.get(s.op) || {}) }); });
  lotes.rows.forEach((l) => { l._segs = segsPorMesa.get(l.mesa) || []; });
  const feitos = await pool.query(
    `SELECT mesa, COUNT(DISTINCT aprovador)::int AS n FROM registos
     WHERE estado = 'Fechado' AND hora_fecho >= ((now() AT TIME ZONE 'Europe/Lisbon')::date::timestamp AT TIME ZONE 'Europe/Lisbon') AND hora_fecho < (((now() AT TIME ZONE 'Europe/Lisbon')::date + 1)::timestamp AT TIME ZONE 'Europe/Lisbon') GROUP BY mesa`);
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
  const r = await pool.query(`SELECT op, ligeiros, fortes, aprovadas, sobras, sobras_rej, em FROM contagens_op WHERE data = $1`, [plan.hojeLisboa()]);
  return new Map(r.rows.map((c) => [c.op, c]));
}
function formatarLote({ l, f, estadoProva }, contagens) {
  const d = derivar(l);
  const m = {
    mesa: l.mesa, ordem: l.ordem, tipo: l.tipo, dsrol: l.dsrol, estadoProva,
    feitos: f, necessarios: l.numero_provadores, segmentos: l._segs || [], ...d, misuEm: l.misu_em, logEm: l.log_em, ops: opsDoLote(l.ordem),
    fase: estadoProva === 'levantada' ? 'levantada' : estadoProva !== 'pronta' ? 'em_prova' : d.misuEstado === 'pendente' ? 'misu' : 'logistica',
  };
  if (d.contadeira) {
    // contagem da contadeira, por OP (é o valor da OP inteira, não da mesa); na colocação por ordem, só as ordens com contadeira
    const opsCont = (l._segs || []).length ? l._segs.filter((s) => s.contadeira).map((s) => s.op) : m.ops;
    m.contagensOp = opsCont.map((op) => {
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
// ===================== Ordens (OP): levantamento pela ordem, encomenda e fecho parcial/final =====================
// Estado final de uma ordem. Os dias anteriores já levantados contam pelo valor guardado; hoje conta o valor atual.
//  - continua amanhã: 1.º fecho (parcial), à espera do resultado do dia seguinte
//  - sem encomenda registada, ou somatório >= encomenda: ok
//  - somatório < encomenda: pendente (decisão da supervisora: acrescentar rolhas ou aceitar a falta)
function resultadoOrdem({ encomenda, acumulado, continua, diaTerminado, aceiteFalta }) {
  if (!diaTerminado) return 'em_curso';
  if (continua) return 'parcial';
  if (encomenda === null || encomenda === undefined) return 'ok';
  if (acumulado >= encomenda) return 'ok';
  return aceiteFalta ? 'ok_com_falta' : 'pendente';
}
async function ordensDeHoje(ms, contagens) {
  const hoje = plan.hojeLisboa();
  const porOp = new Map();
  ms.forEach((m) => (m.segmentos || []).forEach((s) => {
    if (!porOp.has(s.op)) porOp.set(s.op, { op: s.op, mesas: [], segmentos: [] });
    const o = porOp.get(s.op);
    if (!o.mesas.includes(m.mesa)) o.mesas.push(m.mesa);
    o.segmentos.push({ ...s, mesa: m.mesa, seqRotulo: m.segmentos.length > 1 ? `${m.mesa}-${s.seq || '?'}` : m.mesa });
  }));
  const ops = [...porOp.keys()];
  if (!ops.length) return [];
  const ord = new Map((await pool.query(`SELECT * FROM ordens WHERE op = ANY($1)`, [ops])).rows.map((r) => [r.op, r]));
  const dias = (await pool.query(`SELECT op, to_char(data, 'YYYY-MM-DD') AS d, continua, qvs_logistica, levantada_em, aprovadas_final FROM ordens_dia WHERE op = ANY($1) ORDER BY data`, [ops])).rows;
  const mesaPor = new Map(ms.map((m) => [m.mesa, m]));
  return ops.map((op) => {
    const o = porOp.get(op);
    const mesas = o.mesas.map((c) => mesaPor.get(c));
    const segs = o.segmentos;
    const cont = segs.some((s) => s.contadeira);
    const row = ord.get(op) || {};
    const meusDias = dias.filter((d) => d.op === op);
    const hojeRow = meusDias.find((d) => d.d === hoje) || {};
    const anteriores = meusDias.filter((d) => d.d < hoje).reduce((t, d) => t + (d.aprovadas_final || 0), 0);
    const soma = (f) => segs.reduce((t, s) => t + f(s), 0);
    const todosMisu = segs.every((s) => s.fortes !== null && s.fortes !== undefined && (s.contadeira || (s.ligeiros !== null && s.ligeiros !== undefined)));
    const contagem = contagens && contagens.get(op);
    let aprovadasDia = null;
    if (cont) aprovadasDia = contagem && contagem.aprovadas !== undefined && contagem.aprovadas !== null ? contagem.aprovadas : null;
    else if (todosMisu) aprovadasDia = soma((s) => s.rolhas - (s.ligeiros || 0) - (s.fortes || 0) - s.rolhasPartidas);
    const rolhas = soma((s) => s.rolhas), partidas = soma((s) => s.rolhasPartidas);
    const fortes = soma((s) => s.fortes || 0), ligeiros = soma((s) => s.ligeiros || 0);
    // fase de hoje
    let fase;
    if (hojeRow.levantada_em) fase = 'levantada';
    else if (mesas.some((m) => m.estadoProva === 'em_prova')) fase = 'em_prova';
    else if (!todosMisu) fase = 'misu';
    else fase = 'pronta';   // levanta-se logo que o MISU acaba; a contadeira conta depois do levantamento
    const aguardaContadeira = cont && aprovadasDia === null;
    const aprovadasConta = hojeRow.levantada_em && hojeRow.aprovadas_final !== null && hojeRow.aprovadas_final !== undefined ? hojeRow.aprovadas_final : (aprovadasDia || 0);
    const acumulado = anteriores + aprovadasConta + (row.rolhas_adicionais || 0);
    const encomenda = row.encomenda === undefined ? null : row.encomenda;
    const continua = !!hojeRow.continua;
    const qvs = { colocacao: soma((s) => s.qvs), misu: soma((s) => s.misuQvs || 0), logistica: hojeRow.qvs_logistica || 0 };
    qvs.total = qvs.colocacao + qvs.misu + qvs.logistica;
    const resultado = resultadoOrdem({ encomenda, acumulado, continua, diaTerminado: fase === 'levantada' && !aguardaContadeira, aceiteFalta: !!row.aceite_falta });
    return {
      op, mesas: o.mesas, segmentos: segs, contadeira: cont, tipo: segs[0].tipo, dsrol: segs.some((s) => s.dsrol),
      rolhas, rolhasPartidas: partidas, frascosPartidos: soma((s) => s.frascosPartidos), frascos: soma((s) => s.frascos),
      ligeiros, fortes, contaminados: ligeiros + fortes, aprovadasDia, fase, aguardaContadeira, contLigeiras: contagem && contagem.ligeiros !== undefined ? contagem.ligeiros : null, contSobras: contagem && contagem.sobras !== undefined && contagem.sobras !== null ? contagem.sobras : null, contSobrasRej: contagem && contagem.sobras_rej !== undefined && contagem.sobras_rej !== null ? contagem.sobras_rej : null, levantadaEm: hojeRow.levantada_em || null,
      encomenda, anteriores, rolhasAdicionais: row.rolhas_adicionais || 0, acumulado, continua, resultado,
      falta: encomenda !== null ? Math.max(0, encomenda - acumulado) : 0, aceiteFalta: !!row.aceite_falta, qvs,
    };
  }).sort((a, b) => a.op.localeCompare(b.op));
}
// levantar / desfazer uma ORDEM (a logística levanta pela ordem, com as QVs)
async function carregarOrdemHoje(op) {
  const lista = await lotesDeHoje();
  const contagens = await contagensDeHoje();
  const ms = lista.map((x) => formatarLote(x, contagens));
  const ordens = await ordensDeHoje(ms, contagens);
  return { ms, ordens, o: ordens.find((x) => x.op === String(op).trim()) };
}
app.post('/api/logistica/ordem/qvs', async (req, res) => {
  try {
    const { o } = await carregarOrdemHoje((req.body || {}).op);
    if (!o) return res.status(404).json({ erro: 'Esta ordem não tem mesas hoje.' });
    if (o.fase === 'em_prova') return res.status(409).json({ erro: 'A ordem ainda tem mesas por provar.' });
    if (o.fase === 'levantada' && !pinOk(req)) return res.status(409).json({ erro: 'Ordem já levantada: só a supervisora pode alterar as QVs.' });
    const qvs = inteiro((req.body || {}).qvs);
    if (qvs === undefined || invalido(qvs)) return res.status(400).json({ erro: 'Indica as QVs (nº de rolhas, número inteiro).' });
    await pool.query(`INSERT INTO ordens_dia (data, op, qvs_logistica) VALUES ($1,$2,$3) ON CONFLICT (data, op) DO UPDATE SET qvs_logistica = EXCLUDED.qvs_logistica`, [plan.hojeLisboa(), o.op, qvs]);
    res.json({ ok: true, ordem: (await carregarOrdemHoje(o.op)).o });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao registar as QVs.' }); }
});
app.post('/api/logistica/ordem/levantar', async (req, res) => {
  try {
    const { op, desfazer } = req.body || {};
    const { o } = await carregarOrdemHoje(op);
    if (!o) return res.status(404).json({ erro: 'Esta ordem não tem mesas hoje.' });
    const hoje = plan.hojeLisboa();
    if (desfazer && !pinOk(req)) return res.status(403).json({ erro: 'Palavra-passe da supervisora incorreta. Só a supervisora pode desfazer um levantamento.' });
    if (!desfazer) {
      if (o.fase === 'em_prova') return res.status(409).json({ erro: 'A ordem ainda tem mesas por provar.' });
      if (o.fase === 'misu') return res.status(409).json({ erro: 'Os contaminados andam sempre à frente: o MISU ainda não levantou os contaminados de todas as mesas desta ordem.' });
      if (o.fase === 'levantada') return res.json({ ok: true, ordem: o });
      if (!o.contadeira) {   // com contadeira, as QVs são apontadas na contadeira; sem contadeira, aqui
        const qv = inteiro((req.body || {}).qvs);
        if (qv === undefined || invalido(qv)) return res.status(400).json({ erro: 'Indica as QVs da logística (nº de rolhas, pode ser 0).' });
        await pool.query(`INSERT INTO ordens_dia (data, op, qvs_logistica) VALUES ($1,$2,$3) ON CONFLICT (data, op) DO UPDATE SET qvs_logistica = EXCLUDED.qvs_logistica`, [hoje, o.op, qv]);
      }
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (desfazer) await client.query(`UPDATE ordens_dia SET levantada_em = NULL, aprovadas_final = NULL WHERE data = $1 AND op = $2`, [hoje, o.op]);
      else await client.query(`INSERT INTO ordens_dia (data, op, levantada_em, aprovadas_final) VALUES ($1,$2, now(), $3) ON CONFLICT (data, op) DO UPDATE SET levantada_em = now(), aprovadas_final = $3`, [hoje, o.op, o.aprovadasDia]);
      // a mesa fica levantada quando TODAS as suas ordens estão levantadas
      for (const mesa of o.mesas) {
        const r = await client.query(
          `SELECT COUNT(*)::int AS n, COUNT(d.levantada_em)::int AS lev FROM (SELECT DISTINCT op FROM lote_ops WHERE data = $1 AND mesa = $2) x LEFT JOIN ordens_dia d ON d.data = $1 AND d.op = x.op`, [hoje, mesa]);
        await client.query(`UPDATE lotes SET levantada_em = ${r.rows[0].n > 0 && r.rows[0].n === r.rows[0].lev ? 'now()' : 'NULL'} WHERE mesa = $1 AND data_planeamento = $2`, [mesa, hoje]);
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    res.json({ ok: true, ordem: (await carregarOrdemHoje(o.op)).o });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao levantar a ordem.' }); }
});

// informação de uma ordem já conhecida (dias anteriores, encomenda): preenche o formulário de colocação
app.get('/api/ordem/:op', async (req, res) => {
  try {
    const op = String(req.params.op).trim();
    const o = (await pool.query(`SELECT * FROM ordens WHERE op = $1`, [op])).rows[0];
    if (!o) return res.json({ existe: false });
    const hoje = plan.hojeLisboa();
    const dias = (await pool.query(`SELECT to_char(data, 'YYYY-MM-DD') AS d, continua, aprovadas_final FROM ordens_dia WHERE op = $1 AND data < $2 ORDER BY data`, [op, hoje])).rows;
    const anteriores = dias.reduce((t, d) => t + (d.aprovadas_final || 0), 0);
    res.json({ existe: true, encomenda: o.encomenda, anteriores, rolhasAdicionais: o.rolhas_adicionais, dias: dias.map((d) => d.d), continuavaOntem: dias.length ? dias[dias.length - 1].continua : false });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao obter a ordem.' }); }
});

// --- Supervisora: ordens abertas/pendentes e decisão (acrescentar rolhas ou aceitar a falta) ---
async function listaOrdensSupervisora() {
  const hoje = plan.hojeLisboa();
  const ords = (await pool.query(`SELECT * FROM ordens ORDER BY op`)).rows;
  const dias = (await pool.query(`SELECT op, to_char(data, 'YYYY-MM-DD') AS d, continua, aprovadas_final, levantada_em FROM ordens_dia ORDER BY data`)).rows;
  const contagens = await contagensDeHoje();
  const lista = await lotesDeHoje();
  const ms = lista.map((x) => formatarLote(x, contagens));
  const hojeOrds = new Map((await ordensDeHoje(ms, contagens)).map((o) => [o.op, o]));
  const cont = (await pool.query(`SELECT op, to_char(data, 'YYYY-MM-DD') AS d, aprovadas, ligeiros, sobras, sobras_rej FROM contagens_op`)).rows;
  const qv = (await pool.query(`SELECT op, to_char(data, 'YYYY-MM-DD') AS d, qvs_logistica FROM ordens_dia`)).rows;
  const agg = (await pool.query(`SELECT op, to_char(data, 'YYYY-MM-DD') AS d, BOOL_OR(contadeira) AS contadeira, SUM(frascos * rolhas_por_frasco)::int AS total,
      SUM(COALESCE(misu_fortes, 0))::int AS fortes, SUM(COALESCE(rolhas_partidas, frascos_partidos * rolhas_por_frasco))::int AS partidas FROM lote_ops GROUP BY op, data`)).rows;
  const valoresDe = (op) => agg.filter((a) => a.op === op).map((a) => {
    const c = cont.find((x) => x.op === op && x.d === a.d) || {}, q = qv.find((x) => x.op === op && x.d === a.d) || {};
    return { data: a.d, contadeira: a.contadeira, total: a.total, fortes: a.fortes, partidas: a.partidas, aprovadas: c.aprovadas ?? null, ligeiras: c.ligeiros ?? null, sobras: c.sobras ?? null, sobrasRej: c.sobras_rej ?? null, qvs: q.qvs_logistica ?? 0 };
  }).sort((x, y) => (x.data < y.data ? 1 : -1));
  return ords.map((o) => {
    const dd = dias.filter((d) => d.op === o.op);
    const ultimo = dd[dd.length - 1];
    const ho = hojeOrds.get(o.op);
    let resultado, acumulado;
    if (ho) { resultado = ho.resultado; acumulado = ho.acumulado; }
    else {
      acumulado = dd.reduce((t, d) => t + (d.aprovadas_final || 0), 0) + o.rolhas_adicionais;
      resultado = resultadoOrdem({ encomenda: o.encomenda, acumulado, continua: ultimo ? ultimo.continua : false, diaTerminado: !!(ultimo && ultimo.levantada_em), aceiteFalta: o.aceite_falta });
    }
    return { op: o.op, encomenda: o.encomenda, acumulado, falta: o.encomenda === null ? 0 : Math.max(0, o.encomenda - acumulado), rolhasAdicionais: o.rolhas_adicionais, aceiteFalta: o.aceite_falta, resultado, dias: dd.map((d) => d.d), valores: valoresDe(o.op), faseHoje: ho ? ho.fase : null, contadaHoje: ho ? ho.aprovadasDia !== null && ho.contadeira : false, contadeira: ho ? ho.contadeira : false };
  });
}
app.post('/api/supervisora/versoes', async (req, res) => {
  try {
    if (!verificarPin(req, res)) return;
    const r = await pool.query(`SELECT id, motivo, resumo, to_char(criado AT TIME ZONE 'Europe/Lisbon', 'DD/MM HH24:MI') AS quando FROM versoes ORDER BY id DESC LIMIT 40`);
    res.json({ ok: true, versoes: r.rows });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao obter as versões.' }); }
});
app.post('/api/supervisora/versoes/restaurar', async (req, res) => {
  try {
    if (!verificarPin(req, res)) return;
    const v = (await pool.query(`SELECT dados FROM versoes WHERE id = $1`, [Number((req.body || {}).id)])).rows[0];
    if (!v) return res.status(404).json({ erro: 'Versão não encontrada.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const t of TAB_VERSAO) await client.query(`DELETE FROM ${t}`);
      for (const t of TAB_VERSAO) await client.query(`INSERT INTO ${t} SELECT * FROM json_populate_recordset(null::${t}, $1::json)`, [JSON.stringify(v.dados[t] || [])]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    await carregarDiasExtra();
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao restaurar a versão.' }); }
});
// --- Supervisora: métricas dos provadores (provas e mesas efetuadas, tempos) ---
app.post('/api/supervisora/provadores-metricas', async (req, res) => {
  try {
    if (!verificarPin(req, res)) return;
    const dias = [1, 7, 30].includes(Number((req.body || {}).dias)) ? Number(req.body.dias) : 1;
    const r = await pool.query(
      `SELECT id, mesa, aprovador, estado, ordem,
              to_char(hora_abertura AT TIME ZONE 'Europe/Lisbon', 'YYYY-MM-DD') AS dia,
              to_char(hora_abertura AT TIME ZONE 'Europe/Lisbon', 'HH24:MI') AS abertura,
              to_char(hora_fecho AT TIME ZONE 'Europe/Lisbon', 'HH24:MI') AS fecho,
              CASE WHEN hora_fecho IS NOT NULL THEN ROUND(EXTRACT(EPOCH FROM (hora_fecho - hora_abertura)) / 60.0, 1) END AS minutos
       FROM registos
       WHERE hora_abertura >= (((now() AT TIME ZONE 'Europe/Lisbon')::date - ($1::int - 1))::timestamp AT TIME ZONE 'Europe/Lisbon')
       ORDER BY hora_abertura DESC`, [dias]);
    const por = new Map();
    for (const x of r.rows) {
      if (!por.has(x.aprovador)) por.set(x.aprovador, { nome: x.aprovador, provas: [] });
      por.get(x.aprovador).provas.push({ id: x.id, mesa: x.mesa, dia: x.dia, abertura: x.abertura, fecho: x.fecho, minutos: x.minutos === null ? null : Number(x.minutos), estado: x.estado });
    }
    const med = (a) => (a.length ? Math.round((a.reduce((t, v) => t + v, 0) / a.length) * 10) / 10 : null);
    const provadores = [...por.values()].map((p) => {
      const fech = p.provas.filter((x) => x.estado === 'Fechado' && x.minutos !== null && x.minutos >= 0);
      const mins = fech.map((x) => x.minutos);
      return {
        nome: p.nome, provasFechadas: p.provas.filter((x) => x.estado === 'Fechado').length, abertas: p.provas.filter((x) => x.estado !== 'Fechado').length,
        mesas: new Set(p.provas.filter((x) => x.estado === 'Fechado').map((x) => x.dia + x.mesa)).size,
        diasAtivos: new Set(p.provas.map((x) => x.dia)).size,
        mediaMin: med(mins), minMin: mins.length ? Math.min(...mins) : null, maxMin: mins.length ? Math.max(...mins) : null,
        provas: p.provas.slice(0, 200),
      };
    }).sort((a, b) => b.mesas - a.mesas || a.nome.localeCompare(b.nome));
    const todasMin = r.rows.filter((x) => x.estado === 'Fechado' && x.minutos !== null && Number(x.minutos) >= 0).map((x) => Number(x.minutos));
    const mesasTot = new Set(r.rows.filter((x) => x.estado === 'Fechado').map((x) => x.dia + x.mesa)).size;
    res.json({ ok: true, dias, resumo: { provas: r.rows.filter((x) => x.estado === 'Fechado').length, abertas: r.rows.filter((x) => x.estado !== 'Fechado').length, mesas: mesasTot, provadores: provadores.length, mediaMin: med(todasMin) }, provadores });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao obter as métricas.' }); }
});

// --- Supervisora: fechar provas em lote (intervalo de mesas, com exceções) para poder avançar com a logística ---
app.post('/api/supervisora/fechar-provas', async (req, res) => {
  try {
    if (!verificarPin(req, res)) return;
    const b = req.body || {};
    const lado = String(b.lado || '').toUpperCase();
    const de = Number(b.de), ate = Number(b.ate), n = Number(b.provadores || 2);
    const exc = new Set((Array.isArray(b.excecoes) ? b.excecoes : String(b.excecoes || '').split(/[\s,;]+/)).map((x) => String(x).toUpperCase()).filter(Boolean));
    if (!['A', 'B'].includes(lado) || !Number.isInteger(de) || !Number.isInteger(ate) || de < 1 || ate < de || ate > 60) return res.status(400).json({ erro: 'Indica o lado (A ou B) e o intervalo de mesas (de, até).' });
    if (!Number.isInteger(n) || n < 1 || n > 6) return res.status(400).json({ erro: 'Nº de provadores: 1 a 6.' });
    const hoje = plan.hojeLisboa();
    const nomes = (await pool.query(`SELECT nome FROM aprovadores WHERE ativo = true ORDER BY nome`)).rows.map((r) => r.nome);
    const lotes = (await pool.query(`SELECT mesa, ordem FROM lotes WHERE data_planeamento = $1 AND ativo = true`, [hoje])).rows
      .filter((l) => l.mesa[0] === lado && Number(l.mesa.slice(1)) >= de && Number(l.mesa.slice(1)) <= ate && !exc.has(l.mesa))
      .sort((a, c) => Number(a.mesa.slice(1)) - Number(c.mesa.slice(1)));
    const DIA0 = `((now() AT TIME ZONE 'Europe/Lisbon')::date::timestamp AT TIME ZONE 'Europe/Lisbon')`;
    const feitas = [], semLote = [];
    for (let k = de; k <= ate; k++) { const c = lado + k; if (!exc.has(c) && !lotes.some((l) => l.mesa === c)) semLote.push(c); }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const l of lotes) {
        await client.query(`UPDATE lotes SET numero_provadores = $1 WHERE mesa = $2 AND data_planeamento = $3`, [n, l.mesa, hoje]);
        await client.query(`UPDATE registos SET estado = 'Fechado', hora_fecho = now() WHERE mesa = $1 AND estado = 'Aberto' AND hora_abertura >= ${DIA0}`, [l.mesa]);
        const reg = (await client.query(`SELECT aprovador, estado FROM registos WHERE mesa = $1 AND hora_abertura >= ${DIA0}`, [l.mesa])).rows;
        const fechadas = reg.filter((x) => x.estado === 'Fechado').length;
        const usados = new Set(reg.map((x) => x.aprovador));
        const carga = new Map((await client.query(`SELECT aprovador, COUNT(DISTINCT mesa)::int AS c FROM registos WHERE estado = 'Fechado' AND hora_fecho >= ${DIA0} GROUP BY aprovador`)).rows.map((r) => [r.aprovador, r.c]));
        const livres = nomes.filter((x) => !usados.has(x)).sort((a, c) => (carga.get(a) || 0) - (carga.get(c) || 0));
        let add = 0;
        for (let i = 0; fechadas + add < n && i < livres.length; i++, add++) {
          await client.query(
            `INSERT INTO registos (mesa, aprovador, hora_abertura, hora_fecho, estado, ordem) VALUES ($1,$2, GREATEST(now() - interval '20 minutes', ${DIA0} + interval '1 minute'), GREATEST(now() - interval '10 minutes', ${DIA0} + interval '2 minutes'), 'Fechado', $3)`,
            [l.mesa, livres[i], l.ordem]);
          carga.set(livres[i], (carga.get(livres[i]) || 0) + 1);
        }
        feitas.push(l.mesa);
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    res.json({ ok: true, fechadas: feitas, semLote, excecoes: [...exc] });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao fechar as provas.' }); }
});

// --- Supervisora: corrigir diretamente, a qualquer momento, os valores da contadeira (OK, ligeiras, QVs, sobras) ou as QVs da logística de uma ordem/dia ---
app.post('/api/supervisora/ordem-valores', async (req, res) => {
  try {
    if (!verificarPin(req, res)) return;
    const b = req.body || {};
    const op = String(b.op || '').trim(), data = String(b.data || plan.hojeLisboa());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ erro: 'Data inválida.' });
    const ag = (await pool.query(`SELECT BOOL_OR(contadeira) AS contadeira, SUM(frascos * rolhas_por_frasco)::int AS total, SUM(COALESCE(misu_fortes, 0))::int AS fortes,
        SUM(COALESCE(rolhas_partidas, frascos_partidos * rolhas_por_frasco))::int AS partidas FROM lote_ops WHERE data = $1 AND op = $2`, [data, op])).rows[0];
    if (!ag || ag.total === null) return res.status(404).json({ erro: 'Esta ordem não tem colocação nesse dia.' });
    const qv = inteiro(b.qvs);
    if (qv === undefined || invalido(qv)) return res.status(400).json({ erro: 'Indica as QVs (nº de rolhas, 0 ou mais).' });
    if (!ag.contadeira) {
      await pool.query(`INSERT INTO ordens_dia (data, op, qvs_logistica) VALUES ($1,$2,$3) ON CONFLICT (data, op) DO UPDATE SET qvs_logistica = EXCLUDED.qvs_logistica`, [data, op, qv]);
    } else {
      const apr = inteiro(b.aprovadas), lig = inteiro(b.ligeiras), sob = inteiro(b.sobras);
      if ([apr, lig, sob].some((v) => v === undefined || invalido(v))) return res.status(400).json({ erro: 'Indica rolhas OK, rejeitadas e sobras (números inteiros, 0 ou mais).' });
      if (sob >= 5000) return res.status(400).json({ erro: 'Sobras: menos de 5 000 rolhas (um saco completo tem 5 000).' });
      const sobRej = b.sobrasRej === undefined || b.sobrasRej === null || b.sobrasRej === '' ? null : inteiro(b.sobrasRej);
      if (sobRej !== null && (sobRej === undefined || invalido(sobRej))) return res.status(400).json({ erro: 'Sobras de rolhas rejeitadas: número inteiro, 0 ou mais.' });
      const soma = apr + lig + ag.fortes + ag.partidas + sob;
      if (soma !== ag.total) return res.status(400).json({ erro: `Não bate com a colocação: OK (${apr}) + rejeitadas (${lig}) + fortes do MISU (${ag.fortes}) + partidas (${ag.partidas}) + sobras (${sob}) = ${soma}, e a OP tem ${ag.total} rolhas.` });
      await pool.query(`INSERT INTO contagens_op (op, data, aprovadas, ligeiros, sobras, sobras_rej, em) VALUES ($1,$2,$3,$4,$5,$6,now()) ON CONFLICT (op, data) DO UPDATE SET aprovadas = $3, ligeiros = $4, sobras = $5, sobras_rej = $6, em = now()`, [op, data, apr, lig, sob, sobRej]);
      await pool.query(`INSERT INTO ordens_dia (data, op, qvs_logistica, aprovadas_final) VALUES ($1,$2,$3,$4) ON CONFLICT (data, op) DO UPDATE SET qvs_logistica = $3, aprovadas_final = CASE WHEN ordens_dia.levantada_em IS NOT NULL THEN $4 ELSE ordens_dia.aprovadas_final END`, [data, op, qv, apr]);
    }
    res.json({ ok: true, ordens: await listaOrdensSupervisora() });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao guardar os valores.' }); }
});
app.post('/api/supervisora/ordens', async (req, res) => {
  try {
    if (!verificarPin(req, res)) return;
    res.json({ ok: true, ordens: await listaOrdensSupervisora() });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao obter as ordens.' }); }
});
app.post('/api/supervisora/ordem-resultado', async (req, res) => {
  try {
    if (!verificarPin(req, res)) return;
    const b = req.body || {};
    const op = String(b.op || '').trim();
    const o = (await pool.query(`SELECT * FROM ordens WHERE op = $1`, [op])).rows[0];
    if (!o) return res.status(404).json({ erro: 'Ordem não encontrada.' });
    if (b.acao === 'acrescentar') {
      const n = Number(b.rolhas);
      if (!Number.isInteger(n) || n < 1) return res.status(400).json({ erro: 'Indica as rolhas a acrescentar (número inteiro, 1 ou mais).' });
      await pool.query(`UPDATE ordens SET rolhas_adicionais = rolhas_adicionais + $1, aceite_falta = false, aceite_em = NULL WHERE op = $2`, [n, op]);
    } else if (b.acao === 'aceitar') {
      await pool.query(`UPDATE ordens SET aceite_falta = true, aceite_em = now() WHERE op = $1`, [op]);
    } else if (b.acao === 'reabrir') {
      await pool.query(`UPDATE ordens SET aceite_falta = false, aceite_em = NULL WHERE op = $1`, [op]);
    } else if (b.acao === 'encomenda') {
      const n = Number(b.encomenda);
      if (!Number.isInteger(n) || n < 1) return res.status(400).json({ erro: 'Quantidade encomendada: número inteiro (1 ou mais).' });
      await pool.query(`UPDATE ordens SET encomenda = $1 WHERE op = $2`, [n, op]);
    } else if (b.acao === 'reabrir_levantamento') {
      const hoje = plan.hojeLisboa();
      await pool.query(`UPDATE ordens_dia SET levantada_em = NULL, aprovadas_final = NULL WHERE data = $1 AND op = $2`, [hoje, op]);
      await pool.query(`UPDATE lotes SET levantada_em = NULL WHERE data_planeamento = $1 AND mesa IN (SELECT mesa FROM lote_ops WHERE data = $1 AND op = $2)`, [hoje, op]);
    } else if (b.acao === 'reabrir_contagem') {
      const hoje = plan.hojeLisboa();
      await pool.query(`DELETE FROM contagens_op WHERE data = $1 AND op = $2`, [hoje, op]);
      await pool.query(`UPDATE ordens_dia SET aprovadas_final = NULL WHERE data = $1 AND op = $2`, [hoje, op]);
    } else if (b.acao === 'reabrir_misu') {
      await pool.query(`UPDATE lotes SET misu_em = NULL WHERE data_planeamento = $1 AND mesa IN (SELECT mesa FROM lote_ops WHERE data = $1 AND op = $2)`, [plan.hojeLisboa(), op]);
    } else return res.status(400).json({ erro: 'Ação inválida.' });
    res.json({ ok: true, ordens: await listaOrdensSupervisora() });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao guardar a decisão.' }); }
});

app.get('/api/levantamento', async (req, res) => {
  try {
    const lista = await lotesDeHoje();
    const contagens = await contagensDeHoje();
    const mesas = juntarConfere(lista.map((x) => formatarLote(x, contagens)), contagens);
    const ordens = await ordensDeHoje(mesas, contagens);
    const info = new Map(ordens.map((o) => [o.op, o]));
    const ops = agregarOps(mesas, contagens).map((o) => ({ ...o, estado: (() => { const i = info.get(o.op); if (!i) return o.estado; if (i.fase === 'levantada') return i.aprovadasDia === null ? 'por_contar' : 'feito'; return i.fase === 'em_prova' ? 'aguardar_provas' : i.fase === 'misu' ? 'aguardar_misu' : 'aguardar_levantamento'; })(), ligeirasContadas: info.get(o.op)?.contLigeiras ?? null, sobras: info.get(o.op)?.contSobras ?? null, sobrasRej: info.get(o.op)?.contSobrasRej ?? null, dataProva: plan.hojeLisboa(), levantada: info.get(o.op)?.fase === 'levantada', qvsLog: info.get(o.op)?.qvs?.logistica ?? 0, qvsTotal: info.get(o.op)?.qvs?.total ?? 0, encomenda: info.get(o.op)?.encomenda ?? null, anteriores: info.get(o.op)?.anteriores ?? 0, acumulado: info.get(o.op)?.acumulado ?? 0, continua: info.get(o.op)?.continua ?? false, resultado: info.get(o.op)?.resultado ?? null, falta: info.get(o.op)?.falta ?? 0 }));
    res.json({ data: plan.hojeLisboa(), mesas, ops, ordens });
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

async function misuPorOrdem(l, req, res) {
  const d = derivar(l);
  const qvs = inteiro(req.body.qvs);
  if (invalido(qvs)) return res.status(400).json({ erro: 'Indica números inteiros (0 ou mais).' });
  // cut off: depois de entregue à contadeira (mesa com ordens da contadeira), o MISU já não mexe na mesa
  if (l.misu_em && !pinOk(req)) return res.status(409).json({ erro: 'O MISU desta mesa já está registado. Só a supervisora pode alterar.' });
  const por = req.body.ordens && typeof req.body.ordens === 'object' ? req.body.ordens : {};
  const novos = [];
  for (const s of l._segs) {
    const x = por[s.op] || {};
    const lig = inteiro(x.ligeiros), fort = inteiro(x.fortes), qvo = inteiro(x.qvs);
    if (invalido(lig) || invalido(fort) || invalido(qvo)) return res.status(400).json({ erro: 'Indica números inteiros (0 ou mais).' });
    if (fort === undefined) return res.status(400).json({ erro: `Ordem ${s.op}: aponta as rolhas de aroma forte.` });
    if (!s.contadeira && lig === undefined) return res.status(400).json({ erro: `Ordem ${s.op} (sem contadeira): aponta as rolhas de aroma ligeiro e de aroma forte.` });
    const l2 = s.contadeira ? 0 : lig;
    if (l2 + fort + s.rolhasPartidas > s.rolhas) return res.status(400).json({ erro: `Ordem ${s.op}: ligeiras + fortes (${l2 + fort}) + partidas (${s.rolhasPartidas}) é mais do que as ${s.rolhas} rolhas da ordem.` });
    novos.push([s.op, l2, fort, qvo ?? 0]);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [op, lg, ft, qo] of novos) await client.query(`UPDATE lote_ops SET misu_ligeiros = $1, misu_fortes = $2, misu_qvs = $3 WHERE data = $4 AND mesa = $5 AND op = $6`, [lg, ft, qo, plan.hojeLisboa(), l.mesa, op]);
    await client.query(`UPDATE lotes SET misu_ligeiros = $1, misu_fortes = $2, misu_qvs = $3, misu_em = now() WHERE id = $4`,
      [novos.reduce((t, n) => t + n[1], 0), novos.reduce((t, n) => t + n[2], 0), novos.reduce((t, n) => t + n[3], 0), l.id]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  const x = (await lotesDeHoje()).find((i) => i.l.id === l.id);
  res.json({ ok: true, mesa: formatarLote(x, await contagensDeHoje()) });
}

// MISU: levanta os frascos dos contaminados (aroma ligeiro e forte) e aponta as rolhas.
// Se a mesa vai à contadeira, só aponta as QVs e passa a responsabilidade (hand off) à contadeira.
app.post('/api/misu/:mesa', async (req, res) => {
  try {
    const l = await carregarPronta(req.params.mesa, res, true);
    if (!l) return;
    // colocação por ordem: o MISU aponta POR ORDEM dentro da mesa (a mesa continua a ser a unidade de trabalho)
    if ((l._segs || []).length) return misuPorOrdem(l, req, res);
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
    const todas = await lotesDeHoje();
    const contagens0 = await contagensDeHoje();
    const fl = todas.map((x) => formatarLote(x, contagens0));
    const ag = agregarOps(fl, contagens0).find((o) => o.op === op);     // por ordem: só as mesas/ordens que vão à contadeira
    if (!ag) return res.status(404).json({ erro: 'Esta OP não tem mesas que vão à contadeira hoje.' });
    const lista = todas.filter((x) => ag.mesas.includes(x.l.mesa));
    const nova = (await pool.query(`SELECT 1 FROM lote_ops WHERE data = $1 AND op = $2 LIMIT 1`, [plan.hojeLisboa(), op])).rows.length > 0;
    if (nova) {
      // colocação por ordem: levanta-se primeiro (logística) e só depois a contadeira conta
      const ld = (await pool.query(`SELECT levantada_em FROM ordens_dia WHERE data = $1 AND op = $2`, [plan.hojeLisboa(), op])).rows[0];
      if (!ld || !ld.levantada_em) return res.status(409).json({ erro: 'A ordem ainda não foi levantada pela logística. A contadeira conta depois do levantamento.' });
      if (contagens0.get(op) && contagens0.get(op).aprovadas !== null && contagens0.get(op).aprovadas !== undefined && !pinOk(req)) return res.status(409).json({ erro: 'A contagem desta OP já está registada. Só a supervisora pode alterar.' });
      const apr2 = inteiro(req.body.aprovadas), lig2 = inteiro(req.body.ligeiras), qv2 = inteiro(req.body.qvs), sob2 = inteiro(req.body.sobras);
      if (sob2 === undefined || invalido(sob2)) return res.status(400).json({ erro: 'Indica as sobras (rolhas num saco incompleto; escreve 0 se não houver).' });
      if (sob2 >= 5000) return res.status(400).json({ erro: 'Sobras: um saco completo tem 5 000 rolhas, por isso as sobras têm de ser menos de 5 000.' });
      if (qv2 === undefined || invalido(qv2)) return res.status(400).json({ erro: 'Indica as QVs (nº de rolhas, escreve 0 se não houver).' });
      if (apr2 === undefined || invalido(apr2)) return res.status(400).json({ erro: 'Indica as rolhas OK contadas pela máquina (número inteiro, 0 ou mais).' });
      if (lig2 === undefined || invalido(lig2)) return res.status(400).json({ erro: 'Indica as rolhas rejeitadas contadas pela máquina (número inteiro, 0 ou mais).' });
      const sobRej2 = req.body.sobrasRej === undefined || req.body.sobrasRej === '' ? null : inteiro(req.body.sobrasRej);
      if (sobRej2 !== null && (sobRej2 === undefined || invalido(sobRej2))) return res.status(400).json({ erro: 'Sobras de rolhas rejeitadas: número inteiro, 0 ou mais.' });
      const soma = apr2 + lig2 + ag.fortes + ag.rolhasPartidas + sob2;   // as sobras fecham o dia, mas não entram no acumulado
      if (soma !== ag.totalRolhas) return res.status(400).json({ erro: `Não bate com a colocação: OK (${apr2}) + rejeitadas (${lig2}) + fortes do MISU (${ag.fortes}) + partidas (${ag.rolhasPartidas}) + sobras (${sob2}) = ${soma}, e a OP tem ${ag.totalRolhas} rolhas.` });
      await pool.query(`INSERT INTO contagens_op (op, data, aprovadas, ligeiros, sobras, sobras_rej, em) VALUES ($1,$2,$3,$4,$5,$6,now()) ON CONFLICT (op, data) DO UPDATE SET aprovadas = $3, ligeiros = $4, sobras = $5, sobras_rej = $6, em = now()`, [op, plan.hojeLisboa(), apr2, lig2, sob2, sobRej2]);
      await pool.query(`UPDATE ordens_dia SET aprovadas_final = $3, qvs_logistica = $4 WHERE data = $1 AND op = $2`, [plan.hojeLisboa(), op, apr2, qv2]);
      return res.json({ ok: true });
    }
    if (lista.some((x) => x.estadoProva === 'em_prova')) return res.status(409).json({ erro: 'Há mesas desta OP ainda não concluídas pelos provadores.' });
    if (lista.some((x) => derivar(x.l).misuEstado === 'pendente')) return res.status(409).json({ erro: 'O MISU ainda não entregou todas as mesas desta OP à contadeira.' });
    const apr = inteiro(req.body.aprovadas);
    if (apr === undefined || invalido(apr)) return res.status(400).json({ erro: 'Indica as rolhas aprovadas contadas pela máquina (número inteiro, 0 ou mais).' });
    const partilhada = ag.partilhada;
    const total = ag.totalRolhas, contaminados = ag.contaminados, partidas = ag.rolhasPartidas;
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

// --- Supervisora: descarregar o histórico completo de movimentos (CSV) ---
app.post('/api/supervisora/movimentos', async (req, res) => {
  try {
    if (!verificarPin(req, res)) return;
    const r = await pool.query(`SELECT id, em, acao, mesa, op, utilizador, status, pedido, resposta FROM movimentos ORDER BY id`);
    if ((req.body || {}).formato === 'json') return res.json({ total: r.rowCount, movimentos: r.rows });
    const esc = (v) => { if (v === null || v === undefined) return ''; const t = v instanceof Date ? v.toISOString() : String(v); return /[";\n,]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const cab = ['id', 'data_hora', 'acao', 'mesa', 'op', 'utilizador', 'resultado_http', 'pedido', 'resposta'];
    const linhas = r.rows.map((m) => [m.id, m.em, m.acao, m.mesa, m.op, m.utilizador, m.status, m.pedido, m.resposta].map(esc).join(','));
    res.type('text/csv; charset=utf-8').send('\uFEFF' + cab.join(',') + '\n' + linhas.join('\n'));
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao obter o histórico.' }); }
});

// ===================== Menu da supervisora (palavra-passe): provadores, provas das mesas, colocação/levantamento =====================
const hhmm = (v) => /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(v || ''));
app.post('/api/supervisora/provadores', async (req, res) => {
  try {
    if (!verificarPin(req, res)) return;
    const { acao, id } = req.body || {};
    const nome = String((req.body || {}).nome || '').replace(/\s+/g, ' ').trim();
    if (acao !== 'listar') {
      if (['adicionar', 'renomear'].includes(acao) && (nome.length < 2 || nome.length > 60)) return res.status(400).json({ erro: 'Escreve o nome (2 a 60 letras).' });
    }
    if (acao === 'adicionar') {
      const ja = await pool.query(`SELECT id, ativo FROM aprovadores WHERE LOWER(nome) = LOWER($1)`, [nome]);
      if (ja.rowCount && ja.rows[0].ativo) return res.status(409).json({ erro: 'Já existe um provador com esse nome.' });
      if (ja.rowCount) await pool.query(`UPDATE aprovadores SET ativo = true WHERE id = $1`, [ja.rows[0].id]);
      else await pool.query(`INSERT INTO aprovadores (nome) VALUES ($1)`, [nome]);
    } else if (acao === 'renomear') {
      const dup = await pool.query(`SELECT 1 FROM aprovadores WHERE LOWER(nome) = LOWER($1) AND id <> $2`, [nome, Number(id)]);
      if (dup.rowCount) return res.status(409).json({ erro: 'Já existe um provador com esse nome.' });
      const r = await pool.query(`UPDATE aprovadores SET nome = $1 WHERE id = $2`, [nome, Number(id)]);
      if (!r.rowCount) return res.status(404).json({ erro: 'Provador não encontrado.' });
    } else if (acao === 'desativar' || acao === 'ativar') {
      if (acao === 'desativar') {
        const ab = await pool.query(`SELECT 1 FROM registos r JOIN aprovadores a ON a.nome = r.aprovador WHERE a.id = $1 AND r.estado = 'Aberto' LIMIT 1`, [Number(id)]);
        if (ab.rowCount) return res.status(409).json({ erro: 'Este provador tem uma mesa aberta. Fecha ou apaga essa prova primeiro.' });
      }
      const r = await pool.query(`UPDATE aprovadores SET ativo = $1 WHERE id = $2`, [acao === 'ativar', Number(id)]);
      if (!r.rowCount) return res.status(404).json({ erro: 'Provador não encontrado.' });
    } else if (acao !== 'listar') return res.status(400).json({ erro: 'Ação inválida.' });
    const r = await pool.query(`SELECT id, nome, ativo FROM aprovadores ORDER BY ativo DESC, nome`);
    res.json({ ok: true, provadores: r.rows });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao alterar os provadores.' }); }
});

// provas registadas hoje numa mesa (para apagar ou corrigir)
app.post('/api/supervisora/registos', async (req, res) => {
  try {
    if (!verificarPin(req, res)) return;
    const mesa = String((req.body || {}).mesa || '').toUpperCase();
    if (!/^[AB]\d{1,2}$/.test(mesa)) return res.status(400).json({ erro: 'Mesa inválida.' });
    const r = await pool.query(
      `SELECT id, aprovador, hora_abertura, hora_fecho, estado,
              to_char(hora_abertura AT TIME ZONE 'Europe/Lisbon', 'HH24:MI') AS abertura, to_char(hora_fecho AT TIME ZONE 'Europe/Lisbon', 'HH24:MI') AS fecho
       FROM registos WHERE mesa = $1 AND hora_abertura >= (((now() AT TIME ZONE 'Europe/Lisbon')::date - 1)::timestamp AT TIME ZONE 'Europe/Lisbon') ORDER BY id`, [mesa]);
    const hoje = plan.hojeLisboa();
    const lt = (await pool.query(`SELECT numero_provadores FROM lotes WHERE mesa = $1 AND data_planeamento = $2 AND ativo = true`, [mesa, hoje])).rows[0];
    res.json({ mesa, provadores: lt ? lt.numero_provadores : null, feitos: r.rows.filter((x) => x.estado === 'Fechado').length, registos: r.rows.filter((x) => new Date(x.hora_abertura).toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' }) === hoje) });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao obter as provas.' }); }
});
app.post('/api/supervisora/registo/:id', async (req, res) => {
  try {
    if (!verificarPin(req, res)) return;
    const id = Number(req.params.id);
    const b = req.body || {};
    const r0 = await pool.query(`SELECT * FROM registos WHERE id = $1`, [id]);
    if (!r0.rowCount) return res.status(404).json({ erro: 'Prova não encontrada.' });
    if (b.acao === 'apagar') {
      await pool.query(`DELETE FROM registos WHERE id = $1`, [id]);
      return res.json({ ok: true });
    }
    if (b.acao !== 'editar') return res.status(400).json({ erro: 'Ação inválida.' });
    const hoje = plan.hojeLisboa();
    const aprovador = b.aprovador === undefined ? r0.rows[0].aprovador : String(b.aprovador);
    const ap = await pool.query(`SELECT 1 FROM aprovadores WHERE nome = $1`, [aprovador]);
    if (!ap.rowCount) return res.status(400).json({ erro: 'Escolhe um provador da lista.' });
    const estado = b.estado === undefined ? r0.rows[0].estado : b.estado;
    if (!['Aberto', 'Fechado'].includes(estado)) return res.status(400).json({ erro: 'Estado: Aberto ou Fechado.' });
    if (b.abertura !== undefined && !hhmm(b.abertura)) return res.status(400).json({ erro: 'Hora de abertura inválida (HH:MM).' });
    if (b.fecho !== undefined && b.fecho !== null && b.fecho !== '' && !hhmm(b.fecho)) return res.status(400).json({ erro: 'Hora de fecho inválida (HH:MM).' });
    const sets = ['aprovador = $1', 'estado = $2'], vals = [aprovador, estado];
    if (b.abertura !== undefined) { vals.push(hoje, b.abertura); sets.push(`hora_abertura = ($${vals.length - 1}::date + $${vals.length}::time) AT TIME ZONE 'Europe/Lisbon'`); }
    if (estado === 'Aberto') sets.push('hora_fecho = NULL');
    else if (b.fecho !== undefined && b.fecho !== null && b.fecho !== '') { vals.push(hoje, b.fecho); sets.push(`hora_fecho = ($${vals.length - 1}::date + $${vals.length}::time) AT TIME ZONE 'Europe/Lisbon'`); }
    else if (!r0.rows[0].hora_fecho) sets.push('hora_fecho = now()');
    vals.push(id);
    try { await pool.query(`UPDATE registos SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals); }
    catch (e) { if (/uniq_mesa_aberta|duplicate/i.test(e.message)) return res.status(409).json({ erro: 'Já há outra prova aberta nesta mesa.' }); throw e; }
    const r = await pool.query(`SELECT id, aprovador, estado, to_char(hora_abertura AT TIME ZONE 'Europe/Lisbon', 'HH24:MI') AS abertura, to_char(hora_fecho AT TIME ZONE 'Europe/Lisbon', 'HH24:MI') AS fecho FROM registos WHERE id = $1`, [id]);
    res.json({ ok: true, registo: r.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao alterar a prova.' }); }
});

// editar uma ORDEM numa mesa (colocação): hoje ou amanhã
app.post('/api/supervisora/ordem', async (req, res) => {
  try {
    if (!verificarPin(req, res)) return;
    const b = req.body || {};
    const hoje = plan.hojeLisboa();
    const data = b.data || hoje;
    if (data !== hoje && data !== plan.diaUtilSeguinte(hoje)) return res.status(400).json({ erro: 'Só se editam as mesas de hoje ou de amanhã.' });
    const mesa = String(b.mesa || '').toUpperCase(), op = String(b.op || '').trim();
    const r = await pool.query(`SELECT * FROM lote_ops WHERE data = $1 AND mesa = $2 ORDER BY de`, [data, mesa]);
    const i = r.rows.findIndex((x) => x.op === op);
    if (i < 0) return res.status(404).json({ erro: 'Esta ordem não está nesta mesa.' });
    const cur = r.rows[i], seguinte = r.rows[i + 1];
    const n = { ...cur };
    if (b.novaOrdem !== undefined) {
      const nova = String(b.novaOrdem).trim();
      if (!/^\d{6,12}$/.test(nova) || !PREFIXOS_OP.some((p) => nova.startsWith(p))) return res.status(400).json({ erro: 'Nº de ordem inválido: só números e a começar por 150, 151 ou 950.' });
      if (nova !== op) { const dup = await pool.query(`SELECT 1 FROM lote_ops WHERE data = $1 AND op = $2`, [data, nova]); if (dup.rowCount) return res.status(409).json({ erro: 'Essa ordem já está colocada neste dia.' }); }
      n.op = nova;
    }
    if (b.rolhasPorFrasco !== undefined) { if (![1, 2, 4].includes(Number(b.rolhasPorFrasco))) return res.status(400).json({ erro: 'Rolhas por frasco: 1, 2 ou 4.' }); n.rolhas_por_frasco = Number(b.rolhasPorFrasco); }
    if (b.frascos !== undefined) {
      const f = Number(b.frascos);
      if (!Number.isInteger(f) || f < 1) return res.status(400).json({ erro: 'Frascos: número inteiro (1 ou mais).' });
      const ate = cur.de + f - 1;
      const lado = mesa[0], capM = plan.LAYOUT[lado].cap[mesa.slice(1)] || 0;
      if (ate > capM) return res.status(400).json({ erro: `A mesa ${mesa} só tem ${capM} frascos: com ${f} frascos a ordem passava do fim da mesa.` });
      if (seguinte && ate >= seguinte.de) return res.status(400).json({ erro: `Com ${f} frascos a ordem sobrepõe-se à ordem seguinte (que começa no frasco ${seguinte.de}).` });
      n.frascos = f; n.ate = ate;
    }
    if (b.frascosPartidos !== undefined) { const v = Number(b.frascosPartidos); if (!Number.isInteger(v) || v < 0) return res.status(400).json({ erro: 'Frascos partidos: número inteiro (0 ou mais).' }); n.frascos_partidos = v; }
    if (n.frascos_partidos > n.frascos) return res.status(400).json({ erro: 'Há mais frascos partidos do que frascos.' });
    if (b.rolhasPartidas !== undefined) {
      if (b.rolhasPartidas === null || b.rolhasPartidas === '') n.rolhas_partidas = null;
      else { const v = Number(b.rolhasPartidas); if (!Number.isInteger(v) || v < 0) return res.status(400).json({ erro: 'Rolhas partidas: número inteiro (0 ou mais).' }); n.rolhas_partidas = v; }
    }
    if (n.rolhas_partidas !== null && n.rolhas_partidas !== undefined && n.rolhas_partidas > n.frascos * n.rolhas_por_frasco) return res.status(400).json({ erro: 'Há mais rolhas partidas do que rolhas na ordem.' });
    if (b.qvs !== undefined) { const v = Number(b.qvs); if (!Number.isInteger(v) || v < 0) return res.status(400).json({ erro: 'QVs: número inteiro (0 ou mais).' }); n.qvs = v; }
    if (b.contadeira !== undefined) { if (typeof b.contadeira !== 'boolean') return res.status(400).json({ erro: 'Contadeira: sim ou não.' }); n.contadeira = b.contadeira; }
    if (b.dsrol !== undefined) { if (typeof b.dsrol !== 'boolean') return res.status(400).json({ erro: 'DSROL: sim ou não.' }); n.dsrol = b.dsrol; }
    if (b.tipo !== undefined) { if (!['EUR', 'GRUPO', 'AMOSTRA'].includes(String(b.tipo))) return res.status(400).json({ erro: 'Tipo: EUR, GRUPO ou AMOSTRA.' }); n.tipo = b.tipo; }
    // o que o MISU apontou tem de continuar a caber nas rolhas da ordem
    const rolhas = n.frascos * n.rolhas_por_frasco;
    const contam = (n.contadeira ? 0 : (n.misu_ligeiros || 0)) + (n.misu_fortes || 0) + (n.rolhas_partidas !== null && n.rolhas_partidas !== undefined ? n.rolhas_partidas : n.frascos_partidos * n.rolhas_por_frasco);
    if (contam > rolhas) return res.status(400).json({ erro: 'O que já foi apontado (ligeiros, fortes e partidas) passa as rolhas da ordem. Corrige primeiro o MISU.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE lote_ops SET op = $1, frascos = $2, ate = $3, rolhas_por_frasco = $4, frascos_partidos = $5, qvs = $6, contadeira = $7, tipo = $8, dsrol = $9, rolhas_partidas = $13 WHERE data = $10 AND mesa = $11 AND op = $12`,
        [n.op, n.frascos, n.ate, n.rolhas_por_frasco, n.frascos_partidos, n.qvs, n.contadeira, n.tipo, n.dsrol, data, mesa, op, n.rolhas_partidas === undefined ? null : n.rolhas_partidas]);
      await recalcularLote(client, data, mesa);
      // as propriedades da ORDEM (nº, rolhas por frasco, tipo, contadeira, DSROL) valem para todas as mesas onde ela está
      const outras = await client.query(`SELECT DISTINCT mesa FROM lote_ops WHERE data = $1 AND op = $2 AND mesa <> $3`, [data, op, mesa]);
      for (const x of outras.rows) {
        await client.query(`UPDATE lote_ops SET op = $1, rolhas_por_frasco = $2, contadeira = $3, tipo = $4, dsrol = $5 WHERE data = $6 AND op = $7 AND mesa = $8`,
          [n.op, n.rolhas_por_frasco, n.contadeira, n.tipo, n.dsrol, data, op, x.mesa]);
        await recalcularLote(client, data, x.mesa);
      }
      if (n.op !== op) {
        await client.query(`INSERT INTO ordens (op, encomenda, rolhas_adicionais, aceite_falta) SELECT $1, encomenda, rolhas_adicionais, aceite_falta FROM ordens WHERE op = $2 ON CONFLICT (op) DO NOTHING`, [n.op, op]);
        await client.query(`UPDATE ordens_dia SET op = $1 WHERE data = $2 AND op = $3`, [n.op, data, op]);
        await client.query(`DELETE FROM ordens WHERE op = $1 AND NOT EXISTS (SELECT 1 FROM ordens_dia WHERE op = $1)`, [op]);
      }
      if (b.continua !== undefined) { if (typeof b.continua !== 'boolean') throw new Error('continua'); await client.query(`UPDATE ordens_dia SET continua = $1 WHERE data = $2 AND op = $3`, [b.continua, data, n.op]); }
      if (b.encomenda !== undefined) {
        const e = Number(b.encomenda);
        if (!Number.isInteger(e) || e < 1) throw new Error('encomenda');
        await client.query(`UPDATE ordens SET encomenda = $1 WHERE op = $2`, [e, n.op]);
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); if (e.message === 'continua' || e.message === 'encomenda') return res.status(400).json({ erro: e.message === 'continua' ? 'Continua amanhã: sim ou não.' : 'Quantidade encomendada: número inteiro (1 ou mais).' }); throw e; } finally { client.release(); }
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao alterar a ordem.' }); }
});

// ===================== Dados de teste: ordens colocadas na sexta 23/10 para a prova de HOJE (segunda 26/10) =====================
const ORDENS_TESTE = [
  // encomenda e "continua amanhã" são valores de exemplo (a supervisora pode corrigi-los no menu): a 15007565 continua amanhã
  { op: '15007565', frascos: 2993, rolhas: 2, tipo: 'GRUPO', contadeira: true,  dsrol: false, encomenda: 12000, continua: true },
  { op: '15102480', frascos: 25,   rolhas: 2, tipo: 'EUR',   contadeira: true,  dsrol: false, encomenda: 48,    continua: false },
  { op: '15102467', frascos: 230,  rolhas: 2, tipo: 'EUR',   contadeira: true,  dsrol: false, encomenda: 450,   continua: false },
  { op: '15102469', frascos: 7,    rolhas: 1, tipo: 'EUR',   contadeira: false, dsrol: false, encomenda: 7,     continua: false },
  { op: '15102470', frascos: 335,  rolhas: 1, tipo: 'EUR',   contadeira: false, dsrol: false, encomenda: 330,   continua: false },
  { op: '15102471', frascos: 401,  rolhas: 1, tipo: 'EUR',   contadeira: false, dsrol: false, encomenda: 395,   continua: false },
];
// Coloca as ordens de teste para HOJE (as que já lá estão são ignoradas). Com `provas`, dá as provas como concluídas
// nas primeiras mesas para se poder testar já o levantamento (MISU, contadeira, logística).
async function semearOrdensTeste({ provas, data: dataFixa } = {}) {
  const data = dataFixa || plan.hojeLisboa();
  const lado = plan.ladoDoDia(data);
  const client = await pool.connect();
  const colocadas = [];
  try {
    await client.query('BEGIN');
    for (const o of ORDENS_TESTE) {
      const ja = await client.query(`SELECT 1 FROM lote_ops WHERE data = $1 AND op = $2 LIMIT 1`, [data, o.op]);
      if (ja.rowCount) continue;
      const oc = await client.query(`SELECT mesa, MAX(ate)::int AS ate FROM lote_ops WHERE data = $1 GROUP BY mesa`, [data]);
      const a = alocar(lado, new Map(oc.rows.filter((r) => r.mesa[0] === lado).map((r) => [Number(r.mesa.slice(1)), r.ate])), o.frascos);
      if (a.semCapacidade > 0) continue;
      await client.query(`INSERT INTO ordens (op, encomenda) VALUES ($1, $2) ON CONFLICT (op) DO NOTHING`, [o.op, o.encomenda]);
      await client.query(`INSERT INTO ordens_dia (data, op, continua) VALUES ($1, $2, $3) ON CONFLICT (data, op) DO NOTHING`, [data, o.op, o.continua]);
      for (const s of a.segmentos) {
        await client.query(
          `INSERT INTO lote_ops (data, mesa, op, de, ate, frascos, rolhas_por_frasco, frascos_partidos, qvs, contadeira, tipo, dsrol, seq)
           VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,$8,$9,$10, COALESCE((SELECT MAX(seq) FROM lote_ops WHERE data = $1 AND mesa = $2), 0) + 1)`,
          [data, s.mesa, o.op, s.de, s.ate, s.frascos, o.rolhas, o.contadeira, o.tipo, o.dsrol]);
        await recalcularLote(client, data, s.mesa);
        colocadas.push(s.mesa);
      }
    }
    if (provas) {
      const nomes = (await client.query(`SELECT nome FROM aprovadores WHERE ativo = true ORDER BY nome`)).rows.map((r) => r.nome);
      const lotes = (await client.query(`SELECT mesa, numero_provadores FROM lotes WHERE data_planeamento = $1 AND ativo = true ORDER BY mesa`, [data])).rows
        .sort((a, b) => Number(a.mesa.slice(1)) - Number(b.mesa.slice(1)));
      const n = lotes.length;   // todas as mesas ficam com as provas feitas (prontas para o MISU)
      for (const l of lotes.slice(0, n)) {
        const ja = await client.query(`SELECT 1 FROM registos WHERE mesa = $1 AND hora_abertura >= ((now() AT TIME ZONE 'Europe/Lisbon')::date::timestamp AT TIME ZONE 'Europe/Lisbon') LIMIT 1`, [l.mesa]);
        if (ja.rowCount) continue;
        for (let k = 0; k < l.numero_provadores && k < nomes.length; k++) {
          await client.query(
            `INSERT INTO registos (mesa, aprovador, hora_abertura, hora_fecho, estado, ordem) VALUES ($1,$2, GREATEST(now() - ($3 || ' minutes')::interval, ((now() AT TIME ZONE 'Europe/Lisbon')::date::timestamp AT TIME ZONE 'Europe/Lisbon') + interval '1 minute'), GREATEST(now() - ($4 || ' minutes')::interval, ((now() AT TIME ZONE 'Europe/Lisbon')::date::timestamp AT TIME ZONE 'Europe/Lisbon') + interval '2 minutes'), 'Fechado', NULL)`,
            [l.mesa, nomes[(Number(l.mesa.slice(1)) + k) % nomes.length], String(200 - k * 40), String(190 - k * 40)]);
        }
      }
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  const r = await pool.query(`SELECT COUNT(*)::int AS n FROM lotes WHERE data_planeamento = $1`, [data]);
  return { data, lado, mesas: r.rows[0].n };
}
app.post('/api/supervisora/seed-teste', async (req, res) => {
  try {
    if (!verificarPin(req, res)) return;
    res.json({ ok: true, ...(await semearOrdensTeste({ provas: (req.body || {}).provas === true })) });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao carregar as ordens de teste.' }); }
});

// --- Supervisora: limpar todos os dados de teste (começar do zero) ---
app.post('/api/supervisora/reset', async (req, res) => {
  try {
    if (!verificarPin(req, res)) return;
    if ((req.body || {}).confirmar !== 'APAGAR') return res.status(400).json({ erro: 'Falta a confirmação.' });
    await pool.query('DELETE FROM registos');
    await pool.query('DELETE FROM contagens_op');
    await pool.query('DELETE FROM lote_ops');
    await pool.query('DELETE FROM ordens_dia');
    await pool.query('DELETE FROM ordens');
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
    const colocadaPorOrdem = (await pool.query(`SELECT 1 FROM lote_ops WHERE data = $1 AND mesa = $2 LIMIT 1`, [hoje, mesa])).rowCount > 0;
    if (colocadaPorOrdem && ['ordem', 'tipo', 'rolhasPorFrasco', 'totalFrascosCliente', 'contadeira', 'dsrol', 'frascosPartidos', 'qvsColocacao'].some((k) => b[k] !== undefined)) {
      return res.status(400).json({ erro: 'Esta mesa foi colocada por ordem: para mudar a colocação tira a ordem (Colocar) e volta a colocá-la.' });
    }
    if (colocadaPorOrdem) {
      const sr = await pool.query(`SELECT * FROM lote_ops WHERE data = $1 AND mesa = $2 ORDER BY de`, [hoje, mesa]);
      l._segs = sr.rows.map(segFormatado);
      if (b.misu && (b.misu.ligeiros !== undefined || b.misu.fortes !== undefined)) return res.status(400).json({ erro: 'Esta mesa tem ordens: corrige o MISU por ordem.' });
    }
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
    if (!nao(b.provadores)) { const n = Number(b.provadores); if (!Number.isInteger(n) || n < 1 || n > 6) return res.status(400).json({ erro: 'Nº de provadores: 1 a 6.' }); set('numero_provadores', n); }
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
    // correção do MISU por ordem (mesas colocadas por ordem)
    const mo = b.misuOrdens && typeof b.misuOrdens === 'object' ? b.misuOrdens : null;
    const mudaOrdens = [];
    if (mo && colocadaPorOrdem) {
      for (const op of Object.keys(mo)) {
        const sg = l._segs.find((s) => s.op === op);
        if (!sg) return res.status(400).json({ erro: `A ordem ${op} não está nesta mesa.` });
        const lig = sg.contadeira ? 0 : (mo[op].ligeiros === undefined || mo[op].ligeiros === null || mo[op].ligeiros === '' ? sg.ligeiros : Number(mo[op].ligeiros));
        const fort = mo[op].fortes === undefined || mo[op].fortes === null || mo[op].fortes === '' ? sg.fortes : Number(mo[op].fortes);
        if (![lig, fort].every((x) => x === null || (Number.isInteger(x) && x >= 0))) return res.status(400).json({ erro: `MISU (ordem ${op}): números inteiros (0 ou mais).` });
        if ((lig || 0) + (fort || 0) + sg.rolhasPartidas > sg.rolhas) return res.status(400).json({ erro: `Ordem ${op}: ligeiras + fortes + partidas é mais do que as ${sg.rolhas} rolhas da ordem.` });
        sg.ligeiros = lig; sg.fortes = fort; mudaOrdens.push(sg);
      }
    }
    for (const sg of mudaOrdens) await pool.query(`UPDATE lote_ops SET misu_ligeiros = $1, misu_fortes = $2 WHERE data = $3 AND mesa = $4 AND op = $5`, [sg.ligeiros, sg.fortes, hoje, mesa, sg.op]);
    if (mudaOrdens.length && l._segs.every((s) => s.fortes !== null && (s.contadeira || s.ligeiros !== null))) {
      await pool.query(`UPDATE lotes SET misu_ligeiros = $1, misu_fortes = $2, misu_em = COALESCE(misu_em, now()) WHERE id = $3`,
        [l._segs.reduce((t, s) => t + (s.ligeiros || 0), 0), l._segs.reduce((t, s) => t + (s.fortes || 0), 0), l.id]);
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

// ---- Calendário: dias úteis (segunda a sexta + sábados que a supervisora incluiu) ----
async function carregarDiasExtra() {
  const r = await pool.query(`SELECT to_char(data, 'YYYY-MM-DD') AS d FROM dias_extra ORDER BY data`);
  plan.definirDiasExtra(r.rows.map((x) => x.d));
  return r.rows.map((x) => x.d);
}
app.get('/api/calendario', async (req, res) => {
  try {
    const extras = await carregarDiasExtra();
    const hoje = plan.hojeLisboa();
    res.json({ hoje, proximo: plan.diaUtilSeguinte(hoje), extras, hojeUtil: plan.ehDiaUtil(hoje) });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao obter o calendário.' }); }
});
app.post('/api/supervisora/dias-extra', async (req, res) => {
  try {
    if (!verificarPin(req, res)) return;
    const { acao } = req.body || {};
    const data = String((req.body || {}).data || '');
    if (acao === 'adicionar' || acao === 'remover') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || new Date(data + 'T00:00:00Z').getUTCDay() !== 6) return res.status(400).json({ erro: 'Escolhe uma data que seja sábado.' });
      if (acao === 'adicionar') {
        if (data < plan.hojeLisboa()) return res.status(400).json({ erro: 'Só se incluem sábados de hoje em diante.' });
        await pool.query(`INSERT INTO dias_extra (data) VALUES ($1) ON CONFLICT DO NOTHING`, [data]);
      } else {
        const em = await pool.query(`SELECT 1 FROM lotes WHERE data_planeamento = $1 UNION SELECT 1 FROM lote_ops WHERE data = $1 LIMIT 1`, [data]);
        if (em.rowCount) return res.status(409).json({ erro: 'Há mesas colocadas nesse sábado. Tira-as primeiro.' });
        await pool.query(`DELETE FROM dias_extra WHERE data = $1`, [data]);
      }
    } else if (acao !== 'listar') return res.status(400).json({ erro: 'Ação inválida.' });
    const extras = await carregarDiasExtra();
    res.json({ ok: true, extras, proximo: plan.diaUtilSeguinte(plan.hojeLisboa()) });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro ao alterar os dias úteis.' }); }
});
app.get('/api/saude', (req, res) => res.json({ ok: true }));

const fs = require('fs');
const path2 = require('path');

async function migrarEArrancar() {
  try {
    const sql = fs.readFileSync(path2.join(__dirname, 'migrations', 'schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('Migração/seed aplicados.');
    await carregarDiasExtra();
  } catch (err) {
    console.error('Aviso: falha ao aplicar migração automática:', err.message);
  }
  // CARGA INICIAL (uma só vez). Fica gravada na base de dados.
  // SEM_CARGA_INICIAL=1 desliga a carga de dados de teste (usar quando a app passar a produção)
  if ((!process.env.DS100_PGLITE || process.env.FORCAR_CARGA_INICIAL === '1') && process.env.SEM_CARGA_INICIAL !== '1') {
    try {
      // teste no gemba: as 6 ordens colocadas (sexta 23/10) para o dia do arranque, com as provas dos provadores já feitas
      const nome = 'carga_gemba_ordens_e_provas';
      const ja = await pool.query(`SELECT 1 FROM cargas_iniciais WHERE nome = $1`, [nome]);
      if (!ja.rowCount) {
        const r = await semearOrdensTeste({ data: process.env.CARGA_DATA || undefined, provas: true });
        await pool.query(`INSERT INTO cargas_iniciais (nome) VALUES ($1) ON CONFLICT DO NOTHING`, [nome]);
        console.log(`Carga inicial: ordens da prova de ${r.data} (lado ${r.lado}): ${r.mesas} mesas, com as provas feitas.`);
      }
    } catch (err) { console.error('Aviso: falha na carga inicial das ordens:', err.message); }
  }
  if (process.env.SEED_TESTE === '1') {
    try { const r = await semearOrdensTeste({ provas: process.env.SEED_TESTE_PROVAS === '1' }); console.log(`Ordens de teste carregadas para ${r.data} (lado ${r.lado}): ${r.mesas} mesas.`); }
    catch (err) { console.error('Aviso: falha ao carregar as ordens de teste:', err.message); }
  }
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`DS100 app a correr na porta ${PORT}`));
}

migrarEArrancar();
