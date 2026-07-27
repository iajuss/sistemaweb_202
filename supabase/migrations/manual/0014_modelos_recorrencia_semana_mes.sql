-- Suporta múltiplos dias da semana num modelo semanal (ex.: terça e quinta)
-- e mês explícito num modelo anual (em vez de derivar do mês de criação).
alter table public.modelos_recorrencia
  add column if not exists dias_semana integer[],
  add column if not exists mes_referencia integer;
