-- CORREÇÃO DE SEGURANÇA — escalação de privilégio horizontal→vertical.
--
-- Diagnóstico: a policy "perfis_update_own" (migração 0001) é
--
--   for update using (id = auth.uid())
--
-- sem cláusula WITH CHECK. No Postgres, quando WITH CHECK é omitido numa
-- policy de UPDATE, a expressão do USING é usada também como CHECK — ou seja,
-- a única condição para gravar é "a linha é minha". Nada restringe QUAIS
-- colunas mudam. Um funcionário podia, portanto, rodar
--
--   update public.perfis set papel = 'responsavel' where id = auth.uid();
--
-- e virar responsável do escritório: passa a ver a equipe inteira
-- (GET /api/equipe), convidar gente (POST /api/equipe/convites, que usa a
-- service_role key), renomear o escritório e desativar colegas. Também podia
-- se marcar `ativo = true` depois de ser desativado.
--
-- O caminho de exploração existia porque as checagens de papel moram na
-- aplicação (`perfil.papel !== "responsavel"`), mas o banco é acessível com o
-- access token do próprio usuário — o PostgREST do Supabase aceita o JWT do
-- usuário, e a partir daí só a RLS protege.
--
-- Correção (mínima, sem tocar em policy nem em trigger existentes): a função
-- que já congela `escritorio_id` em todo UPDATE passa a congelar também as
-- colunas de privilégio. Os fluxos legítimos continuam intactos — são só
-- estes três, conferidos um a um no código:
--   - /completar-cadastro grava `nome` e `cadastro_completo` do próprio perfil;
--   - PATCH /api/equipe/:id grava `ativo` de OUTRO perfil (id <> auth.uid()),
--     protegido pela policy "perfis_update_equipe_responsavel";
--   - o trigger `on_auth_user_created` é INSERT, não passa por aqui.

create or replace function public.prevent_perfil_tenant_change()
returns trigger
language plpgsql
as $$
begin
  -- Tenant nunca muda, para ninguém: toda policy de RLS usa
  -- perfis.escritorio_id como fonte de verdade do isolamento.
  new.escritorio_id := old.escritorio_id;

  -- Daqui para baixo, só vale para UPDATE vindo de uma sessão de usuário.
  -- Com auth.uid() nulo (service_role, SQL Editor, jobs, o backfill de email
  -- da migração 0015) nada é congelado — a administração pelo painel do
  -- Supabase continua podendo tudo.
  if auth.uid() is not null then
    -- Privilégio não se dá a si mesmo.
    if old.id = auth.uid() then
      new.ativo := old.ativo;
    end if;

    -- `papel` e `email` não são escritos por nenhuma rota do app (as únicas
    -- escritas em perfis são `nome`/`cadastro_completo` no próprio perfil e
    -- `ativo` em outro), então podem ser congelados sempre. Isso fecha também
    -- o que a policy "perfis_update_equipe_responsavel" (migração 0015)
    -- deixaria em aberto: ela autoriza o responsável a escrever QUALQUER
    -- coluna dos colegas, o que permitiria promover alguém a responsável ou
    -- trocar o e-mail denormalizado usado na checagem de "já faz parte da
    -- equipe" em POST /api/equipe/convites.
    new.papel := old.papel;
    new.email := old.email;
  end if;

  return new;
end;
$$;

-- O trigger `perfis_lock_escritorio_id` (migração 0001) já aponta para esta
-- função — não precisa ser recriado.
