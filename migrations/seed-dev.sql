-- Dados de EXEMPLO só para testes locais/desenvolvimento.
-- NÃO correr isto em produção (cria lotes falsos "para hoje").
INSERT INTO lotes (mesa, ordem, data_planeamento, numero_provadores, ativo) VALUES
  ('A1', '15007239', CURRENT_DATE, 2, true),
  ('A2', '15007239', CURRENT_DATE, 2, true),
  ('B2', '15007413', CURRENT_DATE, 2, true)
ON CONFLICT (mesa, data_planeamento) DO NOTHING;
