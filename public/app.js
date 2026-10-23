const estado = {
  aprovador: null,
  mesa: null,
  statusMesa: null,
  registoAbertoId: null,
  pollTimer: null,
};

const el = (id) => document.getElementById(id);

function mostrarTela(id) {
  document.querySelectorAll('.tela').forEach((t) => t.classList.remove('ativa'));
  el(id).classList.add('ativa');
  const login = id === 'telaLogin';
  el('app').classList.toggle('modo-login', login);
  el('btnRefresh').style.display = login ? '' : 'none';
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
function proximoDiaUtil() {
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

el('btnRefresh').onclick = () => {
  const b = el('btnRefresh');
  b.classList.remove('girar'); void b.offsetWidth; b.classList.add('girar');
  carregarAprovadores();
};

// ---------- Home ----------
el('tileProvadores').onclick = () => { el('buscaAprovador').value = ''; carregarAprovadores(); mostrarTela('telaLogin'); };
el('tileLogistica').onclick = () => { mostrarTela('telaLogistica'); definirModo('colocar'); };

// ---------- Logística: levantar (hoje) e colocar mesas (amanhã) ----------
let logDados = null;
let logModo = 'levantar';       // 'levantar' | 'colocar'
let selecionadas = new Set();
const PREFIXOS_OP = ['150', '151', '950'];

let colocarHoje = false;        // só a supervisora: colocar as mesas de hoje (para testar no próprio dia)
function dataLogistica() { return logModo === 'colocar' && !colocarHoje ? proximoDiaUtil() : isoLocal(new Date()); }

async function carregarLogistica() {
  try {
    const r = await fetch('/api/logistica/mesas?data=' + dataLogistica());
    const d = await r.json();
    if (!r.ok) throw new Error(d.erro);
    logDados = d;
    el('erroLog').textContent = '';
    renderLogistica();
  } catch (e) { el('erroLog').textContent = 'Não foi possível atualizar o mapa.'; }
}

function definirModo(modo, hojeTeste) {
  logModo = modo;
  colocarHoje = modo === 'colocar' && !!hojeTeste;
  el('editBar').style.display = modo === 'editar' ? '' : 'none';
  selecionadas = new Set();
  el('abaLevantar').classList.toggle('ativa', modo === 'levantar');
  el('abaColocar').classList.toggle('ativa', modo === 'colocar' && !hojeTeste);
  el('abaEditar').classList.toggle('ativa', modo === 'editar');
  el('logResumoLev').style.display = modo !== 'colocar' ? '' : 'none';
  el('legLev').style.display = modo !== 'colocar' ? '' : 'none';
  el('legCol').style.display = modo === 'colocar' ? '' : 'none';
  el('colForm').style.display = modo === 'colocar' ? '' : 'none';
  if (estado.pollTimer) { clearInterval(estado.pollTimer); estado.pollTimer = null; }
  if (modo === 'levantar') estado.pollTimer = setInterval(carregarLogistica, 15000);
  limparMensagensCol();
  carregarLogistica();
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
el('btnColocarHoje').onclick = () => definirModo('colocar', true);
el('btnReset').onclick = async () => {
  if (!confirm('Apagar TODAS as mesas, provas e levantamentos? Só para limpar dados de teste.')) return;
  try { await enviar('/api/supervisora/reset', { pin: pinSessao, confirmar: 'APAGAR' }); carregarLogistica(); alert('Dados de teste apagados.'); }
  catch (e) { if (/palavra-passe/i.test(e.message)) pinSessao = null; el('erroLog').textContent = e.message; }
};
el('abaEditar').onclick = async () => {                     // só a supervisora, com palavra-passe
  if (!pinSessao && !(await pedirPin())) return;
  definirModo('editar');
};

function renderLogistica() {
  const d = logDados;
  const por = new Map(d.mesas.map((m) => [parseInt(m.mesa.slice(1), 10), m]));
  el('logTopo').innerHTML = logModo === 'colocar'
    ? `Data de logística: <b>${dataPT(isoLocal(new Date()))}</b> · Data da prova: <b>${dataPT(d.data)}</b>${colocarHoje ? ' (teste, supervisora)' : ''} · lado <b>${d.lado}</b><br/>Toca nas mesas para selecionar`
    : logModo === 'editar'
    ? `Modo supervisora · toca numa mesa de hoje para corrigir`
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
      if (logModo === 'colocar') sub = m.ordem ? String(m.ordem).slice(-4) : '';
      else sub = { sem_lote: '', levantada: 'levantada', misu: 'MISU', pronta: 'logística' }[m.estado] ?? `${m.feitos}/${m.necessarios}`;
      const sel = logModo === 'colocar' && selecionadas.has(m.mesa) ? ' sel' : '';
      html += `<div class="mesa ${m.estado}${sel}${fila.length === 1 ? ' solta' : ''}" data-mesa="${m.mesa}">${m.mesa}<small>${sub}</small></div>`;
    });
    html += '</div>';
    if (idx % 2 === 1) html += '<div class="log-corredor">corredor</div>';
  });
  el('logMapa').innerHTML = html;
  el('logMapa').querySelectorAll('.mesa').forEach((n) => {
    n.onclick = () => (logModo === 'colocar' ? alternarMesa(n.dataset.mesa) : logModo === 'editar' ? folhaEditar(n.dataset.mesa) : abrirMesaMapa(n.dataset.mesa));
  });
  if (logModo === 'colocar') atualizarSelecao();
}

// ----- Colocar: seleção de mesas + formulário -----
function atualizarResumoCol() {
  const r = Number(valorSeg('segRolhas')) || 0;
  const f = Number(el('colTotal').value) || 0;
  const p = Number(el('colPartidos').value) || 0;
  el('colResumo').innerHTML = r && f
    ? `Total de rolhas da mesa = ${fmt(f)} frascos × ${r} = <b>${fmt(f * r)}</b><br/>Frascos partidos: ${fmt(p)} × ${r} = <b>${fmt(p * r)}</b> rolhas`
    : 'Escolhe as rolhas por frasco e indica os frascos para ver o total de rolhas.';
}
function limparMensagensCol() { el('erroCol').textContent = ''; el('okCol').style.display = 'none'; }
function alternarMesa(codigo) {
  if (selecionadas.has(codigo)) selecionadas.delete(codigo); else selecionadas.add(codigo);
  limparMensagensCol();
  // se escolhi uma só mesa já colocada, mostra os dados dela para editar
  if (selecionadas.size === 1) {
    const m = logDados.mesas.find((x) => x.mesa === [...selecionadas][0]);
    if (m && m.ordem) preencherForm(m);
  }
  renderLogistica();
}
function numMesa(c) { return parseInt(c.slice(1), 10); }
function atualizarSelecao() {
  const l = [...selecionadas].sort((a, b) => numMesa(a) - numMesa(b));
  el('colSel').textContent = l.length ? `${l.join(', ')}  (${l.length})` : 'Toca nas mesas para selecionar';
}
function preencherForm(m) {
  el('colOrdem').value = m.ordem || '';
  definirSeg('segRolhas', m.rolhasPorFrasco ? String(m.rolhasPorFrasco) : null);
  el('colTotal').value = m.totalFrascosCliente || '';
  definirSeg('segContadeira', m.contadeira === true ? 'sim' : m.contadeira === false ? 'nao' : null);
  definirSeg('segTipo', m.tipo || null);
  definirSeg('segDsrol', m.dsrol === true ? 'sim' : m.dsrol === false ? 'nao' : null);
  el('colPartidos').value = m.frascosPartidos || '';
  el('colQvs').value = m.qvs || '';
  atualizarResumoCol();
  validarOrdem();
}
function definirSeg(id, v) {
  el(id).querySelectorAll('button').forEach((b) => b.classList.toggle('ativa', b.dataset.v === v));
}
function valorSeg(id) { const b = el(id).querySelector('button.ativa'); return b ? b.dataset.v : null; }
['segTipo', 'segRolhas', 'segContadeira', 'segDsrol'].forEach((id) => {
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
el('colPartidos').addEventListener('input', atualizarResumoCol);
el('colOrdem').addEventListener('input', () => { el('colOrdem').value = el('colOrdem').value.replace(/\D/g, ''); validarOrdem(); });

el('btnGuardarCol').onclick = async () => {
  limparMensagensCol();
  const ordem = el('colOrdem').value.trim();
  const rolhas = valorSeg('segRolhas');
  const total = Number(el('colTotal').value);
  const cont = valorSeg('segContadeira');
  const tipo = valorSeg('segTipo');
  const dsrol = valorSeg('segDsrol');
  const partidos = el('colPartidos').value.trim() === '' ? 0 : Number(el('colPartidos').value);
  if (!selecionadas.size) { el('erroCol').textContent = 'Seleciona pelo menos uma mesa.'; return; }
  if (!ordemValida(ordem)) { el('erroCol').textContent = 'Nº de ordem inválido: só números e a começar por 150, 151 ou 950.'; return; }
  if (!tipo) { el('erroCol').textContent = 'Escolhe o tipo: EUR, GRUPO ou AMOSTRA.'; return; }
  if (!rolhas) { el('erroCol').textContent = 'Escolhe as rolhas por frasco (1, 2 ou 4).'; return; }
  if (!Number.isInteger(total) || total < 1) { el('erroCol').textContent = 'Indica o total de frascos/cliente.'; return; }
  if (!cont) { el('erroCol').textContent = 'Indica se tem contadeira (Sim ou Não).'; return; }
  if (!dsrol) { el('erroCol').textContent = 'Indica DSROL (Sim ou Não).'; return; }
  if (!Number.isInteger(partidos) || partidos < 0) { el('erroCol').textContent = 'Frascos partidos: indica um número inteiro (0 ou mais).'; return; }
  el('btnGuardarCol').disabled = true;
  try {
    const r = await fetch('/api/logistica/colocar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: dataLogistica(), mesas: [...selecionadas], ordem, rolhasPorFrasco: Number(rolhas), totalFrascosCliente: total, contadeira: cont === 'sim', qvs: el('colQvs').value.trim() === '' ? 0 : Number(el('colQvs').value), tipo, dsrol: dsrol === 'sim', frascosPartidos: partidos, pin: colocarHoje ? pinSessao : undefined }),
    });
    const d = await r.json();
    if (r.status === 401) { pinSessao = null; }
    if (!r.ok) throw new Error(d.erro || 'Erro ao guardar.');
    const n = selecionadas.size;
    selecionadas = new Set();
    el('okCol').textContent = `Guardado: ${n} ${n === 1 ? 'mesa' : 'mesas'} com a OP ${ordem}.`;
    el('okCol').style.display = '';
    await carregarLogistica();
  } catch (e) { el('erroCol').textContent = e.message; }
  el('btnGuardarCol').disabled = false;
};

el('btnRemoverCol').onclick = async () => {
  limparMensagensCol();
  if (!selecionadas.size) { el('erroCol').textContent = 'Seleciona as mesas a tirar.'; return; }
  try {
    const r = await fetch('/api/logistica/remover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: dataLogistica(), mesas: [...selecionadas], pin: colocarHoje ? pinSessao : undefined }) });
    const d = await r.json();
    if (r.status === 401) { pinSessao = null; }
    if (!r.ok) throw new Error(d.erro || 'Erro ao remover.');
    selecionadas = new Set();
    await carregarLogistica();
  } catch (e) { el('erroCol').textContent = e.message; }
};

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
  return levDados;
}

// linhas de rolhas de uma mesa (os frascos partidos aparecem sempre)
function linhasRolhas(m) {
  return `<div class="bloco-rolhas">
    Rolhas por frasco: <b>${fmt(m.rolhasPorFrasco)}</b> · Frascos: <b>${fmt(m.totalFrascos)}</b><br/>
    Total de rolhas da mesa: <b>${fmt(m.totalRolhas)}</b><br/>
    Frascos partidos: <b>${fmt(m.frascosPartidos)}</b> (${fmt(m.rolhasPartidas)} rolhas)
  </div>`;
}

function cartaoOp(o) {
  const ativo = o.estado === 'por_contar' || o.estado === 'feito';
  const rot = { aguardar_provas: `A aguardar provas ${o.prontas}/${o.nMesas} mesas`, aguardar_misu: `A aguardar MISU ${o.entregues}/${o.nMesas} mesas`, por_contar: 'Por contar', feito: 'Feito' }[o.estado];
  const cl = { aguardar_provas: 'aguardar', aguardar_misu: 'aguardar', por_contar: 'fazer', feito: 'feito' }[o.estado];
  return `<div class="cartao-lev${ativo ? '' : ' desativada'}${o.estado === 'por_contar' ? ' pendente' : ''}" data-op="${o.op}">
    <div class="topo">OP ${o.op}<span class="estado ${cl}">${rot}</span></div>
    <div class="meta">Mesas: ${o.mesas.join(', ')} · ${fmt(o.totalRolhas)} rolhas${o.partilhada ? ' (inclui mesas partilhadas)' : ''}<br/>Frascos partidos ${fmt(o.frascosPartidos)} (${fmt(o.rolhasPartidas)} rolhas)</div>
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
    const peso = { por_contar: 0, feito: 1, aguardar_misu: 2, aguardar_provas: 3 };
    const ops = levOps.slice().sort((a, b) => peso[a.estado] - peso[b.estado]);
    lista.innerHTML = ops.map(cartaoOp).join('');
    lista.querySelectorAll('.cartao-lev').forEach((c) => {
      c.onclick = () => { if (!c.classList.contains('desativada')) folhaContadeira(levOps.find((x) => x.op === c.dataset.op)); };
    });
  } catch (e) { erro.textContent = 'Não foi possível carregar.'; }
}

function abrirFolha(html) { el('sheetBox').innerHTML = html; el('modalSheet').style.display = 'flex'; }
function fecharFolha() { el('modalSheet').style.display = 'none'; }
function campoNum(id, rotulo, valor, desativado) {
  return `<div class="sheet-campo"><label>${rotulo}</label><input type="number" id="${id}" inputmode="numeric" min="0" placeholder="0" value="${valor ?? ''}" ${desativado ? 'disabled' : ''} /></div>`;
}
const lerNum = (id) => { const v = el(id).value.trim(); return v === '' ? undefined : Number(v); };
async function enviar(url, corpo) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.erro || 'Erro ao guardar.');
  return d;
}

// ----- MISU (trabalha à mesa) -----
// O MISU aponta SEMPRE os contaminados (aroma ligeiro e forte). Só depois a mesa segue: para a contadeira (se
// a colocação disser que sim) ou para a logística (que subtrai ao total da mesa).
function folhaMisu(m) {
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
  abrirFolha(`<h3>Contadeira · OP ${o.op}</h3>
    <div class="bloco-rolhas">Mesas da OP: <b>${o.mesas.join(', ')}</b><br/>
      Total de rolhas: <b>${fmt(o.totalRolhas)}</b>${o.partilhada ? ' (inclui mesas partilhadas)' : ''}<br/>
      Aromas fortes (apontados pelo MISU): <b>${fmt(o.fortes)}</b> · os ligeiros são contados pela contadeira<br/>
      Frascos partidos: <b>${fmt(o.frascosPartidos)}</b> (${fmt(o.rolhasPartidas)} rolhas)</div>
    <p class="intro" style="margin-top:0;">Valor contado pela máquina para a OP (nº de rolhas)</p>
    ${campoNum('contApr', 'Rolhas aprovadas (OK)', o.aprovadas)}
    <div class="soma-qv" id="contConta"></div>
    <button class="primario" id="contOk">Guardar</button>
    <button class="secundario" id="contX">Fechar</button>
    <div class="msg-erro" id="contErro"></div>`);
  const contaOp = () => {
    const a = lerNum('contApr');
    el('contConta').innerHTML = a === undefined ? '' : `${fmt(o.totalRolhas)} total − ${fmt(a)} aprovadas − ${fmt(o.fortes)} fortes − ${fmt(o.rolhasPartidas)} partidas = <b>${fmt(o.totalRolhas - a - o.fortes - o.rolhasPartidas)} ligeiras</b> (por diferença)`;
  };
  el('contApr').oninput = contaOp; contaOp();
  el('contX').onclick = fecharFolha;
  el('contOk').onclick = async () => {
    el('contErro').textContent = '';
    if (lerNum('contApr') === undefined) { el('contErro').textContent = 'Indica as rolhas aprovadas contadas pela máquina.'; return; }
    try {
      await enviar('/api/contadeira/op/' + o.op, { aprovadas: lerNum('contApr') });
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
  let bloco;
  if (m.contadeira) {
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
      ${campoNum('logQvs', 'QVs da logística · qualidade visual (nº de rolhas)', q.logistica || '')}
      <div class="soma-qv" id="logSoma"></div>` : `<div class="aviso-hand">Ainda não pode ser levantada: ${m.feitos} de ${m.necessarios} provadores concluíram.</div>`}
    ${pronta ? '<button class="secundario" id="logGuardar" style="margin-top:0;">Guardar QVs</button>' : ''}
    ${m.estadoProva === 'pronta' ? '<button class="primario" id="logLev" style="margin-top:10px;">Marcar como levantada</button>' : ''}
    ${m.estadoProva === 'levantada' ? '<button class="primario" id="logLev" style="margin-top:10px;">Desfazer levantamento</button>' : ''}
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
  const contOp = (m.contagensOp || []).map((c) => campoNum('edOp_' + c.op, `Contadeira · OP ${c.op} · aprovadas`, c.aprovadas)).join('');
  abrirFolha(`<h3>Editar mesa ${m.mesa}</h3>
    <div class="aviso-hand">Modo supervisora: as alterações ficam registadas já.</div>
    ${linhasRolhas(m)}
    <div class="sheet-campo"><label>Nº de ordem</label><input id="edOrdem" value="${m.ordem || ''}" inputmode="numeric" /></div>
    ${optSel('edTipo', 'Tipo', [['EUR', 'EUR'], ['GRUPO', 'GRUPO'], ['AMOSTRA', 'AMOSTRA']], m.tipo)}
    ${optSel('edRolhas', 'Rolhas por frasco', [[1, '1'], [2, '2'], [4, '4']], m.rolhasPorFrasco)}
    ${campoNum('edTotal', 'Total de frascos/cliente', m.totalFrascos)}
    ${optSel('edCont', 'Contadeira', sn, m.contadeira ? 1 : 0)}
    ${optSel('edDsrol', 'DSROL', sn, m.dsrol ? 1 : 0)}
    ${campoNum('edPartidos', 'Frascos partidos', m.frascosPartidos)}
    ${campoNum('edQvCol', 'QVs da colocação (nº de rolhas)', m.qvs.colocacao)}
    ${m.contadeira ? '' : campoNum('edLig', 'MISU · aromas ligeiros', m.ligeiros)}
    ${campoNum('edFor', 'MISU · aromas fortes', m.fortes)}
    ${campoNum('edQvMisu', 'MISU · QVs (nº de rolhas)', m.qvs.misu)}
    ${campoNum('edQvLog', 'Logística · QVs (nº de rolhas)', m.qvs.logistica)}
    ${contOp}
    <button class="primario" id="edGuardar" style="margin-top:10px;">Guardar alterações</button>
    <button class="secundario" id="edTirar">Tirar esta mesa de hoje</button>
    <button class="secundario" id="edX">Fechar</button>
    <div class="msg-erro" id="edErro"></div>`);
  el('edX').onclick = fecharFolha;
  el('edGuardar').onclick = async () => {
    el('edErro').textContent = '';
    const corpo = { pin: pinSessao, ordem: el('edOrdem').value.trim(), tipo: el('edTipo').value, rolhasPorFrasco: Number(el('edRolhas').value),
      totalFrascosCliente: lerNum('edTotal'), contadeira: el('edCont').value === '1', dsrol: el('edDsrol').value === '1',
      frascosPartidos: lerNum('edPartidos') ?? 0, qvsColocacao: lerNum('edQvCol') ?? 0,
      misu: { ligeiros: el('edLig') ? lerNum('edLig') : undefined, fortes: lerNum('edFor'), qvs: lerNum('edQvMisu') }, logQvs: lerNum('edQvLog'), contagens: {} };
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
