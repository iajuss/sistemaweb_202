-- Preferências de exibição da identidade do escritório, compartilhadas por
-- toda a equipe. Valores preservam a leitura anterior na barra lateral e
-- deixam o cabeçalho desativado até o responsável optar por exibi-lo.
alter table public.escritorios
  add column if not exists exibir_nome_na_lateral boolean not null default true,
  add column if not exists exibir_nome_no_header boolean not null default false;
