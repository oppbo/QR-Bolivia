-- Mi Negocio: vistas y consultas de lectura. Todas respetan RLS (security invoker).
--
-- Reglas financieras (espejo exacto de lib/money/order-math.ts; un test de base de
-- datos verifica que ambas coincidan):
--   net_paid     = pagos válidos - reembolsos válidos
--   balance_due  = max(total - net_paid, 0)   si el pedido no está cancelado; 0 si está cancelado
--   refund_due   = max(net_paid, 0)           si el pedido está cancelado; 0 en otro caso
--   payment_state:
--     no cancelado: no_charge (total 0) | paid (net >= total) | partial (net > 0) | pending
--     cancelado:    refund_pending (net > 0) | canceled_settled
-- "Por cobrar" (dashboard, clientes, filtro) solo suma pedidos confirmados, en
-- preparación o entregados: un pedido "Nuevo" todavía no es un compromiso.

create or replace view public.order_summaries
with (security_invoker = true)
as
select
  o.*,
  coalesce(p.paid_cents, 0)::bigint as paid_cents,
  coalesce(r.refunded_cents, 0)::bigint as refunded_cents,
  (coalesce(p.paid_cents, 0) - coalesce(r.refunded_cents, 0))::bigint as net_paid_cents,
  case
    when o.status = 'canceled' then 0
    else greatest(o.total_cents - (coalesce(p.paid_cents, 0) - coalesce(r.refunded_cents, 0)), 0)
  end::bigint as balance_due_cents,
  case
    when o.status = 'canceled' then greatest(coalesce(p.paid_cents, 0) - coalesce(r.refunded_cents, 0), 0)
    else 0
  end::bigint as refund_due_cents,
  case
    when o.status = 'canceled' then
      case when coalesce(p.paid_cents, 0) - coalesce(r.refunded_cents, 0) > 0
           then 'refund_pending' else 'canceled_settled' end
    when o.total_cents = 0 then 'no_charge'
    when coalesce(p.paid_cents, 0) - coalesce(r.refunded_cents, 0) >= o.total_cents then 'paid'
    when coalesce(p.paid_cents, 0) - coalesce(r.refunded_cents, 0) > 0 then 'partial'
    else 'pending'
  end as payment_state,
  (o.status in ('confirmed', 'preparing', 'delivered')) as is_collectible
from public.orders o
left join lateral (
  select sum(pa.amount_cents) as paid_cents
  from public.payments pa
  where pa.business_id = o.business_id and pa.order_id = o.id and pa.voided_at is null
) p on true
left join lateral (
  select sum(re.amount_cents) as refunded_cents
  from public.refunds re
  where re.business_id = o.business_id and re.order_id = o.id and re.voided_at is null
) r on true;

grant select on public.order_summaries to authenticated;

-- Variantes con disponible calculado: available = on_hand - reserved.
create or replace view public.variant_stock
with (security_invoker = true)
as
select
  v.*,
  (v.on_hand - v.reserved) as available,
  (v.track_inventory and (v.on_hand - v.reserved) <= v.low_stock_threshold) as is_low_stock,
  (v.track_inventory and (v.on_hand - v.reserved) = 0) as is_out_of_stock
from public.product_variants v;

grant select on public.variant_stock to authenticated;

-- ---------------------------------------------------------------------------
-- Listado de pedidos con búsqueda, filtros y paginación en el servidor
-- ---------------------------------------------------------------------------

create or replace function public.list_orders(
  p_search text default null,
  p_status text default null,
  p_payment_state text default null,
  p_fulfillment_type text default null,
  p_from date default null,
  p_to date default null,
  p_quick text default null,
  p_today date default null,
  p_customer_id uuid default null,
  p_sort text default 'created_desc',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  code text,
  number bigint,
  customer_id uuid,
  customer_name text,
  customer_phone text,
  status text,
  fulfillment_type text,
  promised_date date,
  time_window text,
  total_cents bigint,
  net_paid_cents bigint,
  balance_due_cents bigint,
  refund_due_cents bigint,
  payment_state text,
  created_at timestamptz,
  confirmed_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_business_id uuid := private.current_business_id();
  v_search text := nullif(btrim(p_search), '');
  v_like text;
  v_digits text;
begin
  if v_search is not null then
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_digits := regexp_replace(v_search, '[^0-9]', '', 'g');
  end if;

  return query
  select
    s.id, s.code, s.number, s.customer_id, s.customer_name, s.customer_phone, s.status,
    s.fulfillment_type, s.promised_date, s.time_window, s.total_cents, s.net_paid_cents,
    s.balance_due_cents, s.refund_due_cents, s.payment_state, s.created_at, s.confirmed_at,
    count(*) over () as total_count
  from public.order_summaries s
  where s.business_id = v_business_id
    and (v_search is null
         or s.code ilike v_like
         or s.customer_name ilike v_like
         or (length(v_digits) >= 3 and s.customer_phone like '%' || v_digits || '%')
         or (v_digits <> '' and v_digits = s.number::text))
    and (p_status is null or s.status = p_status)
    and (p_payment_state is null or s.payment_state = p_payment_state)
    and (p_fulfillment_type is null or s.fulfillment_type = p_fulfillment_type)
    and (p_from is null or s.promised_date >= p_from)
    and (p_to is null or s.promised_date <= p_to)
    and (p_customer_id is null or s.customer_id = p_customer_id)
    and (
      p_quick is null
      or (p_quick = 'today' and s.promised_date = p_today and s.status in ('new', 'confirmed', 'preparing'))
      or (p_quick = 'overdue' and s.promised_date < p_today and s.status in ('new', 'confirmed', 'preparing'))
      or (p_quick = 'balance' and s.is_collectible and s.balance_due_cents > 0)
    )
  order by
    case when p_sort = 'promised_asc' then s.promised_date end asc nulls last,
    case when p_sort = 'created_asc' then s.created_at end asc,
    case when p_sort = 'balance_desc' then s.balance_due_cents end desc,
    s.created_at desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Productos con variantes y stock
-- ---------------------------------------------------------------------------

create or replace function public.list_products(
  p_search text default null,
  p_archived boolean default false,
  p_low_stock boolean default false,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  name text,
  category text,
  image_path text,
  archived_at timestamptz,
  variants jsonb,
  total_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_business_id uuid := private.current_business_id();
  v_search text := nullif(btrim(p_search), '');
  v_like text;
begin
  if v_search is not null then
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
  select
    p.id, p.name, p.category, p.image_path, p.archived_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'sku', v.sku, 'size', v.size, 'color', v.color,
        'price_cents', v.price_cents, 'track_inventory', v.track_inventory,
        'on_hand', v.on_hand, 'reserved', v.reserved, 'available', v.available,
        'low_stock_threshold', v.low_stock_threshold,
        'is_low_stock', v.is_low_stock, 'is_out_of_stock', v.is_out_of_stock
      ) order by v.position, v.created_at)
      from public.variant_stock v
      where v.business_id = p.business_id and v.product_id = p.id and v.archived_at is null
    ), '[]'::jsonb) as variants,
    count(*) over () as total_count
  from public.products p
  where p.business_id = v_business_id
    and ((p_archived and p.archived_at is not null) or (not p_archived and p.archived_at is null))
    and (v_search is null
         or p.name ilike v_like
         or exists (select 1 from public.product_variants v
                    where v.business_id = p.business_id and v.product_id = p.id and v.sku ilike v_like))
    and (not p_low_stock or exists (
      select 1 from public.variant_stock v
      where v.business_id = p.business_id and v.product_id = p.id and v.archived_at is null and v.is_low_stock))
  order by p.name asc, p.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Variantes vendibles para el formulario de pedido (búsqueda acotada).
create or replace function public.search_sellable_variants(p_search text default null, p_limit integer default 30)
returns table (
  variant_id uuid,
  product_id uuid,
  product_name text,
  sku text,
  size text,
  color text,
  price_cents bigint,
  track_inventory boolean,
  available integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select v.id, p.id, p.name, v.sku, v.size, v.color, v.price_cents, v.track_inventory,
         (v.on_hand - v.reserved)::integer
  from public.product_variants v
  join public.products p on p.business_id = v.business_id and p.id = v.product_id
  where v.business_id = private.current_business_id()
    and v.archived_at is null and p.archived_at is null
    and (nullif(btrim(p_search), '') is null
         or p.name ilike '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
         or v.sku ilike '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%')
  order by p.name, v.position, v.created_at
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

-- ---------------------------------------------------------------------------
-- Clientes con saldos
-- ---------------------------------------------------------------------------

create or replace function public.list_customers(
  p_search text default null,
  p_archived boolean default false,
  p_with_balance boolean default false,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  name text,
  phone text,
  archived_at timestamptz,
  order_count bigint,
  balance_due_cents bigint,
  total_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_business_id uuid := private.current_business_id();
  v_search text := nullif(btrim(p_search), '');
  v_like text;
  v_digits text;
begin
  if v_search is not null then
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_digits := regexp_replace(v_search, '[^0-9]', '', 'g');
  end if;
  return query
  with balances as (
    select s.customer_id,
           count(*) as order_count,
           coalesce(sum(s.balance_due_cents) filter (where s.is_collectible), 0)::bigint as balance_due_cents
    from public.order_summaries s
    where s.business_id = v_business_id and s.customer_id is not null
    group by s.customer_id
  )
  select c.id, c.name, c.phone, c.archived_at,
         coalesce(b.order_count, 0)::bigint,
         coalesce(b.balance_due_cents, 0)::bigint,
         count(*) over ()
  from public.customers c
  left join balances b on b.customer_id = c.id
  where c.business_id = v_business_id
    and ((p_archived and c.archived_at is not null) or (not p_archived and c.archived_at is null))
    and (v_search is null
         or c.name ilike v_like
         or (length(v_digits) >= 3 and c.phone like '%' || v_digits || '%'))
    and (not p_with_balance or coalesce(b.balance_due_cents, 0) > 0)
  order by c.name asc, c.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.customer_totals(p_customer_id uuid)
returns table (
  order_count bigint,
  net_paid_cents bigint,
  balance_due_cents bigint,
  refund_due_cents bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::bigint,
         coalesce(sum(s.net_paid_cents), 0)::bigint,
         coalesce(sum(s.balance_due_cents) filter (where s.is_collectible), 0)::bigint,
         coalesce(sum(s.refund_due_cents), 0)::bigint
  from public.order_summaries s
  where s.business_id = private.current_business_id() and s.customer_id = p_customer_id;
$$;

-- ---------------------------------------------------------------------------
-- Inicio y Caja
-- p_start/p_end: límites UTC del rango local (calculados en lib/dates con la zona
-- horaria del negocio). p_today: fecha local del negocio.
-- ---------------------------------------------------------------------------

create or replace function public.dashboard_summary(p_start timestamptz, p_end timestamptz, p_today date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with b as (select private.current_business_id() as id)
  select jsonb_build_object(
    'sales_confirmed_cents', (
      select coalesce(sum(o.total_cents), 0) from public.orders o, b
      where o.business_id = b.id and o.status <> 'canceled'
        and o.confirmed_at >= p_start and o.confirmed_at < p_end),
    'sales_confirmed_count', (
      select count(*) from public.orders o, b
      where o.business_id = b.id and o.status <> 'canceled'
        and o.confirmed_at >= p_start and o.confirmed_at < p_end),
    'collected_cents', (
      select coalesce(sum(pa.amount_cents), 0) from public.payments pa, b
      where pa.business_id = b.id and pa.voided_at is null
        and pa.occurred_at >= p_start and pa.occurred_at < p_end),
    'refunded_cents', (
      select coalesce(sum(re.amount_cents), 0) from public.refunds re, b
      where re.business_id = b.id and re.voided_at is null
        and re.occurred_at >= p_start and re.occurred_at < p_end),
    'receivable_cents', (
      select coalesce(sum(s.balance_due_cents), 0) from public.order_summaries s, b
      where s.business_id = b.id and s.is_collectible),
    'receivable_count', (
      select count(*) from public.order_summaries s, b
      where s.business_id = b.id and s.is_collectible and s.balance_due_cents > 0),
    'due_today_delivery', (
      select count(*) from public.orders o, b
      where o.business_id = b.id and o.status in ('new', 'confirmed', 'preparing')
        and o.promised_date = p_today and o.fulfillment_type = 'delivery'),
    'due_today_pickup', (
      select count(*) from public.orders o, b
      where o.business_id = b.id and o.status in ('new', 'confirmed', 'preparing')
        and o.promised_date = p_today and o.fulfillment_type = 'pickup'),
    'overdue_count', (
      select count(*) from public.orders o, b
      where o.business_id = b.id and o.status in ('new', 'confirmed', 'preparing')
        and o.promised_date < p_today),
    'product_count', (
      select count(*) from public.products p, b where p.business_id = b.id and p.archived_at is null),
    'order_count', (
      select count(*) from public.orders o, b where o.business_id = b.id)
  );
$$;

create or replace function public.cash_summary(p_start timestamptz, p_end timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with b as (select private.current_business_id() as id),
  entries as (
    select 'payment' as kind, pa.method, pa.amount_cents
      from public.payments pa, b
      where pa.business_id = b.id and pa.voided_at is null
        and pa.occurred_at >= p_start and pa.occurred_at < p_end
    union all
    select 'refund', re.method, re.amount_cents
      from public.refunds re, b
      where re.business_id = b.id and re.voided_at is null
        and re.occurred_at >= p_start and re.occurred_at < p_end
    union all
    select 'expense', ex.method, ex.amount_cents
      from public.expenses ex, b
      where ex.business_id = b.id and ex.voided_at is null
        and ex.occurred_at >= p_start and ex.occurred_at < p_end
  ),
  methods as (
    select m.method,
      coalesce(sum(e.amount_cents) filter (where e.kind = 'payment'), 0) as payments_cents,
      coalesce(sum(e.amount_cents) filter (where e.kind = 'refund'), 0) as refunds_cents,
      coalesce(sum(e.amount_cents) filter (where e.kind = 'expense'), 0) as expenses_cents
    from (values ('cash', 1), ('qr', 2), ('transfer', 3), ('other', 4)) as m(method, ord)
    left join entries e on e.method = m.method
    group by m.method, m.ord
    order by m.ord
  )
  select jsonb_build_object(
    'payments_cents', coalesce((select sum(amount_cents) from entries where kind = 'payment'), 0),
    'refunds_cents', coalesce((select sum(amount_cents) from entries where kind = 'refund'), 0),
    'expenses_cents', coalesce((select sum(amount_cents) from entries where kind = 'expense'), 0),
    'by_method', (select jsonb_agg(jsonb_build_object(
        'method', method,
        'payments_cents', payments_cents,
        'refunds_cents', refunds_cents,
        'expenses_cents', expenses_cents)) from methods)
  );
$$;

-- Lista cronológica unificada (incluye anulados, marcados, para el historial).
create or replace function public.cash_entries(
  p_start timestamptz,
  p_end timestamptz,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  kind text,
  id uuid,
  amount_cents bigint,
  method text,
  occurred_at timestamptz,
  order_id uuid,
  order_code text,
  customer_name text,
  category text,
  description text,
  voided_at timestamptz,
  void_reason text,
  has_receipt boolean,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with b as (select private.current_business_id() as id),
  e as (
    select 'payment'::text as kind, pa.id, pa.amount_cents, pa.method, pa.occurred_at, pa.created_at,
           pa.order_id, o.code as order_code, o.customer_name, null::text as category,
           pa.reference as description, pa.voided_at, pa.void_reason, pa.receipt_path is not null as has_receipt
      from public.payments pa
      join public.orders o on o.business_id = pa.business_id and o.id = pa.order_id, b
      where pa.business_id = b.id and pa.occurred_at >= p_start and pa.occurred_at < p_end
    union all
    select 'refund', re.id, re.amount_cents, re.method, re.occurred_at, re.created_at,
           re.order_id, o.code, o.customer_name, null, re.reason, re.voided_at, re.void_reason, false
      from public.refunds re
      join public.orders o on o.business_id = re.business_id and o.id = re.order_id, b
      where re.business_id = b.id and re.occurred_at >= p_start and re.occurred_at < p_end
    union all
    select 'expense', ex.id, ex.amount_cents, ex.method, ex.occurred_at, ex.created_at,
           null, null, null, ex.category, ex.description, ex.voided_at, ex.void_reason,
           ex.receipt_path is not null
      from public.expenses ex, b
      where ex.business_id = b.id and ex.occurred_at >= p_start and ex.occurred_at < p_end
  )
  select kind, id, amount_cents, method, occurred_at, order_id, order_code, customer_name,
         category, description, voided_at, void_reason, has_receipt, count(*) over ()
  from e
  order by occurred_at desc, created_at desc, id
  limit least(greatest(coalesce(p_limit, 25), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke execute on function
  public.list_orders(text, text, text, text, date, date, text, date, uuid, text, integer, integer),
  public.list_products(text, boolean, boolean, integer, integer),
  public.search_sellable_variants(text, integer),
  public.list_customers(text, boolean, boolean, integer, integer),
  public.customer_totals(uuid),
  public.dashboard_summary(timestamptz, timestamptz, date),
  public.cash_summary(timestamptz, timestamptz),
  public.cash_entries(timestamptz, timestamptz, integer, integer)
from public, anon;

grant execute on function
  public.list_orders(text, text, text, text, date, date, text, date, uuid, text, integer, integer),
  public.list_products(text, boolean, boolean, integer, integer),
  public.search_sellable_variants(text, integer),
  public.list_customers(text, boolean, boolean, integer, integer),
  public.customer_totals(uuid),
  public.dashboard_summary(timestamptz, timestamptz, date),
  public.cash_summary(timestamptz, timestamptz),
  public.cash_entries(timestamptz, timestamptz, integer, integer)
to authenticated;
