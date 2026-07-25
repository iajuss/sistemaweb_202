create extension if not exists pg_trgm;

-- Retorna pares de empresas do mesmo escritório com razão social
-- textualmente parecida (possível duplicidade), id_a sempre < id_b
-- para não retornar o mesmo par duas vezes.
create or replace function public.detectar_duplicidade_razao_social(
  p_escritorio_id uuid,
  p_limiar float default 0.6
)
returns table (empresa_id uuid, razao_social text, empresa_similar_id uuid, razao_social_similar text, similaridade float)
language sql
stable
security invoker
as $$
  select
    a.id, a.razao_social,
    b.id, b.razao_social,
    similarity(a.razao_social, b.razao_social)
  from public.empresas a
  join public.empresas b
    on a.escritorio_id = b.escritorio_id
    and a.id < b.id
    and similarity(a.razao_social, b.razao_social) >= p_limiar
  where a.escritorio_id = p_escritorio_id;
$$;
