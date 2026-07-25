-- perfis: além do próprio perfil (perfis_select_own, na migração 0001),
-- permite enxergar os colegas do mesmo escritório — necessário para o
-- seletor de responsável no cadastro/edição de empresas (GET /api/perfis).
create policy "perfis_select_escritorio" on public.perfis
  for select using (
    escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
  );
