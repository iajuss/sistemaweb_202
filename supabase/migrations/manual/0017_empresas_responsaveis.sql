-- Múltiplos responsáveis internos por empresa, mesmo padrão de
-- tarefas_responsaveis/modelos_recorrencia_responsaveis (0016).

create table public.empresas_responsaveis (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  perfil_id uuid not null references public.perfis(id),
  primary key (empresa_id, perfil_id)
);

insert into public.empresas_responsaveis (empresa_id, perfil_id)
select id, responsavel_id from public.empresas where responsavel_id is not null;

alter table public.empresas drop column responsavel_id;

alter table public.empresas_responsaveis enable row level security;

create policy "empresas_responsaveis_isolamento" on public.empresas_responsaveis
  for all using (
    empresa_id in (
      select id from public.empresas
      where escritorio_id = public.meu_escritorio_id()
    )
  ) with check (
    empresa_id in (
      select id from public.empresas
      where escritorio_id = public.meu_escritorio_id()
    )
  );
