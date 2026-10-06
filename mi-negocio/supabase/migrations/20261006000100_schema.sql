-- Mi Negocio: esquema base.
-- Dinero: enteros en centavos (bigint). Fechas/horas: timestamptz (UTC).
-- Cada fila de negocio lleva business_id; las FK compuestas (business_id, id)
-- impiden referenciar filas de otro negocio aunque se conozca su UUID.

create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------

create or replace function private.is_valid_timezone(tz text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  perform now() at time zone tz;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Perfiles, negocios y membresías
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  currency text not null default 'BOB' check (currency = 'BOB'),
  timezone text not null default 'America/La_Paz' check (private.is_valid_timezone(timezone)),
  whatsapp_phone text check (whatsapp_phone ~ '^\+[1-9][0-9]{6,14}$'),
  pickup_address text check (char_length(pickup_address) <= 300),
  pickup_reference text check (char_length(pickup_reference) <= 300),
  logo_path text,
  payment_qr_path text,
  payment_qr_label text check (char_length(payment_qr_label) <= 160),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1
);

-- Primera versión: un dueño por negocio y un negocio por usuario.
-- La tabla permite otros roles en el futuro (invitaciones no implementadas).
create table public.business_members (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create unique index business_members_one_business_per_user on public.business_members (user_id);
create unique index business_members_one_owner_per_business on public.business_members (business_id) where role = 'owner';

-- Contador de números de pedido por negocio (se incrementa con bloqueo de fila).
create table public.order_counters (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  last_number bigint not null default 0 check (last_number >= 0)
);

-- ---------------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------------

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  phone text check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  address text check (char_length(address) <= 300),
  delivery_reference text check (char_length(delivery_reference) <= 300),
  notes text check (char_length(notes) <= 2000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  unique (business_id, id)
);
create index customers_business_name_idx on public.customers using gin (name extensions.gin_trgm_ops);
create index customers_business_phone_idx on public.customers (business_id, phone) where phone is not null;
create index customers_business_created_idx on public.customers (business_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Productos y variantes
-- ---------------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (char_length(description) <= 1000),
  category text check (char_length(category) <= 60),
  image_path text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  unique (business_id, id)
);
create index products_business_name_idx on public.products using gin (name extensions.gin_trgm_ops);
create index products_business_created_idx on public.products (business_id, created_at desc);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  product_id uuid not null,
  sku text check (sku is null or char_length(btrim(sku)) between 1 and 60),
  size text check (size is null or char_length(btrim(size)) between 1 and 40),
  color text check (color is null or char_length(btrim(color)) between 1 and 40),
  price_cents bigint not null check (price_cents >= 0 and price_cents <= 100000000),
  cost_cents bigint check (cost_cents is null or (cost_cents >= 0 and cost_cents <= 100000000)),
  track_inventory boolean not null default true,
  on_hand integer not null default 0 check (on_hand >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  low_stock_threshold integer not null default 2 check (low_stock_threshold >= 0),
  position integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  unique (business_id, id),
  constraint product_variants_product_fk foreign key (business_id, product_id)
    references public.products (business_id, id) on delete cascade,
  -- Nunca reservar más de lo que hay en existencia.
  constraint product_variants_reserved_le_on_hand check (reserved <= on_hand),
  -- Sin control de inventario no hay reservas.
  constraint product_variants_untracked_no_reservations check (track_inventory or reserved = 0)
);
create unique index product_variants_sku_unique
  on public.product_variants (business_id, lower(sku)) where sku is not null;
create unique index product_variants_options_unique
  on public.product_variants (product_id, coalesce(lower(size), ''), coalesce(lower(color), ''))
  where archived_at is null;
create index product_variants_product_idx on public.product_variants (business_id, product_id);

-- ---------------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  number bigint not null check (number > 0),
  code text generated always as ('PED-' || lpad(number::text, 6, '0')) stored,
  customer_id uuid,
  customer_name text check (customer_name is null or char_length(customer_name) <= 120),
  customer_phone text check (customer_phone is null or customer_phone ~ '^\+[1-9][0-9]{6,14}$'),
  status text not null default 'new'
    check (status in ('new', 'confirmed', 'preparing', 'delivered', 'canceled')),
  fulfillment_type text not null check (fulfillment_type in ('pickup', 'delivery')),
  promised_date date,
  time_window text check (char_length(time_window) <= 60),
  delivery_address text check (char_length(delivery_address) <= 300),
  delivery_reference text check (char_length(delivery_reference) <= 300),
  notes text check (char_length(notes) <= 2000),
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  delivery_fee_cents bigint not null default 0 check (delivery_fee_cents >= 0 and delivery_fee_cents <= 100000000),
  total_cents bigint not null default 0 check (total_cents >= 0),
  confirmed_at timestamptz,
  preparing_at timestamptz,
  delivered_at timestamptz,
  canceled_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(btrim(cancel_reason)) between 1 and 500),
  canceled_from_status text check (canceled_from_status in ('new', 'confirmed', 'preparing', 'delivered')),
  returned_to_stock boolean,
  create_idempotency_key uuid not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  unique (business_id, id),
  unique (business_id, number),
  unique (business_id, create_idempotency_key),
  constraint orders_customer_fk foreign key (business_id, customer_id)
    references public.customers (business_id, id),
  constraint orders_discount_le_subtotal check (discount_cents <= subtotal_cents),
  constraint orders_total_formula check (total_cents = subtotal_cents - discount_cents + delivery_fee_cents),
  constraint orders_confirmed_has_timestamp check (status = 'new' or status = 'canceled' or confirmed_at is not null),
  constraint orders_delivered_has_timestamp check (status <> 'delivered' or delivered_at is not null),
  constraint orders_canceled_complete check (
    status <> 'canceled' or (canceled_at is not null and cancel_reason is not null and canceled_from_status is not null)
  ),
  constraint orders_return_decision check (
    status <> 'canceled' or canceled_from_status <> 'delivered' or returned_to_stock is not null
  )
);
create index orders_business_created_idx on public.orders (business_id, created_at desc);
create index orders_business_status_idx on public.orders (business_id, status);
create index orders_business_promised_idx on public.orders (business_id, promised_date) where promised_date is not null;
create index orders_business_confirmed_idx on public.orders (business_id, confirmed_at) where confirmed_at is not null;
create index orders_business_customer_idx on public.orders (business_id, customer_id) where customer_id is not null;
create index orders_customer_name_trgm_idx on public.orders using gin (customer_name extensions.gin_trgm_ops);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  order_id uuid not null,
  variant_id uuid not null,
  product_name text not null,
  variant_label text,
  sku text,
  quantity integer not null check (quantity > 0 and quantity <= 10000),
  unit_price_cents bigint not null check (unit_price_cents >= 0 and unit_price_cents <= 100000000),
  unit_cost_cents bigint check (unit_cost_cents is null or unit_cost_cents >= 0),
  line_total_cents bigint not null,
  -- Estado de inventario de la línea: evita reservar, descontar o reponer dos veces.
  stock_state text not null default 'none'
    check (stock_state in ('none', 'untracked', 'reserved', 'released', 'deducted', 'returned')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  constraint order_items_order_fk foreign key (business_id, order_id)
    references public.orders (business_id, id) on delete cascade,
  constraint order_items_variant_fk foreign key (business_id, variant_id)
    references public.product_variants (business_id, id),
  constraint order_items_line_total check (line_total_cents = quantity * unit_price_cents)
);
create index order_items_order_idx on public.order_items (business_id, order_id);
create index order_items_variant_idx on public.order_items (business_id, variant_id);

-- ---------------------------------------------------------------------------
-- Pagos, reembolsos y gastos (historial de solo agregado, con anulación auditable)
-- ---------------------------------------------------------------------------

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  order_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000),
  method text not null check (method in ('cash', 'qr', 'transfer', 'other')),
  occurred_at timestamptz not null,
  reference text check (char_length(reference) <= 120),
  note text check (char_length(note) <= 500),
  receipt_path text,
  idempotency_key uuid not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text,
  unique (business_id, id),
  unique (business_id, order_id, id),
  unique (business_id, idempotency_key),
  constraint payments_order_fk foreign key (business_id, order_id)
    references public.orders (business_id, id) on delete cascade,
  constraint payments_void_complete check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and char_length(btrim(void_reason)) between 1 and 500)
  )
);
create index payments_order_idx on public.payments (business_id, order_id);
create index payments_occurred_idx on public.payments (business_id, occurred_at desc);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  order_id uuid not null,
  payment_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000),
  method text not null check (method in ('cash', 'qr', 'transfer', 'other')),
  occurred_at timestamptz not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  idempotency_key uuid not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text,
  unique (business_id, id),
  unique (business_id, idempotency_key),
  -- El reembolso debe referirse a un pago del mismo pedido y negocio.
  constraint refunds_payment_fk foreign key (business_id, order_id, payment_id)
    references public.payments (business_id, order_id, id) on delete cascade,
  constraint refunds_void_complete check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and char_length(btrim(void_reason)) between 1 and 500)
  )
);
create index refunds_order_idx on public.refunds (business_id, order_id);
create index refunds_payment_idx on public.refunds (business_id, payment_id);
create index refunds_occurred_idx on public.refunds (business_id, occurred_at desc);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents <= 100000000),
  category text not null
    check (category in ('transport', 'rent', 'utilities', 'packaging', 'marketing', 'other')),
  method text not null check (method in ('cash', 'qr', 'transfer', 'other')),
  occurred_at timestamptz not null,
  description text check (char_length(description) <= 300),
  receipt_path text,
  idempotency_key uuid not null,
  replaces_expense_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text,
  unique (business_id, id),
  unique (business_id, idempotency_key),
  constraint expenses_replaces_fk foreign key (business_id, replaces_expense_id)
    references public.expenses (business_id, id),
  constraint expenses_void_complete check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and char_length(btrim(void_reason)) between 1 and 500)
  )
);
create index expenses_occurred_idx on public.expenses (business_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Movimientos de inventario y actividad
-- ---------------------------------------------------------------------------

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  variant_id uuid not null,
  order_id uuid,
  movement_type text not null
    check (movement_type in ('initial', 'adjustment', 'reserve', 'release', 'deliver', 'return')),
  on_hand_delta integer not null,
  reserved_delta integer not null,
  on_hand_after integer not null check (on_hand_after >= 0),
  reserved_after integer not null check (reserved_after >= 0),
  reason text check (char_length(reason) <= 300),
  actor_id uuid references auth.users (id) on delete set null,
  operation_key text not null,
  created_at timestamptz not null default now(),
  unique (business_id, operation_key),
  constraint inventory_movements_variant_fk foreign key (business_id, variant_id)
    references public.product_variants (business_id, id) on delete cascade,
  constraint inventory_movements_order_fk foreign key (business_id, order_id)
    references public.orders (business_id, id) on delete cascade,
  constraint inventory_movements_nonzero check (on_hand_delta <> 0 or reserved_delta <> 0)
);
create index inventory_movements_variant_idx on public.inventory_movements (business_id, variant_id, created_at desc);

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  entity_type text not null check (entity_type in ('business', 'order', 'product', 'customer', 'expense')),
  entity_id uuid not null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_events_business_idx on public.activity_events (business_id, created_at desc);
create index activity_events_entity_idx on public.activity_events (business_id, entity_type, entity_id, created_at desc);

-- updated_at automático
create trigger profiles_touch before update on public.profiles for each row execute function private.touch_updated_at();
create trigger businesses_touch before update on public.businesses for each row execute function private.touch_updated_at();
create trigger customers_touch before update on public.customers for each row execute function private.touch_updated_at();
create trigger products_touch before update on public.products for each row execute function private.touch_updated_at();
create trigger product_variants_touch before update on public.product_variants for each row execute function private.touch_updated_at();
create trigger orders_touch before update on public.orders for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Inmutabilidad de instantáneas e historial financiero
-- ---------------------------------------------------------------------------

-- Las líneas de pedido solo se pueden borrar/reemplazar mientras el pedido está en "Nuevo";
-- después, solo cambia stock_state.
create or replace function private.guard_order_items()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_op = 'UPDATE' then
    if (new.order_id, new.variant_id, new.product_name, new.variant_label, new.sku, new.quantity,
        new.unit_price_cents, new.unit_cost_cents, new.line_total_cents, new.business_id)
       is distinct from
       (old.order_id, old.variant_id, old.product_name, old.variant_label, old.sku, old.quantity,
        old.unit_price_cents, old.unit_cost_cents, old.line_total_cents, old.business_id) then
      raise exception using message = 'immutable_snapshot', errcode = 'P0001';
    end if;
    return new;
  end if;
  select status into v_status from public.orders where id = coalesce(new.order_id, old.order_id);
  if v_status is not null and v_status <> 'new' then
    raise exception using message = 'order_not_editable', errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger order_items_guard before insert or update or delete on public.order_items
  for each row execute function private.guard_order_items();

-- Montos de un pedido confirmado quedan congelados.
create or replace function private.guard_order_money()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'new'
     and (new.subtotal_cents, new.discount_cents, new.delivery_fee_cents, new.total_cents,
          new.number, new.business_id, new.customer_id)
         is distinct from
         (old.subtotal_cents, old.discount_cents, old.delivery_fee_cents, old.total_cents,
          old.number, old.business_id, old.customer_id) then
    raise exception using message = 'order_terms_frozen', errcode = 'P0001';
  end if;
  if old.status = 'canceled' and new.status <> 'canceled' then
    raise exception using message = 'invalid_transition', errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger orders_guard_money before update on public.orders
  for each row execute function private.guard_order_money();

-- Pagos, reembolsos y gastos: solo se permite registrar la anulación (una vez).
create or replace function private.guard_financial_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old jsonb := to_jsonb(old) - array['voided_at', 'voided_by', 'void_reason'];
  v_new jsonb := to_jsonb(new) - array['voided_at', 'voided_by', 'void_reason'];
begin
  if v_old <> v_new then
    raise exception using message = 'financial_entry_immutable', errcode = 'P0001';
  end if;
  if old.voided_at is not null then
    raise exception using message = 'already_voided', errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger payments_guard before update on public.payments
  for each row execute function private.guard_financial_entry();
create trigger refunds_guard before update on public.refunds
  for each row execute function private.guard_financial_entry();
create trigger expenses_guard before update on public.expenses
  for each row execute function private.guard_financial_entry();

-- Movimientos de inventario y actividad: solo agregado.
create or replace function private.guard_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using message = 'append_only', errcode = 'P0001';
end;
$$;
create trigger inventory_movements_append_only before update on public.inventory_movements
  for each row execute function private.guard_append_only();
create trigger activity_events_append_only before update on public.activity_events
  for each row execute function private.guard_append_only();
