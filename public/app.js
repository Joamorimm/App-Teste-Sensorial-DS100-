const estado = {
  aprovador: null,
  mesa: null,
  statusMesa: null,
  registoAbertoId: null,
  pollTimer: null,
};

const el = (id) => document.getElementById(id);

function mostrarTela(id) {
  if (id !== 'telaLogistica') pinSessao = null;   // sair da Logística termina a sessão da supervisora
  document.querySelectorAll('.tela').forEach((t) => t.classList.remove('ativa'));
  el(id).classList.add('ativa');
  const login = id === 'telaLogin';
  el('app').classList.toggle('modo-login', login);
  el('btnRefresh').style.display = id === 'telaHome' ? '' : 'none';   // restart só na página principal
  const comContador = ['telaScanner', 'telaCheck', 'telaOpen'].includes(id) && estado.aprovador;
  el('contadorMesasWrap').style.display = comContador ? 'inline-flex' : 'none';
  const titulos = {
    telaHome: 'Escolhe a área',
    telaLogin: 'Quem está a avaliar hoje?',
    telaScanner: 'Olá, ' + (estado.aprovador || ''),
    telaCheck: 'Mesa ' + (estado.mesa || ''),
    telaOpen: 'Análise em curso · Mesa ' + (estado.mesa || ''),
    telaLogistica: 'Logística',
    telaContadeira: 'Contadeira',
  };
  el('tituloHeader').textContent = titulos[id];
  el('btnVoltar').style.display = id === 'telaHome' ? 'none' : 'flex';
  if (estado.pollTimer) { clearInterval(estado.pollTimer); estado.pollTimer = null; }
}

// ---------- datas ----------
function dataPT(iso) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Calendário do servidor (segunda a sexta + sábados que a supervisora incluiu)
let calendario = null;
async function carregarCalendario() {
  try { const r = await fetch('/api/calendario'); if (r.ok) calendario = await r.json(); } catch (e) { /* offline: usa o cálculo local */ }
}
function proximoDiaUtil() {
  if (calendario && calendario.hoje === isoLocal(new Date())) return calendario.proximo;
  const d = new Date();
  do { d.setDate(d.getDate() + 1); } while ([0, 6].includes(d.getDay()));
  return isoLocal(d);
}


let todosAprovadores = [];
const semAcentos = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function renderAprovadores() {
  const ul = el('listaAprovadores');
  const q = semAcentos(el('buscaAprovador').value.trim());
  const lista = todosAprovadores.filter((a) => semAcentos(a.nome).includes(q));
  ul.innerHTML = '';
  if (!lista.length) { ul.innerHTML = '<li style="justify-content:center;color:#9aa39d;cursor:default;">Nenhum nome encontrado.</li>'; return; }
  lista.forEach((a) => {
    const li = document.createElement('li');
    const iniciais = a.nome.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
    li.innerHTML = `<div class="avatar">${iniciais}</div><span>${a.nome}</span><span class="chevron">&#8250;</span>`;
    li.onclick = () => selecionarAprovador(a.nome);
    ul.appendChild(li);
  });
}
el('buscaAprovador').addEventListener('input', renderAprovadores);

async function carregarAprovadores() {
  const ul = el('listaAprovadores');
  ul.innerHTML = '<li style="justify-content:center;color:#9aa39d;">A carregar...</li>';
  try {
    const r = await fetch('/api/aprovadores');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const lista = await r.json();
    ul.innerHTML = '';
    if (!lista.length) {
      ul.innerHTML = '<li style="justify-content:center;color:#9aa39d;">Sem provadores. Verifica a base de dados.</li>';
      return;
    }
    todosAprovadores = lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt', { sensitivity: 'base' }));
    renderAprovadores();
  } catch (e) {
    console.error('Erro ao carregar aprovadores', e);
    ul.innerHTML = `<li style="justify-content:center;color:#c23b2e;cursor:default;">Erro de ligação ao servidor.<br/><small>${e.message}</small></li>`;
  }
}

async function selecionarAprovador(nome) {
  estado.aprovador = nome;
  await atualizarContador();
  el('inputMesa').value = '';
  el('erroScanner').textContent = '';
  mostrarTela('telaScanner');
}

let _diaContador = isoLocal(new Date());
// à meia-noite os contadores zeram: volta a ler o valor do servidor quando o dia muda ou a app volta ao primeiro plano
setInterval(() => { const h = isoLocal(new Date()); if (h !== _diaContador) { _diaContador = h; atualizarContador(); } }, 30000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { _diaContador = isoLocal(new Date()); atualizarContador(); } });
async function atualizarContador() {
  if (!estado.aprovador) return;
  try {
    const r = await fetch(`/api/aprovador/${encodeURIComponent(estado.aprovador)}/mesas-hoje`);
    const d = await r.json();
    el('contadorMesas').textContent = `${d.mesas} mesas feitas hoje`;
    if (!el('telaLogin').classList.contains('ativa')) el('contadorMesasWrap').style.display = 'inline-flex';
  } catch (e) { /* silencioso */ }
}

el('btnVerificar').onclick = async () => {
  const mesa = el('inputMesa').value.trim().toUpperCase();
  el('erroScanner').textContent = '';
  if (!mesa) { el('erroScanner').textContent = 'Introduz o código da mesa.'; return; }
  estado.mesa = mesa;
  await consultarMesa();
};

async function consultarMesa() {
  try {
    const r = await fetch(`/api/mesa/${encodeURIComponent(estado.mesa)}?aprovador=${encodeURIComponent(estado.aprovador)}`);
    const d = await r.json();
    estado.statusMesa = d;

    if (d.mesaAbertaPorMim) {
      estado.registoAbertoId = d.registoAbertoId;
      abrirTelaOpen();
      return;
    }

    renderCheck(d);
    mostrarTela('telaCheck');
    estado.pollTimer = setInterval(consultarMesaSilencioso, 15000);
  } catch (e) {
    el('erroScanner').textContent = 'Erro de rede. Tenta novamente.';
  }
}

async function consultarMesaSilencioso() {
  try {
    const r = await fetch(`/api/mesa/${encodeURIComponent(estado.mesa)}?aprovador=${encodeURIComponent(estado.aprovador)}`);
    const d = await r.json();
    estado.statusMesa = d;
    if (!document.getElementById('telaCheck').classList.contains('ativa')) return;
    renderCheck(d);
  } catch (e) { /* silencioso */ }
}

function renderCheck(d) {
  el('checkMesa').textContent = d.mesa;
  el('checkOP').textContent = d.ordem || (d.planeado ? '-' : 'Não planeada');
  el('checkProvadores').textContent = d.planeado ? `${d.numeroProvadoresFeitos}/${d.numeroProvadoresNecessarios}` : '-';
  el('checkPartidos').textContent = d.planeado && d.frascosPartidos !== null ? `${d.frascosPartidos} (${d.rolhasPartidas ?? 0} rolhas)` : '-';

  const card = el('estadoCard');
  const btnAbrir = el('btnAbrir');
  btnAbrir.disabled = false;

  if (d.ladoErrado) {
    card.className = 'estado-pill estado-bloqueada';
    card.textContent = `⛔ Hoje é o lado ${d.ladoHoje}. A mesa ${d.mesa} é do lado ${d.mesa[0]} e não pode ser usada.`;
    btnAbrir.disabled = true;
  } else if (d.mesaAbertaPorOutro) {
    card.className = 'estado-pill estado-bloqueada';
    card.textContent = `⛔ Em uso por ${d.quemTemMesa} neste momento.`;
    btnAbrir.disabled = true;
  } else if (d.loteCompleto) {
    card.className = 'estado-pill estado-bloqueada';
    card.textContent = '⛔ Lote completo — já tem o número de provadores necessário.';
    btnAbrir.disabled = true;
  } else if (d.jaFezHoje) {
    card.className = 'estado-pill estado-bloqueada';
    card.textContent = '⛔ Já avaliaste esta mesa hoje.';
    btnAbrir.disabled = true;
  } else if (d.outraMesaAberta) {
    card.className = 'estado-pill estado-bloqueada';
    card.textContent = `⛔ Já tens a mesa ${d.outraMesaCodigo} aberta. Conclui essa primeiro.`;
    btnAbrir.disabled = true;
  } else if (!d.podeAbrir && d.minutosRestantes > 0) {
    card.className = 'estado-pill estado-bloqueada';
    card.textContent = `⛔ Bloqueada · fecho há ${d.minutosPassados} min. Disponível em ${d.minutosRestantes} min.`;
    btnAbrir.disabled = true;
  } else {
    card.className = 'estado-pill estado-livre';
    card.textContent = '✅ Mesa disponível.';
  }
}

el('btnAbrir').onclick = async () => {
  el('erroCheck').textContent = '';
  el('btnAbrir').disabled = true;
  try {
    const r = await fetch(`/api/mesa/${encodeURIComponent(estado.mesa)}/abrir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aprovador: estado.aprovador }),
    });
    const d = await r.json();
    if (!r.ok) {
      el('erroCheck').textContent = d.erro || 'Não foi possível abrir a mesa.';
      if (d.estado) renderCheck(d.estado);
      el('btnAbrir').disabled = false;
      return;
    }
    estado.registoAbertoId = d.registo.id;
    abrirTelaOpen(d.registo.hora_abertura);
  } catch (e) {
    el('erroCheck').textContent = 'Erro de rede. Tenta novamente.';
    el('btnAbrir').disabled = false;
  }
};

function abrirTelaOpen(horaAbertura) {
  el('openMesa').textContent = estado.mesa;
  const sm = estado.statusMesa;
  el('openPartidos').textContent = sm && sm.planeado && sm.frascosPartidos !== null ? `${sm.frascosPartidos} (${sm.rolhasPartidas ?? 0} rolhas)` : '-';
  el('openHora').textContent = horaAbertura
    ? new Date(horaAbertura).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })
    : '-';
  el('erroOpen').textContent = '';
  mostrarTela('telaOpen');
}

el('btnConcluir').onclick = async () => {
  el('erroOpen').textContent = '';
  el('btnConcluir').disabled = true;
  try {
    const r = await fetch(`/api/registo/${estado.registoAbertoId}/concluir`, { method: 'POST' });
    const d = await r.json();
    if (!r.ok) {
      el('erroOpen').textContent = d.erro || 'Não foi possível concluir.';
      el('btnConcluir').disabled = false;
      return;
    }
    await atualizarContador();
    el('inputMesa').value = '';
    mostrarTela('telaScanner');
  } catch (e) {
    el('erroOpen').textContent = 'Erro de rede. Tenta novamente.';
  }
  el('btnConcluir').disabled = false;
};

el('btnOutraMesa').onclick = () => {
  el('inputMesa').value = '';
  el('erroScanner').textContent = '';
  mostrarTela('telaScanner');
};

el('btnVoltar').onclick = () => {
  const ativa = document.querySelector('.tela.ativa').id;
  if (ativa === 'telaScanner') mostrarTela('telaLogin');
  else if (ativa === 'telaCheck' || ativa === 'telaOpen') mostrarTela('telaScanner');
  else mostrarTela('telaHome'); // login, logística, supervisão
};

carregarAprovadores();

el('btnRefresh').onclick = () => {   // restart da app (página principal)
  const b = el('btnRefresh');
  b.classList.remove('girar'); void b.offsetWidth; b.classList.add('girar');
  setTimeout(() => location.reload(), 250);
};

// ---------- Home ----------
el('tileProvadores').onclick = () => { el('buscaAprovador').value = ''; carregarAprovadores(); mostrarTela('telaLogin'); };
el('tileLogistica').onclick = async () => { await carregarCalendario(); mostrarTela('telaLogistica'); definirModo('colocar'); };

// ---------- Logística: levantar (hoje) e colocar mesas (amanhã) ----------
let logDados = null;
let logModo = 'levantar';       // 'levantar' | 'colocar'
let selecionadas = new Set();
const PREFIXOS_OP = ['150', '151', '950'];

let colocarHoje = false;        // só a supervisora: colocar as mesas de hoje (para testar no próprio dia)
function dataLogistica() { return (logModo === 'colocar' && !colocarHoje) || (logModo === 'editarMesas' && editDia === 'amanha') ? proximoDiaUtil() : isoLocal(new Date()); }

async function carregarLogistica() {
  try {
    const r = await fetch('/api/logistica/mesas?data=' + dataLogistica());
    const d = await r.json();
    if (!r.ok) throw new Error(d.erro);
    logDados = d;
    el('erroLog').textContent = '';
    renderLogistica();
    if (logModo === 'levantar' && levVista === 'ordens') await renderOrdensLev();
  } catch (e) { el('erroLog').textContent = 'Não foi possível atualizar o mapa.'; }
}

let editDia = 'hoje';   // no menu da supervisora (colocação e levantamento): mesas de hoje ou de amanhã
let levVista = 'mesas';   // no Levantar: 'mesas' (MISU) ou 'ordens' (logística)
function aplicarVistaLev() {
  const hub = logModo === 'editar';
  const ordens = logModo === 'levantar' && levVista === 'ordens';
  el('logTopo').style.display = hub || ordens ? 'none' : '';
  el('logMapa').style.display = hub || ordens ? 'none' : '';
  el('logResumoLev').style.display = !ordens && ['levantar', 'editarMesas', 'editarProvas'].includes(logModo) ? '' : 'none';
  el('legLev').style.display = !ordens && ['levantar', 'editarMesas', 'editarProvas'].includes(logModo) ? '' : 'none';
  el('levOrdens').style.display = ordens ? '' : 'none';
  el('segVistaLev').querySelectorAll('button').forEach((b) => b.classList.toggle('ativa', b.dataset.v === levVista));
}
el('segVistaLev').querySelectorAll('button').forEach((b) => { b.onclick = () => { levVista = b.dataset.v; aplicarVistaLev(); carregarLogistica(); }; });
function definirModo(modo, hojeTeste) {
  logModo = modo;
  colocarHoje = modo === 'colocar' && !!hojeTeste;
  if (modo === 'editar' || modo === 'editarMesas') { if (modo === 'editar') editDia = 'hoje'; definirSeg('segEditDia', editDia); }
  const edit = ['editar', 'editarMesas', 'editarProvas'].includes(modo);
  // a palavra-passe da supervisora só vale enquanto se está no menu dela: ao sair, volta a pedir
  if (!edit && !(modo === 'colocar' && hojeTeste)) pinSessao = null;
  const hub = modo === 'editar';
  el('editHub').style.display = hub ? '' : 'none';
  el('editVoltar').style.display = modo === 'editarMesas' || modo === 'editarProvas' ? '' : 'none';
  el('editDiaBox').style.display = modo === 'editarMesas' ? '' : 'none';
  selecionadas = new Set();
  el('abaLevantar').classList.toggle('ativa', modo === 'levantar');
  el('abaColocar').classList.toggle('ativa', modo === 'colocar' && !hojeTeste);
  el('abaEditar').classList.toggle('ativa', edit);
  el('logResumoLev').style.display = modo === 'levantar' || modo === 'editarMesas' || modo === 'editarProvas' ? '' : 'none';
  el('legLev').style.display = modo === 'levantar' || modo === 'editarMesas' || modo === 'editarProvas' ? '' : 'none';
  el('legCol').style.display = modo === 'colocar' ? '' : 'none';
  el('colForm').style.display = modo === 'colocar' ? '' : 'none';
  el('levVista').style.display = modo === 'levantar' ? '' : 'none';
  aplicarVistaLev();
  if (estado.pollTimer) { clearInterval(estado.pollTimer); estado.pollTimer = null; }
  if (modo === 'levantar') estado.pollTimer = setInterval(carregarLogistica, 15000);
  limparMensagensCol();
  if (modo === 'colocar') limparFormColocacao();   // cada introdução começa sem os dados da anterior
  if (!hub) carregarLogistica();
}
el('abaLevantar').onclick = () => definirModo('levantar');
let pinSessao = null; // palavra-passe da supervisora (só em memória, enquanto a app está aberta)
function pedirPin() {
  return new Promise((resolve) => {
    el('pinInput').value = ''; el('pinErro').textContent = '';
    el('modalPin').style.display = 'flex';
    setTimeout(() => el('pinInput').focus(), 100);
    const fechar = (v) => { el('modalPin').style.display = 'none'; resolve(v); };
    el('pinCancel').onclick = () => fechar(false);
    const entrar = async () => {
      const pin = el('pinInput').value.trim();
      if (!pin) { el('pinErro').textContent = 'Escreve a palavra-passe.'; return; }
      try {
        const r = await fetch('/api/logistica/pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
        const d = await r.json();
        if (!r.ok) { el('pinErro').textContent = d.erro || 'Palavra-passe incorreta.'; el('pinInput').value = ''; return; }
        pinSessao = pin; fechar(true);
      } catch (e) { el('pinErro').textContent = 'Erro de ligação ao servidor.'; }
    };
    el('pinOk').onclick = entrar;
    el('pinInput').onkeydown = (ev) => { if (ev.key === 'Enter') entrar(); };
  });
}
el('abaColocar').onclick = () => definirModo('colocar');   // sem palavra-passe: a logística coloca as mesas de amanhã
el('btnHistorico').onclick = async () => {
  try {
    const r = await fetch('/api/supervisora/movimentos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: pinSessao }) });
    if (!r.ok) { const d = await r.json(); if (r.status === 401) pinSessao = null; throw new Error(d.erro || 'Erro'); }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a'); a.href = url; a.download = 'historico_movimentos_DS100_' + isoLocal(new Date()) + '.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { el('erroLog').textContent = e.message; }
};
async function folhaVersoes() {
  let lista;
  try { lista = (await enviar('/api/supervisora/versoes', { pin: pinSessao })).versoes; }
  catch (e) { if (/palavra-passe/i.test(e.message)) pinSessao = null; alert(e.message); return; }
  abrirFolha(`<h3>Restaurar versão anterior</h3>
    <div class="aviso-hand">Volta aos dados (mesas, ordens, provas, MISU, contadeira, levantamentos) tal como estavam nessa hora. Antes de restaurar, a app guarda o estado atual (podes voltar atrás). O histórico de movimentos mantém-se.</div>
    ${lista.length ? lista.map((v) => `<div class="prop-linha"><b>${v.quando}</b> · ${esc(v.motivo || '')}<br/><small>${esc(v.resumo || '')}</small>
      <button class="secundario" data-v="${v.id}" style="margin-top:6px;">Restaurar esta versão</button></div>`).join('') : '<div class="aviso-hand">Ainda não há versões guardadas.</div>'}
    <button class="secundario" id="vsX">Fechar</button><div class="msg-erro" id="vsErro"></div>`);
  el('vsX').onclick = fecharFolha;
  el('sheetBox').querySelectorAll('button[data-v]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Restaurar esta versão? Os dados atuais serão substituídos (fica uma cópia do estado atual).')) return;
      try { await enviar('/api/supervisora/versoes/restaurar', { pin: pinSessao, id: Number(b.dataset.v) }); fecharFolha(); alert('Versão restaurada.'); }
      catch (e) { if (/palavra-passe/i.test(e.message)) pinSessao = null; el('vsErro').textContent = e.message; }
    };
  });
}
el('hubVersoes').onclick = () => folhaVersoes();
el('abaEditar').onclick = async () => {                     // só a supervisora, com palavra-passe
  if (!pinSessao && !(await pedirPin())) return;
  definirModo('editar');
};
el('btnHub').onclick = () => definirModo('editar');
el('hubMesas').onclick = () => definirModo('editarMesas');
el('hubProvas').onclick = () => definirModo('editarProvas');
el('hubProvadores').onclick = () => folhaProvadores();
el('hubDias').onclick = () => folhaDias();
async function folhaDias(extras) {
  try { if (!extras) extras = (await enviar('/api/supervisora/dias-extra', { pin: pinSessao, acao: 'listar' })).extras; }
  catch (e) { if (/palavra-passe/i.test(e.message)) pinSessao = null; alert(e.message); return; }
  abrirFolha(`<h3>Dias de trabalho</h3>
    <div class="aviso-hand">Por defeito são segunda a sexta. Aqui incluis um <b>sábado</b> como dia útil (exceção). O lado A/B continua a alternar pelos dias úteis, por isso o dia seguinte ao sábado muda de lado.</div>
    <div class="sheet-campo"><label>Sábado a incluir</label><input type="date" id="diaNovo" /></div>
    <button class="primario" id="diaAdd" style="margin-top:0;">Incluir este sábado</button>
    ${extras.length ? extras.map((d) => `<div class="prop-linha"><b>${dataPT(d)}</b> · sábado de trabalho <button class="secundario" data-rm="${d}" style="margin-top:6px;">Tirar</button></div>`).join('') : '<div class="dica" style="margin-top:10px;">Nenhum sábado incluído.</div>'}
    <button class="secundario" id="diaX">Fechar</button>
    <div class="msg-erro" id="diaErro"></div>`);
  el('diaX').onclick = fecharFolha;
  const agir = async (corpo) => {
    el('diaErro').textContent = '';
    try { const r = await enviar('/api/supervisora/dias-extra', { pin: pinSessao, ...corpo }); await carregarCalendario(); folhaDias(r.extras); }
    catch (e) { if (/palavra-passe/i.test(e.message)) pinSessao = null; el('diaErro').textContent = e.message; }
  };
  el('diaAdd').onclick = () => agir({ acao: 'adicionar', data: el('diaNovo').value });
  el('sheetBox').querySelectorAll('button[data-rm]').forEach((b) => { b.onclick = () => agir({ acao: 'remover', data: b.dataset.rm }); });
}
el('segEditDia').querySelectorAll('button').forEach((b) => { b.onclick = () => { editDia = b.dataset.v; definirModo('editarMesas'); }; });

function renderLogistica() {
  const d = logDados;
  const por = new Map(d.mesas.map((m) => [parseInt(m.mesa.slice(1), 10), m]));
  el('logTopo').innerHTML = logModo === 'colocar'
    ? `Data de logística: <b>${dataPT(isoLocal(new Date()))}</b> · Data da prova: <b>${dataPT(d.data)}</b>${colocarHoje ? ' (teste, supervisora)' : ''} · lado <b>${d.lado}</b><br/>Escreve a ordem para calcular as mesas · toca numa mesa para ver as suas ordens`
    : logModo === 'editarMesas' || logModo === 'editarProvas'
    ? `Modo supervisora · ${logModo === 'editarProvas' ? 'toca numa mesa para ver, editar ou apagar as provas de hoje' : 'toca numa mesa de ' + (editDia === 'amanha' ? 'amanhã' : 'hoje') + ' para editar'}`
    : `Lado <b>${d.lado}</b> · ${d.mesas.filter((m) => m.estado === 'em_prova').length} em prova · atualiza sozinho`;
  el('kVerdes').textContent = d.mesas.filter((m) => m.estado === 'pronta').length;
  el('kVerm').textContent = d.mesas.filter((m) => m.estado === 'misu').length;
  el('kLev').textContent = d.mesas.filter((m) => m.estado === 'levantada').length;
  let html = '';
  d.filas.forEach((fila, idx) => {
    html += '<div class="log-fila">';
    fila.forEach((n) => {
      const m = por.get(n); if (!m) return;
      let sub = '';
      if (logModo === 'colocar' || (logModo === 'editarMesas' && editDia === 'amanha')) sub = m.capacidade ? `${m.ocupado || 0}/${m.capacidade}${(m.segmentos || []).length > 1 ? ' · ' + m.segmentos.length + ' ord.' : ''}` : '';
      else sub = { sem_lote: '', levantada: 'levantada', misu: 'MISU', pronta: 'logística', colocada: 'colocada' }[m.estado] ?? `${m.feitos}/${m.necessarios}`;
      const sel = logModo === 'colocar' && selecionadas.has(m.mesa) ? ' sel' : '';
      html += `<div class="mesa ${m.estado}${sel}${fila.length === 1 ? ' solta' : ''}" data-mesa="${m.mesa}">${m.mesa}<small>${sub}</small></div>`;
    });
    html += '</div>';
    if (idx % 2 === 1) html += '<div class="log-corredor">corredor</div>';
  });
  el('logMapa').innerHTML = html;
  el('logMapa').querySelectorAll('.mesa').forEach((n) => {
    n.onclick = () => (logModo === 'colocar' ? folhaMesaColocada(n.dataset.mesa) : logModo === 'editarMesas' ? (editDia === 'amanha' ? folhaEditarAmanha(n.dataset.mesa) : folhaEditar(n.dataset.mesa)) : logModo === 'editarProvas' ? folhaProvasMesa(n.dataset.mesa) : abrirMesaMapa(n.dataset.mesa));
  });
}

// ----- Colocar POR ORDEM: o nº de ordem dispara o cálculo das mesas (layout + capacidade de frascos) -----
let proposta = null;   // última proposta calculada
function limparMensagensCol() { el('erroCol').textContent = ''; el('okCol').style.display = 'none'; }
function atualizarResumoCol() {
  const r = Number(valorSeg('segRolhas')) || 0;
  const f = Number(el('colTotal').value) || 0;
  el('colResumo').innerHTML = r && f
    ? `Total de rolhas da ordem = ${fmt(f)} frascos × ${r} = <b>${fmt(f * r)}</b>`
    : 'Indica os frascos e as rolhas por frasco para ver o total de rolhas.';
  if (proposta) cancelarProposta();   // mudou algo: a proposta deixa de valer
}
function limparFormColocacao() {
  ['colOrdem', 'colTotal', 'colEnc'].forEach((id) => { el(id).value = ''; });
  ['segRolhas', 'segTipo', 'segContadeira', 'segDsrol', 'segContinua'].forEach((id) => definirSeg(id, null));
  el('dicaEnc').textContent = 'Total da ordem, mesmo que continue noutros dias';
  proposta = null; selecionadas = new Set();
  el('colProposta').style.display = 'none'; el('colProposta').innerHTML = '';
  el('okCol').style.display = 'none'; el('erroCol').textContent = '';
  atualizarResumoCol(); validarOrdem();
}
el('btnLimparCol').onclick = () => { limparFormColocacao(); limparMensagensCol(); if (logDados) renderLogistica(); };   // apaga tudo de uma vez
function cancelarProposta() {
  proposta = null; selecionadas = new Set();
  el('colProposta').style.display = 'none'; el('colProposta').innerHTML = '';
  if (logDados) renderLogistica();
}
function definirSeg(id, v) {
  el(id).querySelectorAll('button').forEach((b) => b.classList.toggle('ativa', b.dataset.v === v));
}
function valorSeg(id) { const b = el(id).querySelector('button.ativa'); return b ? b.dataset.v : null; }
['segTipo', 'segRolhas', 'segContadeira', 'segDsrol', 'segContinua'].forEach((id) => {
  el(id).querySelectorAll('button').forEach((b) => { b.onclick = () => { definirSeg(id, b.dataset.v); atualizarResumoCol(); }; });
});
function ordemValida(v) { return /^\d{6,12}$/.test(v) && PREFIXOS_OP.some((p) => v.startsWith(p)); }
function validarOrdem() {
  const v = el('colOrdem').value.trim();
  const dica = el('dicaOrdem');
  const mau = v.length >= 3 && !PREFIXOS_OP.some((p) => v.startsWith(p));
  dica.classList.toggle('erro', mau);
  dica.textContent = mau ? 'Nº de ordem inválido: tem de começar por 150, 151 ou 950' : 'Tem de começar por 150, 151 ou 950';
}
el('colTotal').addEventListener('input', atualizarResumoCol);
el('colOrdem').addEventListener('input', () => { el('colOrdem').value = el('colOrdem').value.replace(/\D/g, ''); validarOrdem(); if (proposta) cancelarProposta(); infoOrdemExistente(); });
let _infoTimer = null;
function infoOrdemExistente() {   // ordem que já vem de outros dias: mostra o que já foi aprovado e a encomenda
  clearTimeout(_infoTimer);
  const op = el('colOrdem').value.trim();
  if (!ordemValida(op)) { el('dicaEnc').textContent = 'Total da ordem, mesmo que continue noutros dias'; return; }
  _infoTimer = setTimeout(async () => {
    try {
      const r = await fetch('/api/ordem/' + op); const d = await r.json();
      if (el('colOrdem').value.trim() !== op || !d.existe) return;
      if (!el('colEnc').value) el('colEnc').value = d.encomenda;
      el('dicaEnc').textContent = `Ordem já iniciada: encomenda ${fmt(d.encomenda)} rolhas · aprovadas em dias anteriores ${fmt(d.anteriores)}${d.rolhasAdicionais ? ' · acrescentadas ' + fmt(d.rolhasAdicionais) : ''}`;
    } catch (e) { /* sem info */ }
  }, 300);
}

function dadosOrdem() {
  const ordem = el('colOrdem').value.trim();
  const rolhas = valorSeg('segRolhas'), tipo = valorSeg('segTipo'), cont = valorSeg('segContadeira'), dsrol = valorSeg('segDsrol');
  const frascos = Number(el('colTotal').value);
  if (!ordemValida(ordem)) throw new Error('Nº de ordem inválido: só números e a começar por 150, 151 ou 950.');
  if (!Number.isInteger(frascos) || frascos < 1) throw new Error('Indica a quantidade de frascos da ordem.');
  if (!rolhas) throw new Error('Escolhe as rolhas por frasco (1, 2 ou 4).');
  if (!tipo) throw new Error('Escolhe o tipo: EUR, GRUPO ou AMOSTRA.');
  if (!cont) throw new Error('Indica se tem contadeira (Sim ou Não).');
  if (!dsrol) throw new Error('Indica DSROL (Sim ou Não).');
  const encomenda = Number(el('colEnc').value), cc = valorSeg('segContinua');
  if (!Number.isInteger(encomenda) || encomenda < 1) throw new Error('Indica a quantidade encomendada (nº de rolhas).');
  if (!cc) throw new Error('Indica se a ordem continua amanhã (Sim ou Não).');
  return { encomenda, continua: cc === 'sim', data: dataLogistica(), ordem, frascos, rolhasPorFrasco: Number(rolhas), tipo, contadeira: cont === 'sim', dsrol: dsrol === 'sim', pin: colocarHoje ? pinSessao : undefined };
}
el('btnCalcular').onclick = async () => {
  limparMensagensCol();
  try {
    const dados = dadosOrdem();
    const p = await enviar('/api/logistica/ordem/proposta', dados);
    proposta = { dados, ...p };
    selecionadas = new Set(p.segmentos.map((s) => s.mesa));
    const linhas = p.segmentos.map((s, i) => `<div class="prop-linha" data-mesa="${s.mesa}">
        <div><b>${s.jaTem > 0 ? `${s.mesa}-${s.seq}` : s.mesa}</b> · frascos ${s.de}–${s.ate} (${fmt(s.frascos)} frascos · ${fmt(s.rolhas)} rolhas)${s.jaTem > 0 ? `<br/><small>A mesa ${s.mesa} já tem ${s.jaTem} ${s.jaTem === 1 ? 'ordem' : 'ordens'}: esta fica ${s.mesa}-${s.seq} (a mesa vai ter mais ordens).</small>` : ''}</div>
        <div class="prop-campos">
          <label>Frascos partidos<input type="number" inputmode="numeric" min="0" max="${s.frascos}" placeholder="0" class="pPart" /></label>
          <label>QVs (rolhas)<input type="number" inputmode="numeric" min="0" placeholder="0" class="pQv" /></label>
        </div></div>`).join('');
    el('colProposta').innerHTML = `<div class="bloco-rolhas"><b>Proposta:</b> ${fmt(p.frascos)} frascos × ${p.rolhasPorFrasco} = ${fmt(p.totalRolhas)} rolhas em ${p.segmentos.length} ${p.segmentos.length === 1 ? 'mesa' : 'mesas'} (lado ${p.lado})</div>
      ${p.semCapacidade > 0 ? `<div class="aviso-hand">Sem espaço para ${fmt(p.semCapacidade)} frascos neste lado.</div>` : ''}
      ${linhas}
      <button class="primario" id="btnConfirmarOrdem" ${p.semCapacidade > 0 ? 'disabled' : ''}>Confirmar colocação</button>
      <button class="secundario" id="btnCancelarOrdem">Cancelar</button>`;
    el('colProposta').style.display = '';
    el('btnCancelarOrdem').onclick = cancelarProposta;
    el('btnConfirmarOrdem').onclick = confirmarOrdem;
    renderLogistica();
  } catch (e) { el('erroCol').textContent = e.message; }
};
async function confirmarOrdem() {
  limparMensagensCol();
  const dados = proposta.dados;
  const distribuicao = [...el('colProposta').querySelectorAll('.prop-linha')].map((l) => ({
    mesa: l.dataset.mesa,
    partidos: l.querySelector('.pPart').value.trim() === '' ? 0 : Number(l.querySelector('.pPart').value),
    qvs: l.querySelector('.pQv').value.trim() === '' ? 0 : Number(l.querySelector('.pQv').value),
  }));
  el('btnConfirmarOrdem').disabled = true;
  try {
    const r = await enviar('/api/logistica/ordem/confirmar', { ...dados, distribuicao });
    limparFormColocacao();           // cada introdução começa limpa
    el('okCol').textContent = `Colocada: OP ${dados.ordem} em ${r.mesas.join(', ')}${dados.continua ? ' (continua amanhã)' : ''}.`;
    el('okCol').style.display = '';
    await carregarLogistica();
  } catch (e) { el('erroCol').textContent = e.message; if (/palavra-passe/i.test(e.message)) pinSessao = null; if (el('btnConfirmarOrdem')) el('btnConfirmarOrdem').disabled = false; }
}
// tocar numa mesa no ecrã de colocação: ver as ordens que lá estão e tirar uma ordem
function folhaMesaColocada(codigo) {
  const m = logDados.mesas.find((x) => x.mesa === codigo);
  if (!m) return;
  const segs = m.segmentos || [];
  const linhas = segs.length ? segs.map((s) => `<div class="prop-linha"><div><b>${segs.length > 1 ? `${m.mesa}-${s.seq || '?'} · ` : ''}OP ${s.op}</b> · frascos ${s.de}–${s.ate} (${fmt(s.frascos)} frascos × ${s.rolhasPorFrasco} = ${fmt(s.rolhas)} rolhas)<br/>Partidos: ${fmt(s.frascosPartidos)} (${fmt(s.rolhasPartidas)} rolhas) · QVs: ${fmt(s.qvs)} · ${s.contadeira ? 'contadeira' : 'sem contadeira'} · ${s.tipo}${s.dsrol ? ' · DSROL' : ''}</div>
      <button class="secundario" data-op="${s.op}" style="margin-top:6px;">Tirar esta ordem</button></div>`).join('')
    : '<div class="aviso-hand">Mesa livre: sem ordens.</div>';
  abrirFolha(`<h3>Mesa ${m.mesa}</h3>
    <div class="bloco-rolhas">Capacidade: <b>${fmt(m.capacidade)}</b> frascos · ocupado até ao frasco <b>${fmt(m.ocupado)}</b>${segs.length ? `<br/>Total da mesa: <b>${fmt(m.totalRolhas)}</b> rolhas` : ''}</div>
    ${linhas}
    <button class="secundario" id="mcX">Fechar</button>
    <div class="msg-erro" id="mcErro"></div>`);
  el('mcX').onclick = fecharFolha;
  el('sheetBox').querySelectorAll('button[data-op]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm(`Tirar a ordem ${b.dataset.op} desta mesa (e das outras mesas onde esteja)?`)) return;
      try { await enviar('/api/logistica/ordem/remover', { data: dataLogistica(), ordem: b.dataset.op, pin: colocarHoje ? pinSessao : undefined }); fecharFolha(); carregarLogistica(); }
      catch (e) { if (/palavra-passe/i.test(e.message)) pinSessao = null; el('mcErro').textContent = e.message; }
    };
  });
}

// ----- Câmara: ler o nº de ordem (código de barras / QR) -----
let camStream = null, camAtiva = false;
function fecharCamara() {
  camAtiva = false;
  if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; }
  el('modalCam').style.display = 'none';
}
el('camFechar').onclick = fecharCamara;
el('btnCam').onclick = async () => {
  el('modalCam').style.display = 'flex';
  const msg = el('camMsg');
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    msg.textContent = 'Este telemóvel não lê códigos pela câmara no navegador. Escreve o nº de ordem à mão.';
    return;
  }
  try {
    msg.textContent = 'Aponta a câmara ao código de barras ou QR da OP.';
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    const v = el('camVideo'); v.srcObject = camStream; await v.play();
    const det = new BarcodeDetector();
    camAtiva = true;
    const ciclo = async () => {
      if (!camAtiva) return;
      try {
        const cods = await det.detect(v);
        for (const c of cods) {
          const m = String(c.rawValue).match(/\d{6,12}/g) || [];
          const ok = m.find((x) => ordemValida(x));
          if (ok) { el('colOrdem').value = ok; validarOrdem(); fecharCamara(); return; }
        }
        if (cods.length) msg.textContent = 'Código lido, mas não é um nº de ordem (150, 151 ou 950). Tenta outro.';
      } catch (e) { /* continua */ }
      setTimeout(ciclo, 250);
    };
    ciclo();
  } catch (e) { msg.textContent = 'Não consegui abrir a câmara. Escreve o nº de ordem à mão.'; }
};

// ---------- Levantamento: MISU, Contadeira e Logística ----------
const fmt = (n) => (n === null || n === undefined ? '-' : Number(n).toLocaleString('pt-PT'));
let levDados = [];
let levOps = [];

async function carregarLevantamento() {
  const r = await fetch('/api/levantamento');
  const d = await r.json();
  if (!r.ok) throw new Error(d.erro || 'Erro');
  levDados = d.mesas;
  levOps = d.ops || [];
  levOrdens = d.ordens || [];
  return levDados;
}

// linhas de rolhas de uma mesa (os frascos partidos aparecem sempre)
function rotuloOrdem(m, g, i) { return (m.segmentos || []).length > 1 ? `${m.mesa}-${g.seq || i + 1}` : m.mesa; }
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function linhasRolhas(m) {
  const segs = m.segmentos || [];
  if (segs.length) {
    return `<div class="bloco-rolhas">${segs.map((g, i) => `<b>${rotuloOrdem(m, g, i)} · OP ${g.op}</b>: ${fmt(g.frascos)} frascos × ${g.rolhasPorFrasco} rolhas = ${fmt(g.rolhas)}${g.frascosPartidos ? ` · partidos ${fmt(g.frascosPartidos)} (${fmt(g.rolhasPartidas)} rolhas)` : ''}`).join('<br/>')}<br/>
      Total de rolhas da mesa: <b>${fmt(m.totalRolhas)}</b><br/>
      Frascos partidos: <b>${fmt(m.frascosPartidos)}</b> (${fmt(m.rolhasPartidas)} rolhas)
    </div>`;
  }
  return `<div class="bloco-rolhas">
    Rolhas por frasco: <b>${fmt(m.rolhasPorFrasco)}</b> · Frascos: <b>${fmt(m.totalFrascos)}</b><br/>
    Total de rolhas da mesa: <b>${fmt(m.totalRolhas)}</b><br/>
    Frascos partidos: <b>${fmt(m.frascosPartidos)}</b> (${fmt(m.rolhasPartidas)} rolhas)
  </div>`;
}

function cartaoOp(o) {
  const ativo = o.estado === 'por_contar' || o.estado === 'feito';
  const rot = { aguardar_provas: `A aguardar provas ${o.prontas}/${o.nMesas} mesas`, aguardar_misu: `A aguardar MISU ${o.entregues}/${o.nMesas} mesas`, aguardar_levantamento: 'A aguardar levantamento', por_contar: 'Por contar', feito: 'Feito' }[o.estado];
  const cl = { aguardar_provas: 'aguardar', aguardar_misu: 'aguardar', aguardar_levantamento: 'aguardar', por_contar: 'fazer', feito: 'feito' }[o.estado];
  return `<div class="cartao-lev${ativo ? '' : ' desativada'}${o.estado === 'por_contar' ? ' pendente' : ''}" data-op="${o.op}">
    <div class="topo">OP ${o.op}<span class="estado ${cl}">${rot}</span></div>
    <div class="meta">${o.continua ? '<b>1.º fecho</b> (continua amanhã) · ' : ''}Mesas: ${o.mesas.join(', ')} · ${fmt(o.totalRolhas)} rolhas${o.partilhada ? ' (inclui mesas partilhadas)' : ''}<br/>Frascos partidos ${fmt(o.frascosPartidos)} (${fmt(o.rolhasPartidas)} rolhas)</div>
  </div>`;
}

async function abrirPerfil() {
  // só a contadeira (à OP) tem lista própria; o MISU e a logística trabalham no mapa vermelho/verde
  const lista = el('listaContadeira');
  const erro = el('erroContadeira');
  erro.textContent = '';
  try {
    await carregarLevantamento();
    if (!levOps.length) { lista.innerHTML = '<div class="chips-vazio">Sem OPs que vão à contadeira hoje.</div>'; return; }
    const peso = { por_contar: 0, feito: 1, aguardar_levantamento: 2, aguardar_misu: 3, aguardar_provas: 4 };
    const ops = levOps.slice().sort((a, b) => peso[a.estado] - peso[b.estado]);
    if (!el('contBusca')) {
      const inp = document.createElement('input'); inp.type = 'search'; inp.id = 'contBusca'; inp.placeholder = 'Procurar OP'; inp.inputMode = 'numeric'; inp.autocomplete = 'off'; inp.style.marginBottom = '10px';
      lista.parentNode.insertBefore(inp, lista);
      inp.oninput = () => { inp.value = inp.value.replace(/\D/g, ''); abrirPerfil(); };
    }
    const q = el('contBusca').value;
    const vis = ops.filter((o) => o.op.includes(q));
    lista.innerHTML = vis.length ? vis.map(cartaoOp).join('') : '<div class="chips-vazio">Nenhuma OP encontrada.</div>';
    lista.querySelectorAll('.cartao-lev').forEach((c) => {
      c.onclick = () => { if (!c.classList.contains('desativada')) folhaContadeira(levOps.find((x) => x.op === c.dataset.op)); };
    });
  } catch (e) { erro.textContent = 'Não foi possível carregar.'; }
}

function abrirFolha(html) {
  el('sheetBox').innerHTML = '<div class="sheet-topo"><button type="button" id="sheetFecharTopo">Fechar ✕</button></div>' + html;
  el('sheetFecharTopo').onclick = fecharFolha;   // sair sem guardar
  el('sheetBox').scrollTop = 0;
  el('modalSheet').style.display = 'flex';
}
function fecharFolha() { el('modalSheet').style.display = 'none'; }
function campoNum(id, rotulo, valor, desativado) {
  return `<div class="sheet-campo"><label>${rotulo}</label><input type="number" id="${id}" inputmode="numeric" min="0" placeholder="0" autocomplete="off" value="${valor ?? ''}" ${desativado ? 'disabled' : ''} /></div>`;
}
const lerNum = (id) => { const v = el(id).value.trim(); return v === '' ? undefined : Number(v); };
async function enviar(url, corpo) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.erro || 'Erro ao guardar.');
  return d;
}


// ----- Levantar · vista ORDENS (logística): o levantamento faz-se à ordem, com as QVs -----
let levOrdens = [];
const FASE_ORD = { em_prova: ['em prova', 'aguardar'], misu: ['MISU', 'aguardar'], pronta: ['por levantar', 'amarelo'], levantada: ['levantada', 'verde'] };
function textoResultado(o) {
  if (o.fase !== 'levantada') return '';
  if (o.aguardaContadeira) return 'Levantada · a aguardar a contadeira';
  if (o.resultado === 'parcial') return `1.º fecho · a ordem continua amanhã (${fmt(o.acumulado)} de ${fmt(o.encomenda)} rolhas)`;
  if (o.resultado === 'ok') return `OK · ${fmt(o.acumulado)} de ${fmt(o.encomenda)} rolhas encomendadas`;
  if (o.resultado === 'ok_com_falta') return `Fechada com falta aceite pela supervisão (${fmt(o.acumulado)} de ${fmt(o.encomenda)})`;
  if (o.resultado === 'pendente') return `Pendente · faltam ${fmt(o.falta)} rolhas · decisão da supervisão`;
  return '';
}
function mesasCurto(ms) { return ms.length > 3 ? `${ms[0]}…${ms[ms.length - 1]} (${ms.length} mesas)` : ms.join(', '); }
function cartaoOrdemLev(o) {
  const [rot, cl] = FASE_ORD[o.fase] || [o.fase, 'aguardar'];
  let nota = '';
  if (o.fase === 'levantada' && o.aguardaContadeira) nota = 'a aguardar contadeira';
  else if (o.fase === 'levantada' && o.resultado === 'pendente') nota = `faltam ${fmt(o.falta)}`;
  else if (o.fase === 'levantada' && o.resultado === 'parcial') nota = '1.º fecho';
  else if (o.continua) nota = 'continua amanhã';
  return `<div class="cartao-lev ord-mini${o.fase === 'pronta' ? ' o-falta' : o.fase === 'levantada' ? ' o-ok' : ''}${['em_prova', 'misu'].includes(o.fase) ? ' desativada' : ''}" data-op="${o.op}">
    <div class="topo">${o.op}</div>
    <span class="estado ${cl}">${rot}</span>
    <div class="meta">${mesasCurto(o.mesas)}<br/>${fmt(o.rolhas)} rolhas${nota ? ' · <b>' + nota + '</b>' : ''}</div>
  </div>`;
}
let levFiltro = 'por';   // 'por' = por levantar (inclui em prova/MISU) | 'lev' = levantadas
async function renderOrdensLev() {
  await carregarLevantamento();
  const box = el('levOrdens');
  if (!el('levBusca')) {
    box.innerHTML = `<div class="campo" style="margin-bottom:8px;"><input type="search" id="levBusca" inputmode="numeric" placeholder="Procurar OP (ex: 15007565)" autocomplete="off" /></div>
      <div class="seg" id="segFiltroOrd" style="margin-bottom:10px;"><button data-v="por">Por levantar</button><button data-v="lev">Levantadas</button></div><div id="levLista" class="grelha-ord"></div>`;
    el('levBusca').oninput = () => { levBuscaTxt = el('levBusca').value.replace(/\D/g, ''); listarOrdensLev(); };
    el('segFiltroOrd').querySelectorAll('button').forEach((b) => { b.onclick = () => { levFiltro = b.dataset.v; listarOrdensLev(); }; });
  }
  el('levBusca').value = levBuscaTxt;
  listarOrdensLev();
}
let levBuscaTxt = '';
function listarOrdensLev() {
  const box = el('levLista');
  const peso = { pronta: 0, misu: 1, em_prova: 2, levantada: 3 };
  const porLev = levOrdens.filter((o) => o.fase !== 'levantada'), lev = levOrdens.filter((o) => o.fase === 'levantada');
  const bt = el('segFiltroOrd').querySelectorAll('button');
  bt[0].textContent = `Por levantar (${porLev.length})`; bt[1].textContent = `Levantadas (${lev.length})`;
  bt.forEach((b) => b.classList.toggle('ativa', b.dataset.v === levFiltro));
  const base = levFiltro === 'lev' ? lev : porLev;
  const lista = base.filter((o) => o.op.includes(levBuscaTxt)).sort((a, b) => (peso[a.fase] - peso[b.fase]) || a.op.localeCompare(b.op));
  box.innerHTML = lista.length ? lista.map(cartaoOrdemLev).join('') : `<div class="chips-vazio" style="grid-column:1/-1;">${levBuscaTxt ? 'Nenhuma OP encontrada.' : levFiltro === 'lev' ? 'Ainda não há ordens levantadas.' : 'Não há ordens por levantar.'}</div>`;
  box.querySelectorAll('.cartao-lev').forEach((c) => { c.onclick = () => folhaOrdem(c.dataset.op); });
}
function folhaOrdem(op) {
  const o = levOrdens.find((x) => x.op === op);
  if (!o) return;
  const q = o.qvs;
  const lev = o.fase === 'levantada';
  const pode = o.fase === 'pronta' || lev;
  const rp = (g) => g.rolhasPorFrasco || 1;
  const linhasSeg = o.segmentos.map((g) => `<b>${g.seqRotulo || g.mesa}</b> · ${fmt(g.frascos)} frascos × ${rp(g)} = ${fmt(g.rolhas)} rolhas${g.rolhasPartidas ? ` · partidas ${fmt(g.rolhasPartidas)}` : ''}${g.fortes !== null && g.fortes !== undefined ? ` · MISU: ${g.contadeira ? '' : fmt(g.ligeiros || 0) + ' lig. · '}${fmt(g.fortes)} fortes (rolhas)` : ''}`).join('<br/>');
  const apr = o.aprovadasDia;
  const fase = { em_prova: 'Ainda há mesas desta ordem em prova.', misu: 'A aguardar o MISU em todas as mesas desta ordem.' }[o.fase] || '';
  const bloqAprov = !o.contadeira && apr !== null && pode;
  abrirFolha(`<h3>OP ${o.op}</h3>
    <div class="bloco-rolhas">${linhasSeg}<br/>
      Total da ordem: <b>${fmt(o.rolhas)}</b> rolhas · ${o.tipo}${o.contadeira ? ' · vai à contadeira' : ' · sem contadeira'}${o.continua ? ' · continua amanhã' : ''}</div>
    ${fase ? `<div class="aviso-hand">${fase}</div>` : ''}
    ${bloqAprov ? `<div class="bloco-rolhas">Aprovadas hoje: <b>${fmt(apr)}</b> (total − ligeiras − fortes − partidas)<br/>
      Encomenda <b>${fmt(o.encomenda)}</b> · dias anteriores ${fmt(o.anteriores)}${o.rolhasAdicionais ? ' · acrescentadas ' + fmt(o.rolhasAdicionais) : ''} · hoje ${fmt(apr)} = <b>${fmt(o.acumulado)}</b><br/>
      ${o.continua ? '<b>1.º fecho</b> · a ordem continua amanhã' : (o.acumulado >= o.encomenda ? '<b>OK</b> · encomenda cumprida' : `<b>Faltam ${fmt(o.falta)} rolhas</b> · fica pendente para a supervisão`)}</div>` : ''}
    ${o.contadeira && pode && !lev ? '<div class="aviso-hand">Esta ordem vai à contadeira: levanta-se primeiro e a contadeira conta depois.</div>' : ''}
    ${lev ? `<div class="bloco-rolhas"><b>${textoResultado(o)}</b><br/>QVs: colocação ${fmt(q.colocacao)} + MISU ${fmt(q.misu)} + logística ${fmt(q.logistica)} = ${fmt(q.total)} rolhas<br/>Levantamento registado: só a supervisora pode alterar.</div>` : ''}
    ${o.fase === 'pronta' ? `${campoNum('ordQvs', 'QVs · qualidade visual (nº de rolhas, pode ser 0)', '')}<div class="soma-qv" id="ordSoma"></div>
      <button class="primario" id="ordLev" style="margin-top:10px;">Guardar QVs e levantar ordem</button>` : ''}
    <button class="secundario" id="ordX">Fechar</button>
    <div class="msg-erro" id="ordErro"></div>`);
  const somar = () => {
    if (!el('ordQvs')) return;
    const l = lerNum('ordQvs') || 0;
    el('ordSoma').textContent = `QVs: colocação ${fmt(q.colocacao)} + logística ${fmt(l)} = ${fmt(q.colocacao + l)} rolhas`;
  };
  if (el('ordQvs')) { el('ordQvs').oninput = somar; somar(); }
  el('ordX').onclick = fecharFolha;
  if (el('ordLev')) el('ordLev').onclick = async () => {
    el('ordErro').textContent = '';
    if (lerNum('ordQvs') === undefined) { el('ordErro').textContent = 'Indica as QVs (escreve 0 se não houver).'; return; }
    try {
      await enviar('/api/logistica/ordem/levantar', { op: o.op, qvs: lerNum('ordQvs') });
      fecharFolha(); await renderOrdensLev(); carregarLogistica();
    } catch (e) { el('ordErro').textContent = e.message; }
  };
}

// ----- Supervisora: ordens · encomenda e decisões (acrescentar rolhas ou aceitar a falta) -----
const RES_TXT = { em_curso: 'em curso', parcial: '1.º fecho · continua', ok: 'OK', ok_com_falta: 'falta aceite', pendente: 'PENDENTE' };
async function folhaOrdensSup(lista) {
  try { if (!lista) lista = (await enviar('/api/supervisora/ordens', { pin: pinSessao })).ordens; }
  catch (e) { if (/palavra-passe/i.test(e.message)) pinSessao = null; alert(e.message); return; }
  const ord = lista.slice().sort((a, b) => (b.resultado === 'pendente') - (a.resultado === 'pendente') || a.op.localeCompare(b.op));
  const blocos = ord.map((o) => `<details class="prop-linha ${o.resultado === 'pendente' ? 'pendente' : ''}"${o.resultado === 'pendente' ? ' open' : ''}><summary>OP ${o.op} · ${RES_TXT[o.resultado] || o.resultado}</summary>
    <div style="margin-top:6px;">Encomenda ${fmt(o.encomenda)} · acumulado ${fmt(o.acumulado)}${o.falta ? ' · <b>faltam ' + fmt(o.falta) + '</b>' : ''}${o.rolhasAdicionais ? ' · acrescentadas ' + fmt(o.rolhasAdicionais) : ''}</div>
    <div class="prop-campos"><label>Rolhas<input type="number" inputmode="numeric" min="1" class="osN" data-op="${o.op}" placeholder="nº" /></label></div>
    <button class="secundario" data-a="acrescentar" data-op="${o.op}" style="margin-top:6px;">Acrescentar rolhas à encomenda</button>
    <button class="secundario" data-a="encomenda" data-op="${o.op}" style="margin-top:6px;">Alterar a quantidade encomendada</button>
    ${o.resultado === 'pendente' ? `<button class="primario" data-a="aceitar" data-op="${o.op}" style="margin-top:6px;">Aceitar a falta (${fmt(o.falta)})</button>` : ''}
    ${o.faseHoje === 'pronta' ? `<button class="secundario" data-a="reabrir_misu" data-op="${o.op}" style="margin-top:6px;">Reabrir o MISU de hoje</button>` : ''}
    ${o.faseHoje === 'levantada' ? `<button class="secundario" data-a="reabrir_levantamento" data-op="${o.op}" style="margin-top:6px;">Desfazer o levantamento de hoje</button>` : ''}
    ${o.contadaHoje ? `<button class="secundario" data-a="reabrir_contagem" data-op="${o.op}" style="margin-top:6px;">Reabrir a contagem da contadeira</button>` : ''}
    ${o.resultado === 'ok_com_falta' ? `<button class="secundario" data-a="reabrir" data-op="${o.op}" style="margin-top:6px;">Reabrir (deixar pendente)</button>` : ''}
  </details>`).join('');
  abrirFolha(`<h3>Ordens · encomenda e decisões</h3>${blocos || '<div class="aviso-hand">Ainda não há ordens.</div>'}
    <button class="secundario" id="osX">Fechar</button><div class="msg-erro" id="osErro"></div>`);
  el('osX').onclick = fecharFolha;
  el('sheetBox').querySelectorAll('button[data-a]').forEach((b) => {
    b.onclick = async () => {
      const op = b.dataset.op, a = b.dataset.a;
      if (/^reabrir_/.test(a) && !confirm('Confirmas?')) return;
      const n = el('sheetBox').querySelector(`.osN[data-op="${op}"]`).value.trim();
      const corpo = { pin: pinSessao, op, acao: a };
      if (a === 'acrescentar') corpo.rolhas = Number(n);
      if (a === 'encomenda') corpo.encomenda = Number(n);
      try { const r = await enviar('/api/supervisora/ordem-resultado', corpo); folhaOrdensSup(r.ordens); }
      catch (e) { if (/palavra-passe/i.test(e.message)) pinSessao = null; el('osErro').textContent = e.message; }
    };
  });
}
el('hubOrdens').onclick = () => folhaOrdensSup();

// ----- MISU (trabalha à mesa) -----
// O MISU aponta SEMPRE os contaminados (aroma ligeiro e forte). Só depois a mesa segue: para a contadeira (se
// a colocação disser que sim) ou para a logística (que subtrai ao total da mesa).
function folhaMisuOrdens(m) {
  const segs = m.segmentos;
  const bloq = !!m.misuEm;   // depois de registado, só a supervisora altera
  const rpf = (g) => g.rolhasPorFrasco || 1;
  const blocos = segs.map((g, i) => `<div class="prop-linha">
    <div><b>${rotuloOrdem(m, g, i)} · OP ${g.op}</b> · ${fmt(g.frascos)} frascos × ${rpf(g)} rolhas = ${fmt(g.rolhas)} rolhas · <b>${g.contadeira ? 'vai à contadeira' : 'não vai à contadeira'}</b>${g.frascosPartidos ? ` · partidos ${fmt(g.frascosPartidos)} frascos` : ''}</div>
    <div class="grid2">${g.contadeira ? '' : campoNum('misuLig' + i, 'Frascos ligeiros', g.ligeiros === null || g.ligeiros === undefined ? '' : g.ligeiros / rpf(g), bloq)}
    ${campoNum('misuFor' + i, 'Frascos fortes', g.fortes === null || g.fortes === undefined ? '' : g.fortes / rpf(g), bloq)}</div>
    <div class="soma-qv" id="misuApr${i}"></div>
    ${g.contadeira ? '<div class="dica">Com contadeira o MISU conta só os fortes; os ligeiros são da contadeira.</div>' : ''}
  </div>`).join('');
  abrirFolha(`<h3>Mesa ${m.mesa}</h3>${linhasRolhas(m)}
    ${bloq ? '<div class="aviso-hand">MISU já registado. Só a supervisora pode alterar.</div>' : '<div class="aviso-hand">O MISU conta em FRASCOS: a app multiplica pelas rolhas por frasco (1, 2 ou 4). Trabalha à mesa, mas aponta por ordem.</div>'}
    ${blocos}
    ${bloq ? '' : '<button class="primario" id="misuOk">Guardar</button>'}
    <button class="secundario" id="misuX">Fechar</button>
    <div class="msg-erro" id="misuErro"></div>`);
  el('misuX').onclick = fecharFolha;
  const atualizar = () => segs.forEach((g, i) => {
    const l = el('misuLig' + i) ? (lerNum('misuLig' + i) || 0) : 0, f = lerNum('misuFor' + i) || 0, r = rpf(g);
    el('misuApr' + i).innerHTML = (g.contadeira ? '' : `${fmt(l)} frascos ligeiros × ${r} = ${fmt(l * r)} rolhas<br/>`) + `${fmt(f)} frascos fortes × ${r} = ${fmt(f * r)} rolhas`;
  });
  segs.forEach((g, i) => { if (el('misuLig' + i)) el('misuLig' + i).oninput = atualizar; el('misuFor' + i).oninput = atualizar; });
  atualizar();
  if (bloq) return;
  el('misuOk').onclick = async () => {
    el('misuErro').textContent = '';
    const ordens = {};
    for (let i = 0; i < segs.length; i++) {
      const g = segs[i], r = rpf(g);
      const f = lerNum('misuFor' + i), l = el('misuLig' + i) ? lerNum('misuLig' + i) : 0;
      if (f === undefined || l === undefined) { el('misuErro').textContent = `Ordem ${g.op}: aponta os frascos de aroma ${g.contadeira ? 'forte' : 'ligeiro e forte'} (pode ser 0).`; return; }
      if (!Number.isInteger(f) || !Number.isInteger(l) || f < 0 || l < 0) { el('misuErro').textContent = `Ordem ${g.op}: indica frascos inteiros.`; return; }
      if (f + l > g.frascos) { el('misuErro').textContent = `Ordem ${g.op}: ${f + l} frascos contaminados é mais do que os ${g.frascos} frascos da ordem nesta mesa.`; return; }
      ordens[g.op] = { ligeiros: g.contadeira ? undefined : l * r, fortes: f * r };
    }
    try { await enviar('/api/misu/' + m.mesa, { ordens }); fecharFolha(); carregarLogistica(); }
    catch (e) { el('misuErro').textContent = e.message; }
  };
}
function folhaMisu(m) {
  if ((m.segmentos || []).length) return folhaMisuOrdens(m);
  const cont = m.contadeira;
  if (cont && m.misuEstado === 'entregue') {
    abrirFolha(`<h3>Mesa ${m.mesa}</h3>${linhasRolhas(m)}
      <div class="aviso-hand">Mesa entregue à contadeira. A responsabilidade passou para a contadeira e já não pode ser alterada aqui.<br/>Apontado: ${fmt(m.fortes)} fortes (os ligeiros são da contadeira) · QVs ${fmt(m.qvs.misu)}.</div>
      <button class="secundario" id="misuX" style="margin-top:0;">Fechar</button>`);
    el('misuX').onclick = fecharFolha;
    return;
  }
  abrirFolha(`<h3>Mesa ${m.mesa}</h3>
    ${linhasRolhas(m)}
    <div class="bloco-rolhas">Do 1.º ecrã (colocação): <b>${cont ? 'vai à contadeira' : 'não vai à contadeira'}</b></div>
    ${cont ? '<div class="aviso-hand">Com contadeira o MISU conta só os aromas fortes (os ligeiros ficam para a contadeira). Só depois de guardar a mesa segue para a contadeira (e a responsabilidade passa para ela).</div>' : ''}
    ${cont ? '' : campoNum('misuLig', 'Rolhas de aroma ligeiro', m.ligeiros)}
    ${campoNum('misuFor', 'Rolhas de aroma forte', m.fortes)}
    ${campoNum('misuQvs', 'QVs · qualidade visual (nº de rolhas)', m.qvs.misu || '')}
    <div class="soma-qv" id="misuTot"></div>
    <button class="primario" id="misuOk">${cont ? 'Guardar e entregar à contadeira' : 'Guardar'}</button>
    <button class="secundario" id="misuX">Fechar</button>
    <div class="msg-erro" id="misuErro"></div>`);
  const atualizar = () => {
    const l = el('misuLig') ? lerNum('misuLig') || 0 : 0, f = lerNum('misuFor') || 0;
    const p = m.rolhasPartidas || 0;
    el('misuTot').innerHTML = cont
      ? `Fortes: <b>${fmt(f)}</b> · partidas (da colocação): ${fmt(p)}`
      : (m.totalRolhas !== null
        ? `Conta à mão:<br/>${fmt(m.totalRolhas)} total − ${fmt(l)} ligeiras − ${fmt(f)} fortes − ${fmt(p)} partidas = <b>${fmt(m.totalRolhas - l - f - p)} aprovadas</b>`
        : `Contaminadas: ${fmt(l + f)}`);
  };
  if (el('misuLig')) el('misuLig').oninput = atualizar; el('misuFor').oninput = atualizar; atualizar();
  el('misuX').onclick = fecharFolha;
  el('misuOk').onclick = async () => {
    el('misuErro').textContent = '';
    if ((!cont && lerNum('misuLig') === undefined) || lerNum('misuFor') === undefined) { el('misuErro').textContent = cont ? 'Aponta as rolhas de aroma forte (pode ser 0).' : 'Aponta as rolhas de aroma ligeiro e de aroma forte (pode ser 0).'; return; }
    try {
      await enviar('/api/misu/' + m.mesa, { ligeiros: el('misuLig') ? lerNum('misuLig') : undefined, fortes: lerNum('misuFor'), qvs: lerNum('misuQvs') });
      fecharFolha(); carregarLogistica();
    } catch (e) { el('misuErro').textContent = e.message; }
  };
}

// ----- Contadeira (trabalha à OP) -----
function folhaContadeira(o) {
  const feito = o.aprovadas !== null && o.aprovadas !== undefined;
  abrirFolha(`<h3>Contadeira · OP ${o.op}</h3>
    <div class="bloco-rolhas">Mesas da OP: <b>${o.mesas.join(', ')}</b><br/>
      Total de rolhas: <b>${fmt(o.totalRolhas)}</b><br/>
      Aromas fortes (MISU): <b>${fmt(o.fortes)}</b> rolhas · Partidas: <b>${fmt(o.rolhasPartidas)}</b> rolhas (${fmt(o.frascosPartidos)} frascos)
      ${o.encomenda ? `<br/>Encomenda: <b>${fmt(o.encomenda)}</b> · dias anteriores ${fmt(o.anteriores)}` : ''}
      ${o.continua ? '<br/><b>1.º fecho</b> · a ordem continua amanhã (não é o fecho final)' : ''}</div>
    ${feito ? '<div class="aviso-hand">Contagem registada. Só a supervisora pode alterar.</div>' : '<p class="intro" style="margin-top:0;">Valores contados pela máquina para a OP (nº de rolhas)</p>'}
    ${campoNum('contApr', 'Rolhas OK (aprovadas)', o.aprovadas, feito)}
    ${campoNum('contLig', 'Rolhas ligeiras', o.ligeirasContadas, feito)}
    ${feito ? '' : '<button class="primario" id="contOk">Guardar</button>'}
    <button class="secundario" id="contX">Fechar</button>
    <div class="msg-erro" id="contErro"></div>`);
  el('contX').onclick = fecharFolha;
  if (feito) return;
  el('contOk').onclick = async () => {
    el('contErro').textContent = '';
    if (lerNum('contApr') === undefined || lerNum('contLig') === undefined) { el('contErro').textContent = 'Indica as rolhas OK e as rolhas ligeiras (0 se não houver).'; return; }
    try {
      await enviar('/api/contadeira/op/' + o.op, { aprovadas: lerNum('contApr'), ligeiras: lerNum('contLig') });
      fecharFolha(); abrirPerfil();
    } catch (e) { el('contErro').textContent = e.message; }
  };
}

// ----- Logística: rolhas aprovadas (levantar) -----
async function folhaLogistica(codigo) {
  let m;
  try { await carregarLevantamento(); m = levDados.find((x) => x.mesa === codigo); } catch (e) { return; }
  if (!m) return;
  const pronta = m.estadoProva === 'pronta' || m.estadoProva === 'levantada';
  const seg = (m.segmentos || []).length > 0;
  let bloco;
  if ((m.segmentos || []).length) {
    bloco = m.segmentos.map((g) => {
      if (g.contadeira) {
        const c = (m.contagensOp || []).find((x) => x.op === g.op);
        return `OP ${g.op} · contadeira · MISU: ${fmt(g.fortes)} fortes · ` + (c && c.aprovadas !== null ? `aprovadas <b>${fmt(c.aprovadas)}</b> (valor da OP inteira)` : '<b>a aguardar a contadeira</b>');
      }
      return g.aprovadas !== null ? `OP ${g.op} · sem contadeira · ${fmt(g.rolhas)} − ${fmt(g.ligeiros)} ligeiras − ${fmt(g.fortes)} fortes − ${fmt(g.rolhasPartidas)} partidas = <b>${fmt(g.aprovadas)}</b> aprovadas` : `OP ${g.op} · sem contadeira · <b>a aguardar o MISU</b>`;
    }).join('<br/>');
  } else if (m.contadeira) {
    const linhas = (m.contagensOp || []).map((c) => c.aprovadas !== null
      ? `OP ${c.op}: aprovadas <b>${fmt(c.aprovadas)}</b> (contadeira, valor da OP inteira)`
      : `OP ${c.op}: <b>a aguardar a contadeira</b>`);
    bloco = `Vai à contadeira · MISU apontou ${fmt(m.fortes)} fortes (ligeiros: contadeira)<br/>` + linhas.join('<br/>');
  } else if (m.aprovadas !== null) {
    bloco = `Sem contadeira · rolhas aprovadas = ${fmt(m.totalRolhas)} − ${fmt(m.contaminados)} (MISU: ${fmt(m.ligeiros)} ligeiras + ${fmt(m.fortes)} fortes) − ${fmt(m.rolhasPartidas)} partidas = <b>${fmt(m.aprovadas)}</b>`;
  } else {
    bloco = 'Sem contadeira · <b>a aguardar o MISU</b> (rolhas ligeiras e fortes)';
  }
  const q = m.qvs;
  abrirFolha(`<h3>Mesa ${m.mesa} · OP ${m.ordem || '-'}</h3>
    ${linhasRolhas(m)}
    ${pronta && m.desvio ? `<div class="aviso-hand">${m.desvio}</div>` : pronta ? '<div class="bloco-rolhas">Confere com a colocação.</div>' : ''}
    ${pronta ? `<div class="bloco-rolhas">${bloco}</div>
      ${seg ? '' : campoNum('logQvs', 'QVs da logística · qualidade visual (nº de rolhas)', q.logistica || '') + '<div class="soma-qv" id="logSoma"></div>'}` : `<div class="aviso-hand">Ainda não pode ser levantada: ${m.feitos} de ${m.necessarios} provadores concluíram.</div>`}
    ${seg ? '<div class="aviso-hand">O levantamento e as QVs da logística fazem-se pela ORDEM: separador Levantar → «Ordens · logística».</div>' : ''}
    ${pronta && !seg ? '<button class="secundario" id="logGuardar" style="margin-top:0;">Guardar QVs</button>' : ''}
    ${seg ? '' : m.estadoProva === 'pronta' ? '<button class="primario" id="logLev" style="margin-top:10px;">Marcar como levantada</button>' : ''}
    ${seg ? '' : m.estadoProva === 'levantada' ? '<button class="primario" id="logLev" style="margin-top:10px;">Desfazer levantamento</button>' : ''}
    <button class="secundario" id="logX">Fechar</button>
    <div class="msg-erro" id="logErro"></div>`);
  const somar = () => {
    if (!el('logQvs')) return;
    const l = lerNum('logQvs') || 0;
    el('logSoma').textContent = `QVs: colocação ${fmt(q.colocacao)} + MISU ${fmt(q.misu)} + logística ${fmt(l)} = ${fmt(q.colocacao + q.misu + l)} rolhas`;
  };
  if (el('logQvs')) { el('logQvs').oninput = somar; somar(); }
  el('logX').onclick = fecharFolha;
  if (el('logGuardar')) el('logGuardar').onclick = async () => {
    el('logErro').textContent = '';
    try { await enviar('/api/logistica/qvs/' + m.mesa, { qvs: lerNum('logQvs') ?? 0 }); await folhaLogistica(codigo); } catch (e) { el('logErro').textContent = e.message; }
  };
  if (el('logLev')) el('logLev').onclick = async () => {
    el('logErro').textContent = '';
    try { await enviar('/api/logistica/levantar', { mesa: m.mesa, desfazer: m.estadoProva === 'levantada' }); fecharFolha(); carregarLogistica(); } catch (e) { el('logErro').textContent = e.message; }
  };
}
// ----- Editar (supervisora): corrigir uma mesa de hoje a meio do processo -----
function optSel(id, rotulo, opcoes, atual) {
  return `<div class="sheet-campo"><label>${rotulo}</label><select id="${id}">${opcoes.map(([v, t]) => `<option value="${v}" ${String(v) === String(atual) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
}
async function folhaEditar(codigo) {
  let m;
  try { await carregarLevantamento(); m = levDados.find((x) => x.mesa === codigo); } catch (e) { return; }
  if (!m) { abrirFolha(`<h3>Mesa ${codigo}</h3><div class="aviso-hand">Esta mesa não tem lote hoje.</div><button class="secundario" id="edX">Fechar</button>`); el('edX').onclick = fecharFolha; return; }
  const sn = [[1, 'Sim'], [0, 'Não']];
  const porOrdem = (m.segmentos || []).length > 0;
  const contOp = (m.contagensOp || []).map((c) => campoNum('edOp_' + c.op, `Contadeira · OP ${c.op} · aprovadas`, c.aprovadas)).join('');
  abrirFolha(`<h3>Editar mesa ${m.mesa}</h3>
    <div class="aviso-hand">Modo supervisora: as alterações ficam registadas já.</div>
    ${linhasRolhas(m)}
    ${porOrdem ? htmlEditorOrdens(m) : `<div class="grid2">    <div class="sheet-campo cheio"><label>Nº de ordem</label><input id="edOrdem" value="${m.ordem || ''}" inputmode="numeric" /></div>
    ${optSel('edTipo', 'Tipo', [['EUR', 'EUR'], ['GRUPO', 'GRUPO'], ['AMOSTRA', 'AMOSTRA']], m.tipo)}
    ${optSel('edRolhas', 'Rolhas por frasco', [[1, '1'], [2, '2'], [4, '4']], m.rolhasPorFrasco)}
    ${campoNum('edTotal', 'Total de frascos/cliente', m.totalFrascos)}
    ${optSel('edCont', 'Contadeira', sn, m.contadeira ? 1 : 0)}
    ${optSel('edDsrol', 'DSROL', sn, m.dsrol ? 1 : 0)}
    ${campoNum('edPartidos', 'Frascos partidos', m.frascosPartidos)}
    ${campoNum('edQvCol', 'QVs colocação (rolhas)', m.qvs.colocacao)}</div>`}
    ${porOrdem ? (m.segmentos || []).map((g, i) => `<details class="prop-linha" open><summary>MISU · ${rotuloOrdem(m, g, i)} · OP ${g.op} · ${g.contadeira ? 'contadeira' : 'sem contadeira'}</summary><div class="grid2">${g.contadeira ? '' : campoNum('edLigO' + i, 'Ligeiros (rolhas)', g.ligeiros)}${campoNum('edForO' + i, 'Fortes (rolhas)', g.fortes)}</div></details>`).join('') : `${m.contadeira ? '' : campoNum('edLig', 'MISU · aromas ligeiros', m.ligeiros)}
    ${campoNum('edFor', 'MISU · aromas fortes', m.fortes)}`}
    <div class="grid2">
    ${campoNum('edQvMisu', 'MISU · QVs (rolhas)', m.qvs.misu)}
    ${campoNum('edQvLog', 'Logística · QVs (rolhas)', m.qvs.logistica)}
    ${contOp}</div>
    <button class="primario" id="edGuardar" style="margin-top:10px;">Guardar alterações</button>
    <button class="secundario" id="edTirar">Tirar esta mesa de hoje</button>
    <button class="secundario" id="edX">Fechar</button>
    <div class="msg-erro" id="edErro"></div>`);
  el('edX').onclick = fecharFolha;
  if (porOrdem) ligarEditorOrdens(m, isoLocal(new Date()), () => folhaEditar(codigo));
  el('edGuardar').onclick = async () => {
    el('edErro').textContent = '';
    const corpo = { pin: pinSessao,
      ...(porOrdem ? {} : { ordem: el('edOrdem').value.trim(), tipo: el('edTipo').value, rolhasPorFrasco: Number(el('edRolhas').value),
        totalFrascosCliente: lerNum('edTotal'), contadeira: el('edCont').value === '1', dsrol: el('edDsrol').value === '1',
        frascosPartidos: lerNum('edPartidos') ?? 0, qvsColocacao: lerNum('edQvCol') ?? 0 }),
      ...(porOrdem ? { misuOrdens: Object.fromEntries((m.segmentos || []).map((g, i) => [g.op, { ligeiros: el('edLigO' + i) ? lerNum('edLigO' + i) : undefined, fortes: lerNum('edForO' + i) }])), misu: { qvs: lerNum('edQvMisu') } } : { misu: { ligeiros: el('edLig') ? lerNum('edLig') : undefined, fortes: lerNum('edFor'), qvs: lerNum('edQvMisu') } }), logQvs: lerNum('edQvLog'), contagens: {} };
    (m.contagensOp || []).forEach((c) => { const v = lerNum('edOp_' + c.op); if (v !== undefined) corpo.contagens[c.op] = v; });
    try { await enviar('/api/supervisora/mesa/' + m.mesa, corpo); fecharFolha(); carregarLogistica(); }
    catch (e) { if (/palavra-passe/i.test(e.message)) pinSessao = null; el('edErro').textContent = e.message; }
  };
  el('edTirar').onclick = async () => {
    if (!confirm(`Tirar a mesa ${m.mesa} de hoje?`)) return;
    try { await enviar('/api/logistica/remover', { data: isoLocal(new Date()), mesas: [m.mesa], pin: pinSessao }); fecharFolha(); carregarLogistica(); }
    catch (e) { if (/palavra-passe/i.test(e.message)) pinSessao = null; el('edErro').textContent = e.message; }
  };
}
// ----- Editor de ordens (colocação) de uma mesa: hoje ou amanhã -----
function htmlEditorOrdens(m) {
  const sn = [[1, 'Sim'], [0, 'Não']];
  const segs = m.segmentos || [];
  return segs.map((g, i) => `<details class="prop-linha"${segs.length === 1 ? ' open' : ''}><summary>${rotuloOrdem(m, g, i)} · OP ${g.op} <small style="font-weight:600;color:#555;">(frascos ${g.de}–${g.ate})</small></summary>
    <div class="grid2">
    <div class="sheet-campo cheio"><label>Nº de ordem</label><input id="eoOp${i}" value="${esc(g.op)}" inputmode="numeric" autocomplete="off" /></div>
    ${campoNum('eoFr' + i, 'Frascos da ordem', g.frascos)}
    ${optSel('eoRol' + i, 'Rolhas por frasco', [[1, '1'], [2, '2'], [4, '4']], g.rolhasPorFrasco)}
    ${campoNum('eoPart' + i, 'Frascos partidos', g.frascosPartidos)}
    ${campoNum('eoQv' + i, 'QVs colocação (rolhas)', g.qvs)}
    ${optSel('eoTipo' + i, 'Tipo', [['EUR', 'EUR'], ['GRUPO', 'GRUPO'], ['AMOSTRA', 'AMOSTRA']], g.tipo)}
    ${optSel('eoCont' + i, 'Contadeira', sn, g.contadeira ? 1 : 0)}
    ${optSel('eoDsrol' + i, 'DSROL', sn, g.dsrol ? 1 : 0)}
    ${campoNum('eoEnc' + i, 'Encomenda (rolhas)', g.encomenda)}
    ${optSel('eoCm' + i, 'Continua amanhã', sn, g.continua ? 1 : 0)}
    <button class="secundario" id="eoSave${i}">Guardar esta ordem</button></div></details>`).join('');
}
function ligarEditorOrdens(m, data, recarregar) {
  (m.segmentos || []).forEach((g, i) => {
    el('eoSave' + i).onclick = async () => {
      el('edErro').textContent = '';
      try {
        await enviar('/api/supervisora/ordem', { pin: pinSessao, data, mesa: m.mesa, op: g.op, novaOrdem: el('eoOp' + i).value.trim(),
          frascos: lerNum('eoFr' + i), rolhasPorFrasco: Number(el('eoRol' + i).value), frascosPartidos: lerNum('eoPart' + i) ?? 0, qvs: lerNum('eoQv' + i) ?? 0,
          tipo: el('eoTipo' + i).value, contadeira: el('eoCont' + i).value === '1', dsrol: el('eoDsrol' + i).value === '1', encomenda: lerNum('eoEnc' + i), continua: el('eoCm' + i).value === '1' });
        carregarLogistica(); recarregar();
      } catch (e) { if (/palavra-passe/i.test(e.message)) pinSessao = null; el('edErro').textContent = e.message; }
    };
  });
}
async function folhaEditarAmanha(codigo) {
  const m = logDados.mesas.find((x) => x.mesa === codigo);
  if (!m) return;
  const data = dataLogistica();
  if (!(m.segmentos || []).length) {
    abrirFolha(`<h3>Mesa ${codigo} · amanhã</h3><div class="aviso-hand">Sem ordens colocadas. Coloca-as no separador Colocar.</div><button class="secundario" id="edX">Fechar</button>`);
    el('edX').onclick = fecharFolha; return;
  }
  abrirFolha(`<h3>Editar mesa ${codigo} · amanhã</h3>
    <div class="aviso-hand">Modo supervisora: as alterações ficam registadas já.</div>
    ${htmlEditorOrdens(m)}
    <button class="secundario" id="edX">Fechar</button>
    <div class="msg-erro" id="edErro"></div>`);
  el('edX').onclick = fecharFolha;
  ligarEditorOrdens(m, data, async () => { await carregarLogistica(); folhaEditarAmanha(codigo); });
}

// ----- Provadores: lista de nomes -----
async function folhaProvadores(lista) {
  try { if (!lista) lista = (await enviar('/api/supervisora/provadores', { pin: pinSessao, acao: 'listar' })).provadores; }
  catch (e) { if (/palavra-passe/i.test(e.message)) pinSessao = null; alert(e.message); return; }
  abrirFolha(`<h3>Provadores</h3>
    <div class="sheet-campo"><label>Novo provador</label><input id="pvNovo" placeholder="Nome completo" autocomplete="off" /></div>
    <button class="primario" id="pvAdd" style="margin-top:0;">Adicionar</button>
    ${lista.map((p) => `<div class="prop-linha" style="${p.ativo ? '' : 'opacity:.6;'}"><div><b>${esc(p.nome)}</b>${p.ativo ? '' : ' · desativado'}</div>
      <div class="prop-campos"><button class="secundario" data-a="renomear" data-id="${p.id}" data-nome="${esc(p.nome)}">Renomear</button>
      <button class="secundario" data-a="${p.ativo ? 'desativar' : 'ativar'}" data-id="${p.id}">${p.ativo ? 'Tirar da lista' : 'Voltar à lista'}</button></div></div>`).join('')}
    <button class="secundario" id="pvX">Fechar</button>
    <div class="msg-erro" id="pvErro"></div>`);
  el('pvX').onclick = fecharFolha;
  const agir = async (corpo) => {
    el('pvErro').textContent = '';
    try { const r = await enviar('/api/supervisora/provadores', { pin: pinSessao, ...corpo }); folhaProvadores(r.provadores); }
    catch (e) { if (/palavra-passe/i.test(e.message)) pinSessao = null; el('pvErro').textContent = e.message; }
  };
  el('pvAdd').onclick = () => agir({ acao: 'adicionar', nome: el('pvNovo').value });
  el('sheetBox').querySelectorAll('button[data-a]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.a === 'renomear') { const n = prompt('Novo nome:', b.dataset.nome); if (n !== null) agir({ acao: 'renomear', id: Number(b.dataset.id), nome: n }); }
      else agir({ acao: b.dataset.a, id: Number(b.dataset.id) });
    };
  });
}

// ----- Provas de uma mesa: editar ou apagar o que um provador registou -----
async function folhaProvasMesa(codigo) {
  let regs, aprov, nProv = null;
  try {
    const rr = await enviar('/api/supervisora/registos', { pin: pinSessao, mesa: codigo });
    regs = rr.registos; nProv = rr.provadores;
    aprov = await (await fetch('/api/aprovadores')).json();
  } catch (e) { if (/palavra-passe/i.test(e.message)) pinSessao = null; el('erroLog').textContent = e.message; return; }
  const nomes = aprov.map((a) => a.nome);
  abrirFolha(`<h3>Provas · mesa ${codigo} · hoje</h3>
    ${nProv ? `<div class="prop-linha">${optSel('rgN', 'Nº de provadores necessários nesta mesa', [1, 2, 3, 4, 5, 6].map((n) => [n, String(n)]), nProv)}
      <button class="secundario" id="rgNOk">Guardar nº de provadores</button></div>` : ''}
    ${regs.length ? regs.map((r) => {
      const lst = nomes.includes(r.aprovador) ? nomes : [r.aprovador, ...nomes];
      return `<details class="prop-linha"${regs.length <= 2 ? ' open' : ''}><summary>${esc(r.aprovador)} · ${r.estado} · ${r.abertura || ''}${r.fecho ? '–' + r.fecho : ''}</summary>
        <div class="grid2">
        ${optSel('rgAp' + r.id, 'Provador', lst.map((n) => [n, n]), r.aprovador)}
        ${optSel('rgEs' + r.id, 'Estado', [['Aberto', 'Aberto'], ['Fechado', 'Fechado']], r.estado)}
        <div class="sheet-campo"><label>Abertura</label><input type="time" id="rgA${r.id}" value="${r.abertura || ''}" /></div>
        <div class="sheet-campo"><label>Fecho</label><input type="time" id="rgF${r.id}" value="${r.fecho || ''}" /></div>
        <button class="secundario" data-g="${r.id}">Guardar</button><button class="secundario" data-d="${r.id}">Apagar prova</button></div></details>`;
    }).join('') : '<div class="aviso-hand">Ainda não há provas registadas nesta mesa hoje.</div>'}
    <button class="secundario" id="rgX">Fechar</button>
    <div class="msg-erro" id="rgErro"></div>`);
  el('rgX').onclick = fecharFolha;
  if (el('rgNOk')) el('rgNOk').onclick = async () => {
    el('rgErro').textContent = '';
    try { await enviar('/api/supervisora/mesa/' + codigo, { pin: pinSessao, provadores: Number(el('rgN').value) }); carregarLogistica(); folhaProvasMesa(codigo); }
    catch (e) { if (/palavra-passe/i.test(e.message)) pinSessao = null; el('rgErro').textContent = e.message; }
  };
  const erro = (e) => { if (/palavra-passe/i.test(e.message)) pinSessao = null; el('rgErro').textContent = e.message; };
  el('sheetBox').querySelectorAll('button[data-g]').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.g; el('rgErro').textContent = '';
      try { await enviar('/api/supervisora/registo/' + id, { pin: pinSessao, acao: 'editar', aprovador: el('rgAp' + id).value, estado: el('rgEs' + id).value, abertura: el('rgA' + id).value, fecho: el('rgF' + id).value || null }); carregarLogistica(); folhaProvasMesa(codigo); }
      catch (e) { erro(e); }
    };
  });
  el('sheetBox').querySelectorAll('button[data-d]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Apagar esta prova? Deixa de contar para a mesa.')) return;
      try { await enviar('/api/supervisora/registo/' + b.dataset.d, { pin: pinSessao, acao: 'apagar' }); carregarLogistica(); folhaProvasMesa(codigo); }
      catch (e) { erro(e); }
    };
  });
}

// Mapa vermelho/verde: vermelho = vez do MISU (contaminados à frente); verde = vez da logística (rolhas OK)
async function abrirMesaMapa(codigo) {
  const m = logDados.mesas.find((x) => x.mesa === codigo);
  if (!m || m.estado === 'sem_lote') return;
  if (m.estado === 'misu') {
    try { await carregarLevantamento(); } catch (e) { return; }
    const x = levDados.find((y) => y.mesa === codigo);
    if (x) folhaMisu(x);
    return;
  }
  folhaLogistica(codigo);
}

el('tileContadeira').onclick = () => { mostrarTela('telaContadeira'); abrirPerfil(); };

// arranque: ecrã Home
mostrarTela('telaHome');

// segurança: ao sair da app (mudar de aplicação, ecrã bloqueado) a sessão da supervisora termina
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;
  if (['editar', 'editarMesas', 'editarProvas'].includes(logModo) && el('telaLogistica').classList.contains('ativa')) definirModo('colocar');
  else pinSessao = null;
});
