-- CORREÇÃO URGENTE de um bug em 0002_perfis_escritorio_select.sql.
--
-- Diagnóstico: a policy "perfis_select_escritorio" foi criada na própria
-- tabela `perfis`, e sua cláusula USING faz um SELECT em `public.perfis`:
--
--   escritorio_id = (select escritorio_id from public.perfis where id = auth.uid())
--
-- Como essa policy está definida NA MESMA tabela que consulta, o Postgres
-- precisa reavaliar as policies de `perfis` (perfis_select_own OR
-- perfis_select_escritorio) para resolver o próprio subquery — que por sua
-- vez dispara a mesma reavaliação de novo, num loop infinito. Isso derruba
-- toda leitura de `perfis` (e, em cascata, qualquer policy de outra tabela
-- que faça `select escritorio_id from public.perfis where id = auth.uid()`,
-- ou seja, praticamente todas: empresas, empresas_socios, divergencias,
-- modelos_recorrencia, tarefas, escritorios) com o erro:
--
--   ERROR: infinite recursion detected in policy for relation "perfis" (SQLSTATE 42P17)
--
-- Esse padrão (`select ... from public.perfis where id = auth.uid()` dentro
-- de uma policy de OUTRA tabela, como em `empresas_isolamento` ou
-- `escritorios_select_own`) é seguro — não recursa, porque a policy avaliada
-- é a de `perfis`, tabela diferente da que originou a checagem. O problema é
-- exclusivo de uma policy de SELECT na própria `perfis` reconsultando
-- `perfis`.
--
-- Solução padrão do Supabase para este caso: mover a leitura para uma
-- função `security definer`. A função roda com os privilégios de quem a
-- criou (o dono da tabela); como não demos `force row level security` em
-- `perfis`, o dono da tabela não sofre RLS ao consultá-la — logo a consulta
-- interna da função não reaciona a policy, quebrando o ciclo.

drop policy if exists "perfis_select_escritorio" on public.perfis;

create or replace function public.meu_escritorio_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select escritorio_id from public.perfis where id = auth.uid()
$$;

create policy "perfis_select_escritorio" on public.perfis
  for select using (
    escritorio_id = public.meu_escritorio_id()
  );
