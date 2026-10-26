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
function dataLogistica() { return (logModo === 'colocar' && !colocarHoje) || (logModo === 'editarMesas' && editDia === 'amanha') ? proximoDiaUtil() : isoLocal(new Date()); }

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

let editDia = 'hoje';   // no menu da supervisora (colocação e levantamento): mesas de hoje ou de amanhã
function definirModo(modo, hojeTeste) {
  logModo = modo;
  colocarHoje = modo === 'colocar' && !!hojeTeste;
  if (modo === 'editar' || modo === 'editarMesas') { if (modo === 'editar') editDia = 'hoje'; definirSeg('segEditDia', editDia); }
  const edit = ['editar', 'editarMesas', 'editarProvas'].includes(modo);
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
  el('logTopo').style.display = hub ? 'none' : '';
  el('logMapa').style.display = hub ? 'none' : '';
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
el('btnColocarHoje').onclick = () => definirModo('colocar', true);
el('btnHistorico').onclick = async () => {
  try {
    const r = await fetch('/api/supervisora/movimentos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: pinSessao }) });
    if (!r.ok) { const d = await r.json(); if (r.status === 401) pinSessao = null; throw new Error(d.erro || 'Erro'); }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a'); a.href = url; a.download = 'historico_movimentos_DS100_' + isoLocal(new Date()) + '.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { el('erroLog').textContent = e.message; }
};
el('btnReset').onclick = async () => {
  if (!confirm('Apagar TODAS as mesas, provas e levantamentos? Só para limpar dados de teste.')) return;
  try { await enviar('/api/supervisora/reset', { pin: pinSessao, confirmar: 'APAGAR' }); carregarLogistica(); alert('Dados de teste apagados.'); }
  catch (e) { if (/palavra-passe/i.test(e.message)) pinSessao = null; el('erroLog').textContent = e.message; }
};
el('abaEditar').onclick = async () => {                     // só a supervisora, com palavra-passe
  if (!pinSessao && !(await pedirPin())) return;
  definirModo('editar');
};
el('btnHub').onclick = () => definirModo('editar');
el('hubMesas').onclick = () => definirModo('editarMesas');
el('hubProvas').onclick = () => definirModo('editarProvas');
el('hubProvadores').onclick = () => folhaProvadores();
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
  ['colOrdem', 'colTotal'].forEach((id) => { el(id).value = ''; });
  ['segRolhas', 'segTipo', 'segContadeira', 'segDsrol'].forEach((id) => definirSeg(id, null));
  proposta = null; selecionadas = new Set();
  el('colProposta').style.display = 'none'; el('colProposta').innerHTML = '';
  el('okCol').style.display = 'none'; el('erroCol').textContent = '';
  atualizarResumoCol(); validarOrdem();
}
function cancelarProposta() {
  proposta = null; selecionadas = new Set();
  el('colProposta').style.display = 'none'; el('colProposta').innerHTML = '';
  if (logDados) renderLogistica();
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
el('colOrdem').addEventListener('input', () => { el('colOrdem').value = el('colOrdem').value.replace(/\D/g, ''); validarOrdem(); if (proposta) cancelarProposta(); });

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
  return { data: dataLogistica(), ordem, frascos, rolhasPorFrasco: Number(rolhas), tipo, contadeira: cont === 'sim', dsrol: dsrol === 'sim', pin: colocarHoje ? pinSessao : undefined };
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
    el('okCol').textContent = `Colocada: OP ${dados.ordem} em ${r.mesas.join(', ')}.`;
    el('okCol').style.display = '';
    limparFormColocacao();           // cada introdução começa limpa
    el('okCol').textContent = `Colocada: OP ${dados.ordem} em ${r.mesas.join(', ')}.`;
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
  return `<div class="sheet-campo"><label>${rotulo}</label><input type="number" id="${id}" inputmode="numeric" min="0" placeholder="0" autocomplete="off" value="${valor ?? ''}" ${desativado ? 'disabled' : ''} /></div>`;
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
function folhaMisuOrdens(m) {
  const segs = m.segmentos;
  const entregue = m.contadeira && m.misuEstado === 'entregue';
  const blocos = segs.map((g, i) => `<div class="prop-linha">
    <div><b>${rotuloOrdem(m, g, i)} · OP ${g.op}</b> · ${fmt(g.rolhas)} rolhas (${fmt(g.frascos)} frascos × ${g.rolhasPorFrasco}) · <b>${g.contadeira ? 'vai à contadeira' : 'não vai à contadeira'}</b>${g.rolhasPartidas ? ` · partidas ${fmt(g.rolhasPartidas)}` : ''}</div>
    ${g.contadeira ? '' : campoNum('misuLig' + i, 'Rolhas de aroma ligeiro', g.ligeiros, entregue)}
    ${campoNum('misuFor' + i, 'Rolhas de aroma forte', g.fortes, entregue)}
    ${g.contadeira ? '<div class="dica">Com contadeira o MISU conta só os fortes; os ligeiros são da contadeira.</div>' : '<div class="soma-qv" id="misuApr' + i + '"></div>'}
  </div>`).join('');
  abrirFolha(`<h3>Mesa ${m.mesa}</h3>${linhasRolhas(m)}
    ${entregue ? '<div class="aviso-hand">Mesa entregue à contadeira. A responsabilidade passou para a contadeira e já não pode ser alterada aqui.</div>' : '<div class="aviso-hand">O MISU trabalha à mesa, mas aponta por ordem: o que vai à contadeira só conta fortes; o resto conta ligeiros e fortes.</div>'}
    ${blocos}
    ${campoNum('misuQvs', 'QVs · qualidade visual (nº de rolhas)', m.qvs.misu || '', entregue)}
    ${entregue ? '' : `<button class="primario" id="misuOk">${m.contadeira ? 'Guardar e entregar à contadeira' : 'Guardar'}</button>`}
    <button class="secundario" id="misuX">Fechar</button>
    <div class="msg-erro" id="misuErro"></div>`);
  el('misuX').onclick = fecharFolha;
  const atualizar = () => segs.forEach((g, i) => {
    if (g.contadeira || !el('misuApr' + i)) return;
    const l = lerNum('misuLig' + i) || 0, f = lerNum('misuFor' + i) || 0;
    el('misuApr' + i).innerHTML = `${fmt(g.rolhas)} − ${fmt(l)} ligeiras − ${fmt(f)} fortes − ${fmt(g.rolhasPartidas)} partidas = <b>${fmt(g.rolhas - l - f - g.rolhasPartidas)} aprovadas</b>`;
  });
  segs.forEach((g, i) => { if (el('misuLig' + i)) el('misuLig' + i).oninput = atualizar; el('misuFor' + i).oninput = atualizar; });
  atualizar();
  if (entregue) return;
  el('misuOk').onclick = async () => {
    el('misuErro').textContent = '';
    const ordens = {};
    for (let i = 0; i < segs.length; i++) {
      const g = segs[i];
      if (lerNum('misuFor' + i) === undefined || (!g.contadeira && lerNum('misuLig' + i) === undefined)) { el('misuErro').textContent = `Ordem ${g.op}: ${g.contadeira ? 'aponta as rolhas de aroma forte' : 'aponta as rolhas de aroma ligeiro e de aroma forte'} (pode ser 0).`; return; }
      ordens[g.op] = { ligeiros: g.contadeira ? undefined : lerNum('misuLig' + i), fortes: lerNum('misuFor' + i) };
    }
    try { await enviar('/api/misu/' + m.mesa, { ordens, qvs: lerNum('misuQvs') }); fecharFolha(); carregarLogistica(); }
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
  const porOrdem = (m.segmentos || []).length > 0;
  const contOp = (m.contagensOp || []).map((c) => campoNum('edOp_' + c.op, `Contadeira · OP ${c.op} · aprovadas`, c.aprovadas)).join('');
  abrirFolha(`<h3>Editar mesa ${m.mesa}</h3>
    <div class="aviso-hand">Modo supervisora: as alterações ficam registadas já.</div>
    ${linhasRolhas(m)}
    ${porOrdem ? htmlEditorOrdens(m) : `    <div class="sheet-campo"><label>Nº de ordem</label><input id="edOrdem" value="${m.ordem || ''}" inputmode="numeric" /></div>
    ${optSel('edTipo', 'Tipo', [['EUR', 'EUR'], ['GRUPO', 'GRUPO'], ['AMOSTRA', 'AMOSTRA']], m.tipo)}
    ${optSel('edRolhas', 'Rolhas por frasco', [[1, '1'], [2, '2'], [4, '4']], m.rolhasPorFrasco)}
    ${campoNum('edTotal', 'Total de frascos/cliente', m.totalFrascos)}
    ${optSel('edCont', 'Contadeira', sn, m.contadeira ? 1 : 0)}
    ${optSel('edDsrol', 'DSROL', sn, m.dsrol ? 1 : 0)}
    ${campoNum('edPartidos', 'Frascos partidos', m.frascosPartidos)}
    ${campoNum('edQvCol', 'QVs da colocação (nº de rolhas)', m.qvs.colocacao)}`}
    ${porOrdem ? (m.segmentos || []).map((g, i) => `<div class="prop-linha"><b>OP ${g.op}</b> · ${g.contadeira ? 'contadeira' : 'sem contadeira'}${g.contadeira ? '' : campoNum('edLigO' + i, 'MISU · aromas ligeiros', g.ligeiros)}${campoNum('edForO' + i, 'MISU · aromas fortes', g.fortes)}</div>`).join('') : `${m.contadeira ? '' : campoNum('edLig', 'MISU · aromas ligeiros', m.ligeiros)}
    ${campoNum('edFor', 'MISU · aromas fortes', m.fortes)}`}
    ${campoNum('edQvMisu', 'MISU · QVs (nº de rolhas)', m.qvs.misu)}
    ${campoNum('edQvLog', 'Logística · QVs (nº de rolhas)', m.qvs.logistica)}
    ${contOp}
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
  return (m.segmentos || []).map((g, i) => `<div class="prop-linha"><b>${rotuloOrdem(m, g, i)} · OP ${g.op}</b> (frascos ${g.de}–${g.ate})
    <div class="sheet-campo"><label>Nº de ordem</label><input id="eoOp${i}" value="${esc(g.op)}" inputmode="numeric" autocomplete="off" /></div>
    ${campoNum('eoFr' + i, 'Frascos da ordem', g.frascos)}
    ${optSel('eoRol' + i, 'Rolhas por frasco', [[1, '1'], [2, '2'], [4, '4']], g.rolhasPorFrasco)}
    ${campoNum('eoPart' + i, 'Frascos partidos', g.frascosPartidos)}
    ${campoNum('eoQv' + i, 'QVs da colocação (nº de rolhas)', g.qvs)}
    ${optSel('eoTipo' + i, 'Tipo', [['EUR', 'EUR'], ['GRUPO', 'GRUPO'], ['AMOSTRA', 'AMOSTRA']], g.tipo)}
    ${optSel('eoCont' + i, 'Contadeira', sn, g.contadeira ? 1 : 0)}
    ${optSel('eoDsrol' + i, 'DSROL', sn, g.dsrol ? 1 : 0)}
    <button class="secundario" id="eoSave${i}">Guardar esta ordem</button></div>`).join('');
}
function ligarEditorOrdens(m, data, recarregar) {
  (m.segmentos || []).forEach((g, i) => {
    el('eoSave' + i).onclick = async () => {
      el('edErro').textContent = '';
      try {
        await enviar('/api/supervisora/ordem', { pin: pinSessao, data, mesa: m.mesa, op: g.op, novaOrdem: el('eoOp' + i).value.trim(),
          frascos: lerNum('eoFr' + i), rolhasPorFrasco: Number(el('eoRol' + i).value), frascosPartidos: lerNum('eoPart' + i) ?? 0, qvs: lerNum('eoQv' + i) ?? 0,
          tipo: el('eoTipo' + i).value, contadeira: el('eoCont' + i).value === '1', dsrol: el('eoDsrol' + i).value === '1' });
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
  let regs, aprov;
  try {
    regs = (await enviar('/api/supervisora/registos', { pin: pinSessao, mesa: codigo })).registos;
    aprov = await (await fetch('/api/aprovadores')).json();
  } catch (e) { if (/palavra-passe/i.test(e.message)) pinSessao = null; el('erroLog').textContent = e.message; return; }
  const nomes = aprov.map((a) => a.nome);
  abrirFolha(`<h3>Provas · mesa ${codigo} · hoje</h3>
    ${regs.length ? regs.map((r) => {
      const lst = nomes.includes(r.aprovador) ? nomes : [r.aprovador, ...nomes];
      return `<div class="prop-linha"><b>${esc(r.aprovador)}</b> · ${r.estado}
        ${optSel('rgAp' + r.id, 'Provador', lst.map((n) => [n, n]), r.aprovador)}
        <div class="prop-campos"><label>Abertura<input type="time" id="rgA${r.id}" value="${r.abertura || ''}" /></label><label>Fecho<input type="time" id="rgF${r.id}" value="${r.fecho || ''}" /></label></div>
        ${optSel('rgEs' + r.id, 'Estado', [['Aberto', 'Aberto'], ['Fechado', 'Fechado']], r.estado)}
        <div class="prop-campos"><button class="secundario" data-g="${r.id}">Guardar</button><button class="secundario" data-d="${r.id}">Apagar prova</button></div></div>`;
    }).join('') : '<div class="aviso-hand">Ainda não há provas registadas nesta mesa hoje.</div>'}
    <button class="secundario" id="rgX">Fechar</button>
    <div class="msg-erro" id="rgErro"></div>`);
  el('rgX').onclick = fecharFolha;
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
