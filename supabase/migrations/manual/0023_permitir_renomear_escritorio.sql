-- Garante que a política exista também em bancos que foram criados antes da
-- migração 0012. A rota valida que apenas o responsável pode chamar a ação;
-- a policy limita o UPDATE ao escritório do usuário autenticado.
alter table public.escritorios enable row level security;

drop policy if exists "escritorios_update_own" on public.escritorios;

create policy "escritorios_update_own" on public.escritorios
  for update to authenticated
  using (
    id = (select escritorio_id from public.perfis where id = auth.uid())
  )
  with check (
    id = (select escritorio_id from public.perfis where id = auth.uid())
  );
