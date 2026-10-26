// Colocação POR ORDEM: dada uma ordem (nº de frascos), distribui-a pelas mesas do dia, respeitando
// a capacidade de frascos de cada mesa (layout DS100) e a regra das filas (7 frascos por fila, 1 fila de separação).
// A capacidade é sempre em FRASCOS; as rolhas por frasco (1, 2 ou 4) só mudam o total de rolhas.
// Várias ordens podem partilhar a mesma mesa.
const plan = require('./planeamento');

// ocupacao: Map<número da mesa, último frasco ocupado nessa mesa>
function alocar(lado, ocupacao, frascos) {
  const total = plan.MESAS[lado];
  const cap = (n) => plan.LAYOUT[lado].cap[String(n)] || 0;
  let mesa = 1, usado = 0;
  for (const [n, u] of ocupacao) if (n > mesa || (n === mesa && u > usado)) { mesa = n; usado = u; }
  if (usado > 0) {
    const prox = plan.inicioSeguinte(usado);
    if (prox >= cap(mesa)) { mesa += 1; usado = 0; } else usado = prox;
  }
  const segmentos = [];
  let restante = frascos;
  while (restante > 0 && mesa <= total) {
    const livre = cap(mesa) - usado;
    if (livre <= 0) { mesa += 1; usado = 0; continue; }
    const poe = Math.min(restante, livre);
    segmentos.push({ mesa: lado + mesa, num: mesa, de: usado + 1, ate: usado + poe, frascos: poe });
    restante -= poe; usado += poe;
    if (restante > 0) { mesa += 1; usado = 0; }
  }
  return { segmentos, semCapacidade: restante };
}
module.exports = { alocar };
