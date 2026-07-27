-- Múltiplos responsáveis por tarefa/modelo de recorrência, substituindo a
-- FK única responsavel_id. empresas.responsavel_id não muda (conceito
-- separado). Ver docs/superpowers/specs/2026-07-27-multi-responsavel-design.md.

create table public.tarefas_responsaveis (
  tarefa_id uuid not null references public.tarefas(id) on delete cascade,
  perfil_id uuid not null references public.perfis(id),
  primary key (tarefa_id, perfil_id)
);

create table public.modelos_recorrencia_responsaveis (
  modelo_id uuid not null references public.modelos_recorrencia(id) on delete cascade,
  perfil_id uuid not null references public.perfis(id),
  primary key (modelo_id, perfil_id)
);

insert into public.tarefas_responsaveis (tarefa_id, perfil_id)
select id, responsavel_id from public.tarefas where responsavel_id is not null;

insert into public.modelos_recorrencia_responsaveis (modelo_id, perfil_id)
select id, responsavel_id from public.modelos_recorrencia where responsavel_id is not null;

alter table public.tarefas drop column responsavel_id;
alter table public.modelos_recorrencia drop column responsavel_id;

alter table public.tarefas_responsaveis enable row level security;
alter table public.modelos_recorrencia_responsaveis enable row level security;

-- Isolamento via join com a tabela dona (mesmo padrão de
-- empresas_socios_isolamento em 0001_rls_and_profile_trigger.sql).
create policy "tarefas_responsaveis_isolamento" on public.tarefas_responsaveis
  for all using (
    tarefa_id in (
      select id from public.tarefas
      where escritorio_id = public.meu_escritorio_id()
    )
  ) with check (
    tarefa_id in (
      select id from public.tarefas
      where escritorio_id = public.meu_escritorio_id()
    )
  );

create policy "modelos_recorrencia_responsaveis_isolamento" on public.modelos_recorrencia_responsaveis
  for all using (
    modelo_id in (
      select id from public.modelos_recorrencia
      where escritorio_id = public.meu_escritorio_id()
    )
  ) with check (
    modelo_id in (
      select id from public.modelos_recorrencia
      where escritorio_id = public.meu_escritorio_id()
    )
  );
