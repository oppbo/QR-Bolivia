-- Mi Negocio: almacenamiento privado de archivos (logo, QR de cobro, fotos de
-- productos y comprobantes). Ruta obligatoria: <business_id>/<carpeta>/<nombre aleatorio>.<ext>
-- Solo JPEG, PNG y WebP, máximo 5 MB. Sin acceso público: las descargas usan URLs
-- firmadas de corta duración generadas con la sesión del dueño.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-files', 'business-files', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.storage_business_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_first text := split_part(p_name, '/', 1);
begin
  if v_first ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v_first::uuid;
  end if;
  return null;
end;
$$;

create or replace function private.storage_path_allowed(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_name ~ '^[0-9a-fA-F-]{36}/(logo|qr|products|receipts)/[A-Za-z0-9_-]{16,64}\.(jpg|png|webp)$';
$$;

grant execute on function private.storage_business_id(text) to authenticated;
grant execute on function private.storage_path_allowed(text) to authenticated;

create policy business_files_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'business-files'
    and private.storage_business_id(name) in (select private.member_business_ids())
  );

create policy business_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'business-files'
    and private.storage_path_allowed(name)
    and private.storage_business_id(name) in (select private.member_business_ids())
  );

create policy business_files_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'business-files'
    and private.storage_business_id(name) in (select private.member_business_ids())
  );
-- Sin política de UPDATE: los archivos no se sobrescriben; se sube uno nuevo con otro nombre.
