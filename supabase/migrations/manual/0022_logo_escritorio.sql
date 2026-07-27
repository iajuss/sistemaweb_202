-- Logo institucional do escritório, com arquivos pequenos e públicos apenas
-- para exibição na própria interface. A escrita continua restrita ao responsável.
alter table public.escritorios add column if not exists logo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos-clientes', 'logos-clientes', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "logos_clientes_insert_responsavel" on storage.objects;
create policy "logos_clientes_insert_responsavel" on storage.objects for insert to authenticated
with check (
  bucket_id = 'logos-clientes'
  and exists (
    select 1 from public.perfis p
    where p.id = auth.uid()
      and p.papel = 'responsavel'
      and p.escritorio_id::text = (storage.foldername(name))[1]
  )
);

drop policy if exists "logos_clientes_delete_responsavel" on storage.objects;
create policy "logos_clientes_delete_responsavel" on storage.objects for delete to authenticated
using (
  bucket_id = 'logos-clientes'
  and exists (
    select 1 from public.perfis p
    where p.id = auth.uid()
      and p.papel = 'responsavel'
      and p.escritorio_id::text = (storage.foldername(name))[1]
  )
);
