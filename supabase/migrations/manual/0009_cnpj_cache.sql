-- Cache de consultas de CNPJ à BrasilAPI (ver lib/cnpj-cache.ts). Dado
-- global (não por escritório) e não sensível — é a mesma informação
-- pública que a BrasilAPI já expõe para qualquer CNPJ.
create table public.cnpj_cache (
  cnpj text primary key,
  dados jsonb not null,
  consultado_em timestamptz not null default now()
);

alter table public.cnpj_cache enable row level security;

-- Precisa de update (diferente de feriados_cache, que só insere linhas
-- novas): o cache de CNPJ é atualizado quando expira e é reconsultado.
create policy "cnpj_cache_select" on public.cnpj_cache
  for select using (auth.role() = 'authenticated');
create policy "cnpj_cache_insert" on public.cnpj_cache
  for insert with check (auth.role() = 'authenticated');
create policy "cnpj_cache_update" on public.cnpj_cache
  for update using (auth.role() = 'authenticated');
