-- Esquema inicial - App Avaliação Olfativa DS100
-- Este ficheiro corre automaticamente a cada arranque da app (idempotente).

CREATE TABLE IF NOT EXISTS aprovadores (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  ativo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS lotes (
  id SERIAL PRIMARY KEY,
  mesa TEXT NOT NULL,
  ordem TEXT,
  data_planeamento DATE NOT NULL,
  numero_provadores INTEGER NOT NULL DEFAULT 2,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mesa, data_planeamento)
);

CREATE TABLE IF NOT EXISTS registos (
  id SERIAL PRIMARY KEY,
  mesa TEXT NOT NULL,
  aprovador TEXT NOT NULL,
  hora_abertura TIMESTAMPTZ NOT NULL DEFAULT now(),
  hora_fecho TIMESTAMPTZ,
  estado TEXT NOT NULL CHECK (estado IN ('Aberto','Fechado'))
);

-- Garante que só pode existir 1 registo "Aberto" por mesa de cada vez
CREATE UNIQUE INDEX IF NOT EXISTS uniq_mesa_aberta
  ON registos (mesa)
  WHERE estado = 'Aberto';

CREATE INDEX IF NOT EXISTS idx_registos_mesa_dia ON registos (mesa, hora_fecho);
CREATE INDEX IF NOT EXISTS idx_registos_aprovador_dia ON registos (aprovador, hora_fecho);
CREATE INDEX IF NOT EXISTS idx_lotes_mesa_data ON lotes (mesa, data_planeamento);

-- Lista real de aprovadores (seguro correr sempre; nomes repetidos são ignorados)
INSERT INTO aprovadores (nome) VALUES
  ('Joana Amorim'), ('Ana Catarina Silva'), ('Francisca Braga'),
  ('Francisco Sousa'), ('Marta Santos'), ('Tânia Lino'),
  ('Raquel Santos'), ('Teresa Pinto'), ('Tânia Gonçalves')
ON CONFLICT (nome) DO NOTHING;

-- Logística: marca de mesa levantada
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS levantada_em TIMESTAMPTZ;

-- Registo conforme: guarda as OPs da mesa (inteira) no momento da abertura
ALTER TABLE registos ADD COLUMN IF NOT EXISTS ordem TEXT;

-- Logística: dados registados por quem coloca as mesas
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS rolhas_por_frasco INTEGER;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS total_frascos_cliente INTEGER;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS contadeira BOOLEAN;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS qvs TEXT;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS tipo TEXT;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS dsrol BOOLEAN;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS frascos_partidos INTEGER;

-- Levantamento: QVs numéricas na colocação + registos do MISU, da contadeira e da logística
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS qvs_colocacao INTEGER;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS misu_ligeiros INTEGER;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS misu_fortes INTEGER;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS misu_qvs INTEGER;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS misu_em TIMESTAMPTZ;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS cont_ligeiros INTEGER;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS cont_fortes INTEGER;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS cont_aprovadas INTEGER;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS cont_em TIMESTAMPTZ;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS log_qvs INTEGER;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS log_em TIMESTAMPTZ;

-- Contadeira: trabalha por OP (e por dia de prova), não por mesa
CREATE TABLE IF NOT EXISTS contagens_op (
  op TEXT NOT NULL,
  data DATE NOT NULL,
  ligeiros INTEGER,
  fortes INTEGER,
  aprovadas INTEGER,
  em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (op, data)
);

-- Histórico de TODOS os movimentos da aplicação (nunca é apagado, nem pelo "limpar dados de teste")
CREATE TABLE IF NOT EXISTS movimentos (
  id BIGSERIAL PRIMARY KEY,
  em TIMESTAMPTZ NOT NULL DEFAULT now(),
  acao TEXT NOT NULL,
  mesa TEXT,
  op TEXT,
  utilizador TEXT,
  metodo TEXT,
  caminho TEXT,
  status INTEGER,
  ip TEXT,
  pedido TEXT,
  resposta TEXT
);
CREATE INDEX IF NOT EXISTS movimentos_em_idx ON movimentos (em);
CREATE INDEX IF NOT EXISTS movimentos_mesa_idx ON movimentos (mesa);

-- Colocação por ORDEM: uma mesa pode ter várias ordens (cada uma com as suas rolhas por frasco)
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS total_rolhas INTEGER;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS rolhas_partidas_total INTEGER;
CREATE TABLE IF NOT EXISTS lote_ops (
  data DATE NOT NULL,
  mesa TEXT NOT NULL,
  op TEXT NOT NULL,
  de INTEGER NOT NULL,
  ate INTEGER NOT NULL,
  frascos INTEGER NOT NULL,
  rolhas_por_frasco INTEGER NOT NULL,
  frascos_partidos INTEGER NOT NULL DEFAULT 0,
  qvs INTEGER NOT NULL DEFAULT 0,
  contadeira BOOLEAN NOT NULL,
  tipo TEXT NOT NULL,
  dsrol BOOLEAN NOT NULL,
  criado TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (data, mesa, op)
);

-- A contadeira é decidida POR ORDEM; o MISU aponta por ordem dentro da mesa
ALTER TABLE lote_ops ADD COLUMN IF NOT EXISTS misu_ligeiros INTEGER;
ALTER TABLE lote_ops ADD COLUMN IF NOT EXISTS misu_fortes INTEGER;

-- Identificação das ordens numa mesa partilhada: A7-1, A7-2, ...
ALTER TABLE lote_ops ADD COLUMN IF NOT EXISTS seq INTEGER;

-- Cargas iniciais de dados reais que só se fazem UMA vez (para não voltarem a aparecer se forem apagadas)
CREATE TABLE IF NOT EXISTS cargas_iniciais (
  nome TEXT PRIMARY KEY,
  em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sábados que a supervisora passa a contar como dia útil (exceção pontual)
CREATE TABLE IF NOT EXISTS dias_extra (
  data DATE PRIMARY KEY,
  criado TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ordens que podem durar mais do que um dia: encomenda (em rolhas), fecho parcial/final e decisão da supervisora
CREATE TABLE IF NOT EXISTS ordens (
  op TEXT PRIMARY KEY,
  encomenda INTEGER,
  rolhas_adicionais INTEGER NOT NULL DEFAULT 0,
  aceite_falta BOOLEAN NOT NULL DEFAULT FALSE,
  aceite_em TIMESTAMPTZ,
  criado TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ordens_dia (
  data DATE NOT NULL,
  op TEXT NOT NULL,
  continua BOOLEAN NOT NULL DEFAULT FALSE,
  qvs_logistica INTEGER NOT NULL DEFAULT 0,
  levantada_em TIMESTAMPTZ,
  aprovadas_final INTEGER,
  PRIMARY KEY (data, op)
);
ALTER TABLE lote_ops ADD COLUMN IF NOT EXISTS misu_qvs INTEGER;

-- Versões (cópias de segurança dos dados) para a supervisora restaurar
CREATE TABLE IF NOT EXISTS versoes (
  id SERIAL PRIMARY KEY,
  criado TIMESTAMPTZ NOT NULL DEFAULT now(),
  motivo TEXT,
  resumo TEXT,
  dados JSONB NOT NULL
);

-- Rolhas partidas REAIS por ordem/mesa (frascos vazios ou com menos rolhas); NULL = frascos partidos x rolhas por frasco
ALTER TABLE lote_ops ADD COLUMN IF NOT EXISTS rolhas_partidas INTEGER;

-- Sobras da contadeira (rolhas num saco de 5 000 incompleto, para o dia seguinte): fecham o dia, não entram no acumulado
ALTER TABLE contagens_op ADD COLUMN IF NOT EXISTS sobras INTEGER;
