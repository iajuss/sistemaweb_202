-- Workspace multiusuário: papel (responsavel/funcionario), e-mail
-- denormalizado (pra listar a equipe sem chamar a Admin API) e ativo
-- (desativar sem apagar o perfil — responsavel_id em empresas/tarefas
-- depende dele existir). Ver docs/superpowers/specs/2026-07-27-workspace-equipe-design.md.

alter table public.perfis
  add column if not exists email text not null default '',
  add column if not exists papel text not null default 'responsavel'
    check (papel in ('responsavel','funcionario')),
  add column if not exists ativo boolean not null default true;

-- Backfill do email pros perfis que já existiam antes desta coluna.
update public.perfis p
set email = u.email
from auth.users u
where p.id = u.id and p.email = '';

-- Substitui a função de 0012: agora decide, pelo metadado
-- `escritorio_id` do convite, se o novo perfil entra num escritório
-- existente (convite) ou cria um escritório novo (cadastro normal/Google).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  escritorio_convite uuid;
  novo_escritorio_id uuid;
begin
  escritorio_convite := (new.raw_user_meta_data ->> 'escritorio_id')::uuid;

  if escritorio_convite is not null then
    insert into public.perfis (id, escritorio_id, nome, email, papel, cadastro_completo)
    values (new.id, escritorio_convite, '', new.email, 'funcionario', false);
  else
    insert into public.escritorios (nome)
    values (coalesce(new.raw_user_meta_data ->> 'escritorio_nome', 'Meu escritório'))
    returning id into novo_escritorio_id;

    insert into public.perfis (id, escritorio_id, nome, email, papel, cadastro_completo)
    values (
      new.id,
      novo_escritorio_id,
      coalesce(new.raw_user_meta_data ->> 'nome', new.email),
      new.email,
      'responsavel',
      new.raw_user_meta_data ? 'escritorio_nome'
    );
  end if;

  return new;
end;
$$;

-- Reaproveita o padrão security-definer de 0003 (meu_escritorio_id) pra
-- evitar o mesmo bug de recursão infinita numa policy de SELECT/UPDATE em
-- perfis que reconsulta perfis.
create or replace function public.sou_responsavel()
returns boolean
language sql security definer stable set search_path = public
as $$
  select papel = 'responsavel' from public.perfis where id = auth.uid()
$$;

create policy "perfis_update_equipe_responsavel" on public.perfis
  for update using (
    escritorio_id = public.meu_escritorio_id() and public.sou_responsavel()
  ) with check (
    escritorio_id = public.meu_escritorio_id()
  );
