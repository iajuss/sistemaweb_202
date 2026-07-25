-- Liga perfis ao auth.users do Supabase
alter table public.perfis
  add constraint perfis_id_fkey foreign key (id) references auth.users (id) on delete cascade;

-- Habilita RLS em todas as tabelas
alter table public.escritorios enable row level security;
alter table public.perfis enable row level security;
alter table public.empresas enable row level security;
alter table public.empresas_socios enable row level security;
alter table public.divergencias enable row level security;
alter table public.modelos_recorrencia enable row level security;
alter table public.tarefas enable row level security;
alter table public.feriados_cache enable row level security;

-- perfis: usuário só enxerga/edita o próprio perfil
create policy "perfis_select_own" on public.perfis
  for select using (id = auth.uid());
create policy "perfis_update_own" on public.perfis
  for update using (id = auth.uid());

-- escritorios: usuário só enxerga o escritório do próprio perfil
create policy "escritorios_select_own" on public.escritorios
  for select using (
    id = (select escritorio_id from public.perfis where id = auth.uid())
  );

-- Tabelas com escritorio_id: isolamento padrão por tenant
create policy "empresas_isolamento" on public.empresas
  for all using (
    escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
  ) with check (
    escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
  );

create policy "divergencias_isolamento" on public.divergencias
  for all using (
    escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
  ) with check (
    escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
  );

create policy "modelos_recorrencia_isolamento" on public.modelos_recorrencia
  for all using (
    escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
  ) with check (
    escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
  );

create policy "tarefas_isolamento" on public.tarefas
  for all using (
    escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
  ) with check (
    escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
  );

-- empresas_socios: isolamento via join com empresas (não tem escritorio_id direto)
create policy "empresas_socios_isolamento" on public.empresas_socios
  for all using (
    empresa_id in (
      select id from public.empresas
      where escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
    )
  ) with check (
    empresa_id in (
      select id from public.empresas
      where escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
    )
  );

-- feriados_cache: dado global, não sensível — qualquer usuário autenticado lê e popula
create policy "feriados_cache_select" on public.feriados_cache
  for select using (auth.role() = 'authenticated');
create policy "feriados_cache_insert" on public.feriados_cache
  for insert with check (auth.role() = 'authenticated');

-- Gatilho: ao criar um usuário no Supabase Auth, cria o escritório e o perfil dele
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  novo_escritorio_id uuid;
begin
  insert into public.escritorios (nome)
  values (coalesce(new.raw_user_meta_data ->> 'escritorio_nome', 'Meu escritório'))
  returning id into novo_escritorio_id;

  insert into public.perfis (id, escritorio_id, nome)
  values (new.id, novo_escritorio_id, coalesce(new.raw_user_meta_data ->> 'nome', new.email));

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Segurança: evita que usuários mudem seu próprio tenant (escritorio_id)
-- Cada política de RLS confia em perfis.escritorio_id como fonte de verdade
-- Este gatilho garante que escritorio_id nunca possa ser alterado via UPDATE
create or replace function public.prevent_perfil_tenant_change()
returns trigger
language plpgsql
as $$
begin
  new.escritorio_id := old.escritorio_id;
  return new;
end;
$$;

create trigger perfis_lock_escritorio_id
  before update on public.perfis
  for each row execute function public.prevent_perfil_tenant_change();
