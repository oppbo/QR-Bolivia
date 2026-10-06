-- Mi Negocio: aislamiento por negocio (RLS) y permisos mínimos.
-- Los clientes autenticados solo LEEN tablas de su negocio. Todas las escrituras
-- pasan por funciones controladas (ver 20261006000300_functions.sql).

-- ---------------------------------------------------------------------------
-- Funciones auxiliares de pertenencia
-- ---------------------------------------------------------------------------

create or replace function private.member_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select bm.business_id from public.business_members bm where bm.user_id = auth.uid();
$$;

create or replace function private.current_business_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select bm.business_id from public.business_members bm where bm.user_id = auth.uid() limit 1;
$$;

-- Lanza un error de dominio con un código estable que la app traduce al español.
create or replace function private.fail(p_code text, p_detail text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using message = p_code, errcode = 'P0001', detail = coalesce(p_detail, '');
end;
$$;

-- Devuelve el negocio del usuario autenticado o falla.
create or replace function private.require_business()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
begin
  if auth.uid() is null then
    perform private.fail('not_authenticated');
  end if;
  v_business_id := private.current_business_id();
  if v_business_id is null then
    perform private.fail('no_business');
  end if;
  return v_business_id;
end;
$$;

create or replace function private.log_event(
  p_business_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_event_type text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.activity_events (business_id, actor_id, entity_type, entity_id, event_type, metadata)
  values (p_business_id, auth.uid(), p_entity_type, p_entity_id, p_event_type, coalesce(p_metadata, '{}'::jsonb));
$$;

revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.member_business_ids() to authenticated;
grant execute on function private.current_business_id() to authenticated;

-- ---------------------------------------------------------------------------
-- Permisos de tablas: solo lectura para usuarios autenticados, nada para anon.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on
  public.profiles,
  public.businesses,
  public.business_members,
  public.customers,
  public.products,
  public.product_variants,
  public.orders,
  public.order_items,
  public.payments,
  public.refunds,
  public.expenses,
  public.inventory_movements,
  public.activity_events
to authenticated;
-- order_counters no se expone.

-- Evitar que futuras tablas hereden permisos amplios por defecto.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.order_counters enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.expenses enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.activity_events enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));

create policy businesses_select_member on public.businesses
  for select to authenticated using (id in (select private.member_business_ids()));

create policy business_members_select_own on public.business_members
  for select to authenticated using (user_id = (select auth.uid()));

create policy customers_select_member on public.customers
  for select to authenticated using (business_id in (select private.member_business_ids()));
create policy products_select_member on public.products
  for select to authenticated using (business_id in (select private.member_business_ids()));
create policy product_variants_select_member on public.product_variants
  for select to authenticated using (business_id in (select private.member_business_ids()));
create policy orders_select_member on public.orders
  for select to authenticated using (business_id in (select private.member_business_ids()));
create policy order_items_select_member on public.order_items
  for select to authenticated using (business_id in (select private.member_business_ids()));
create policy payments_select_member on public.payments
  for select to authenticated using (business_id in (select private.member_business_ids()));
create policy refunds_select_member on public.refunds
  for select to authenticated using (business_id in (select private.member_business_ids()));
create policy expenses_select_member on public.expenses
  for select to authenticated using (business_id in (select private.member_business_ids()));
create policy inventory_movements_select_member on public.inventory_movements
  for select to authenticated using (business_id in (select private.member_business_ids()));
create policy activity_events_select_member on public.activity_events
  for select to authenticated using (business_id in (select private.member_business_ids()));
-- order_counters: sin políticas => inaccesible para clientes.
