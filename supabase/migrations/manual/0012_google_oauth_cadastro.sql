-- Login com Google: contas criadas por provedor externo não informam o nome do
-- escritório, então nascem com cadastro_completo = false e o app pede os dados
-- na primeira entrada (/completar-cadastro).
--
-- Obs.: o arquivo gerado pelo drizzle (0001_right_chimera.sql) traz esta mesma
-- coluna junto de outras alterações que já foram aplicadas manualmente antes.
-- Execute ESTE arquivo, não aquele.

alter table public.perfis
  add column if not exists cadastro_completo boolean not null default true;

-- Mesma função de antes, agora gravando cadastro_completo.
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

  insert into public.perfis (id, escritorio_id, nome, cadastro_completo)
  values (
    new.id,
    novo_escritorio_id,
    coalesce(new.raw_user_meta_data ->> 'nome', new.email),
    new.raw_user_meta_data ? 'escritorio_nome'
  );

  return new;
end;
$$;

-- escritorios só tinha política de SELECT; sem UPDATE o usuário não consegue
-- renomear o próprio escritório em /completar-cadastro.
create policy "escritorios_update_own" on public.escritorios
  for update using (
    id = (select escritorio_id from public.perfis where id = auth.uid())
  ) with check (
    id = (select escritorio_id from public.perfis where id = auth.uid())
  );
