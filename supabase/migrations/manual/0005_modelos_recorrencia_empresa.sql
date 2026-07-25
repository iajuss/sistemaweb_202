alter table public.modelos_recorrencia
  add column empresa_id uuid not null references public.empresas(id) on delete cascade;
