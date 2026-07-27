-- Permite limitar um modelo de recorrência a se repetir por um período
-- (ex.: "2 meses", "5 dias", "1 ano") em vez de indefinidamente. Ambas as
-- colunas nulas (padrão) preserva o comportamento atual: repete sem fim.
alter table public.modelos_recorrencia
  add column if not exists repeticoes_quantidade integer,
  add column if not exists repeticoes_unidade text;
