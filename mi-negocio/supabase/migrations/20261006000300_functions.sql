-- Mi Negocio: funciones transaccionales.
-- Todas son SECURITY DEFINER con search_path fijo, obtienen el negocio desde la
-- membresía del usuario autenticado (nunca desde un argumento) y validan que cada
-- fila referenciada pertenezca a ese negocio. Los errores de dominio usan códigos
-- estables (private.fail) que la aplicación traduce al español.

-- ---------------------------------------------------------------------------
-- Lectura de JSON con validación
-- ---------------------------------------------------------------------------

create or replace function private.j_text(p jsonb, p_key text, p_max integer default 300)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  if p is null or not (p ? p_key) or jsonb_typeof(p -> p_key) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p -> p_key) <> 'string' then
    perform private.fail('invalid_input', p_key);
  end if;
  v := nullif(btrim(p ->> p_key), '');
  if v is not null and char_length(v) > p_max then
    perform private.fail('text_too_long', p_key);
  end if;
  return v;
end;
$$;

create or replace function private.j_int(p jsonb, p_key text)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  if p is null or not (p ? p_key) or jsonb_typeof(p -> p_key) = 'null' then
    return null;
  end if;
  v := p ->> p_key;
  if v !~ '^-?[0-9]{1,12}$' then
    perform private.fail('invalid_number', p_key);
  end if;
  return v::bigint;
end;
$$;

create or replace function private.j_uuid(p jsonb, p_key text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  if p is null or not (p ? p_key) or jsonb_typeof(p -> p_key) = 'null' then
    return null;
  end if;
  v := p ->> p_key;
  if v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform private.fail('invalid_input', p_key);
  end if;
  return v::uuid;
end;
$$;

create or replace function private.j_bool(p jsonb, p_key text, p_default boolean)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p is null or not (p ? p_key) or jsonb_typeof(p -> p_key) = 'null' then
    return p_default;
  end if;
  if jsonb_typeof(p -> p_key) <> 'boolean' then
    perform private.fail('invalid_input', p_key);
  end if;
  return (p ->> p_key)::boolean;
end;
$$;

create or replace function private.check_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_phone is not null and p_phone !~ '^\+[1-9][0-9]{6,14}$' then
    perform private.fail('invalid_phone');
  end if;
  return p_phone;
end;
$$;

create or replace function private.check_occurred_at(p_at timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_at is null then
    return now();
  end if;
  if p_at > now() + interval '2 minutes' then
    perform private.fail('future_date');
  end if;
  if p_at < timestamptz '2000-01-01 00:00:00+00' then
    perform private.fail('invalid_date');
  end if;
  return p_at;
end;
$$;

create or replace function private.check_storage_path(p_business_id uuid, p_path text, p_folder text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_path is null then
    return null;
  end if;
  if p_path !~ ('^' || p_business_id::text || '/' || p_folder || '/[A-Za-z0-9_-]{16,64}\.(jpg|png|webp)$') then
    perform private.fail('invalid_file_path');
  end if;
  return p_path;
end;
$$;

-- ---------------------------------------------------------------------------
-- Negocio y perfil
-- ---------------------------------------------------------------------------

create or replace function public.create_business(
  p_business_name text,
  p_display_name text,
  p_whatsapp_phone text default null,
  p_pickup_address text default null,
  p_pickup_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_business_id uuid;
begin
  if v_uid is null then
    perform private.fail('not_authenticated');
  end if;
  -- Serializa envíos duplicados del mismo usuario.
  perform pg_advisory_xact_lock(hashtextextended('create_business:' || v_uid::text, 0));

  select bm.business_id into v_business_id from public.business_members bm where bm.user_id = v_uid;
  if v_business_id is not null then
    return v_business_id; -- idempotente: un negocio por usuario
  end if;

  if char_length(btrim(coalesce(p_business_name, ''))) not between 1 and 80 then
    perform private.fail('invalid_business_name');
  end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 80 then
    perform private.fail('invalid_display_name');
  end if;
  perform private.check_phone(nullif(btrim(p_whatsapp_phone), ''));

  insert into public.profiles (id, display_name)
  values (v_uid, btrim(p_display_name))
  on conflict (id) do update set display_name = excluded.display_name;

  insert into public.businesses (name, whatsapp_phone, pickup_address, pickup_reference, created_by)
  values (
    btrim(p_business_name),
    nullif(btrim(p_whatsapp_phone), ''),
    nullif(btrim(p_pickup_address), ''),
    nullif(btrim(p_pickup_reference), ''),
    v_uid
  )
  returning id into v_business_id;

  insert into public.business_members (business_id, user_id, role) values (v_business_id, v_uid, 'owner');
  insert into public.order_counters (business_id) values (v_business_id);

  perform private.log_event(v_business_id, 'business', v_business_id, 'business_created');
  return v_business_id;
end;
$$;

create or replace function public.update_business(p_input jsonb, p_expected_revision integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := private.require_business();
  v_row public.businesses;
  v_name text := private.j_text(p_input, 'name', 80);
  v_timezone text := coalesce(private.j_text(p_input, 'timezone', 64), 'America/La_Paz');
begin
  select * into v_row from public.businesses where id = v_business_id for update;
  if p_expected_revision is not null and v_row.revision <> p_expected_revision then
    perform private.fail('stale_record');
  end if;
  if v_name is null then
    perform private.fail('invalid_business_name');
  end if;
  if not private.is_valid_timezone(v_timezone) then
    perform private.fail('invalid_timezone');
  end if;

  update public.businesses set
    name = v_name,
    whatsapp_phone = private.check_phone(private.j_text(p_input, 'whatsapp_phone', 20)),
    pickup_address = private.j_text(p_input, 'pickup_address', 300),
    pickup_reference = private.j_text(p_input, 'pickup_reference', 300),
    payment_qr_label = private.j_text(p_input, 'payment_qr_label', 160),
    timezone = v_timezone,
    revision = revision + 1
  where id = v_business_id
  returning * into v_row;

  perform private.log_event(v_business_id, 'business', v_business_id, 'settings_updated');
  return v_row.revision;
end;
$$;

-- Guarda la ruta de un archivo ya subido (logo o QR) y devuelve la ruta anterior
-- para que el servidor pueda eliminarla.
create or replace function public.set_business_asset(p_kind text, p_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := private.require_business();
  v_old text;
begin
  if p_kind = 'logo' then
    select logo_path into v_old from public.businesses where id = v_business_id for update;
    update public.businesses
      set logo_path = private.check_storage_path(v_business_id, p_path, 'logo'), revision = revision + 1
      where id = v_business_id;
  elsif p_kind = 'payment_qr' then
    select payment_qr_path into v_old from public.businesses where id = v_business_id for update;
    update public.businesses
      set payment_qr_path = private.check_storage_path(v_business_id, p_path, 'qr'), revision = revision + 1
      where id = v_business_id;
  else
    perform private.fail('invalid_input', 'kind');
  end if;
  perform private.log_event(v_business_id, 'business', v_business_id,
    case when p_path is null then 'asset_removed' else 'asset_updated' end,
    jsonb_build_object('kind', p_kind));
  return v_old;
end;
$$;

create or replace function public.update_profile(p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform private.fail('not_authenticated');
  end if;
  if char_length(btrim(coalesce(p_display_name, ''))) not between 1 and 80 then
    perform private.fail('invalid_display_name');
  end if;
  insert into public.profiles (id, display_name) values (auth.uid(), btrim(p_display_name))
  on conflict (id) do update set display_name = excluded.display_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------------

create or replace function public.save_customer(p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := private.require_business();
  v_id uuid := private.j_uuid(p_input, 'id');
  v_expected integer := private.j_int(p_input, 'expected_revision');
  v_name text := private.j_text(p_input, 'name', 120);
  v_phone text := private.check_phone(private.j_text(p_input, 'phone', 20));
  v_row public.customers;
begin
  if v_name is null then
    perform private.fail('invalid_customer_name');
  end if;

  if v_id is null then
    insert into public.customers (business_id, name, phone, address, delivery_reference, notes)
    values (
      v_business_id, v_name, v_phone,
      private.j_text(p_input, 'address', 300),
      private.j_text(p_input, 'delivery_reference', 300),
      private.j_text(p_input, 'notes', 2000)
    )
    returning id into v_id;
    perform private.log_event(v_business_id, 'customer', v_id, 'customer_created');
    return v_id;
  end if;

  select * into v_row from public.customers where business_id = v_business_id and id = v_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if v_expected is not null and v_row.revision <> v_expected then
    perform private.fail('stale_record');
  end if;
  update public.customers set
    name = v_name,
    phone = v_phone,
    address = private.j_text(p_input, 'address', 300),
    delivery_reference = private.j_text(p_input, 'delivery_reference', 300),
    notes = private.j_text(p_input, 'notes', 2000),
    revision = revision + 1
  where id = v_id;
  perform private.log_event(v_business_id, 'customer', v_id, 'customer_updated');
  return v_id;
end;
$$;

create or replace function public.set_customer_archived(p_customer_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := private.require_business();
begin
  update public.customers
    set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
        revision = revision + 1
    where business_id = v_business_id and id = p_customer_id;
  if not found then
    perform private.fail('not_found');
  end if;
  perform private.log_event(v_business_id, 'customer', p_customer_id,
    case when p_archived then 'customer_archived' else 'customer_restored' end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Inventario
-- ---------------------------------------------------------------------------

-- Aplica un cambio de stock a una variante YA BLOQUEADA y registra el movimiento.
-- Si la clave de operación ya existe, no hace nada (idempotente).
create or replace function private.apply_stock_change(
  p_business_id uuid,
  p_variant_id uuid,
  p_order_id uuid,
  p_type text,
  p_on_hand_delta integer,
  p_reserved_delta integer,
  p_reason text,
  p_operation_key text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_variant public.product_variants;
begin
  if exists (
    select 1 from public.inventory_movements
    where business_id = p_business_id and operation_key = p_operation_key
  ) then
    return false;
  end if;

  update public.product_variants
    set on_hand = on_hand + p_on_hand_delta,
        reserved = reserved + p_reserved_delta,
        revision = revision + 1
    where business_id = p_business_id and id = p_variant_id
    returning * into v_variant;

  insert into public.inventory_movements (
    business_id, variant_id, order_id, movement_type, on_hand_delta, reserved_delta,
    on_hand_after, reserved_after, reason, actor_id, operation_key
  ) values (
    p_business_id, p_variant_id, p_order_id, p_type, p_on_hand_delta, p_reserved_delta,
    v_variant.on_hand, v_variant.reserved, p_reason, auth.uid(), p_operation_key
  );
  return true;
exception
  when check_violation then
    if p_type = 'adjustment' then
      perform private.fail('adjustment_below_reserved');
    end if;
    perform private.fail('insufficient_stock');
    return false;
end;
$$;

create or replace function public.save_product(p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := private.require_business();
  v_id uuid := private.j_uuid(p_input, 'id');
  v_expected integer := private.j_int(p_input, 'expected_revision');
  v_name text := private.j_text(p_input, 'name', 120);
  v_product public.products;
  v_variant public.product_variants;
  v_item jsonb;
  v_variant_id uuid;
  v_price bigint;
  v_cost bigint;
  v_track boolean;
  v_initial bigint;
  v_threshold bigint;
  v_position integer := 0;
  v_is_new boolean := v_id is null;
begin
  if v_name is null then
    perform private.fail('invalid_product_name');
  end if;
  if jsonb_typeof(p_input -> 'variants') <> 'array' or jsonb_array_length(p_input -> 'variants') = 0 then
    perform private.fail('product_needs_variant');
  end if;
  if jsonb_array_length(p_input -> 'variants') > 60 then
    perform private.fail('too_many_variants');
  end if;

  if v_is_new then
    insert into public.products (business_id, name, description, category, image_path)
    values (
      v_business_id, v_name,
      private.j_text(p_input, 'description', 1000),
      private.j_text(p_input, 'category', 60),
      private.check_storage_path(v_business_id, private.j_text(p_input, 'image_path', 200), 'products')
    )
    returning * into v_product;
    v_id := v_product.id;
  else
    select * into v_product from public.products where business_id = v_business_id and id = v_id for update;
    if not found then
      perform private.fail('not_found');
    end if;
    if v_expected is not null and v_product.revision <> v_expected then
      perform private.fail('stale_record');
    end if;
    update public.products set
      name = v_name,
      description = private.j_text(p_input, 'description', 1000),
      category = private.j_text(p_input, 'category', 60),
      image_path = private.check_storage_path(v_business_id, private.j_text(p_input, 'image_path', 200), 'products'),
      revision = revision + 1
    where id = v_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_input -> 'variants') loop
    v_variant_id := private.j_uuid(v_item, 'id');
    v_price := private.j_int(v_item, 'price_cents');
    v_cost := private.j_int(v_item, 'cost_cents');
    v_track := private.j_bool(v_item, 'track_inventory', true);
    v_threshold := coalesce(private.j_int(v_item, 'low_stock_threshold'), 2);

    if v_variant_id is not null and private.j_bool(v_item, 'remove', false) then
      select * into v_variant from public.product_variants
        where business_id = v_business_id and product_id = v_id and id = v_variant_id for update;
      if not found then
        perform private.fail('not_found');
      end if;
      if v_variant.reserved > 0 then
        perform private.fail('variant_has_reservations');
      end if;
      update public.product_variants set archived_at = coalesce(archived_at, now()), revision = revision + 1
        where id = v_variant_id;
      continue;
    end if;

    if v_price is null or v_price < 0 or v_price > 100000000 then
      perform private.fail('invalid_price');
    end if;
    if v_cost is not null and (v_cost < 0 or v_cost > 100000000) then
      perform private.fail('invalid_cost');
    end if;
    if v_threshold < 0 or v_threshold > 100000 then
      perform private.fail('invalid_number', 'low_stock_threshold');
    end if;

    if v_variant_id is null then
      v_initial := coalesce(private.j_int(v_item, 'initial_stock'), 0);
      if v_initial < 0 or v_initial > 1000000 then
        perform private.fail('invalid_quantity');
      end if;
      insert into public.product_variants (
        business_id, product_id, sku, size, color, price_cents, cost_cents,
        track_inventory, on_hand, reserved, low_stock_threshold, position
      ) values (
        v_business_id, v_id,
        private.j_text(v_item, 'sku', 60),
        private.j_text(v_item, 'size', 40),
        private.j_text(v_item, 'color', 40),
        v_price, v_cost, v_track, 0, 0, v_threshold, v_position
      )
      returning id into v_variant_id;
      if v_track and v_initial > 0 then
        perform private.apply_stock_change(
          v_business_id, v_variant_id, null, 'initial', v_initial::integer, 0,
          'Stock inicial', 'variant:' || v_variant_id::text || ':initial'
        );
      end if;
    else
      select * into v_variant from public.product_variants
        where business_id = v_business_id and product_id = v_id and id = v_variant_id for update;
      if not found then
        perform private.fail('not_found');
      end if;
      if v_variant.track_inventory and not v_track and v_variant.reserved > 0 then
        perform private.fail('tracking_has_reservations');
      end if;
      update public.product_variants set
        sku = private.j_text(v_item, 'sku', 60),
        size = private.j_text(v_item, 'size', 40),
        color = private.j_text(v_item, 'color', 40),
        price_cents = v_price,
        cost_cents = v_cost,
        track_inventory = v_track,
        low_stock_threshold = v_threshold,
        position = v_position,
        archived_at = null,
        revision = revision + 1
      where id = v_variant_id;
    end if;
    v_position := v_position + 1;
  end loop;

  if not exists (
    select 1 from public.product_variants where product_id = v_id and archived_at is null
  ) then
    perform private.fail('product_needs_variant');
  end if;

  perform private.log_event(v_business_id, 'product', v_id,
    case when v_is_new then 'product_created' else 'product_updated' end,
    jsonb_build_object('name', v_name));
  return v_id;
end;
$$;

create or replace function public.set_product_archived(p_product_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := private.require_business();
begin
  update public.products
    set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
        revision = revision + 1
    where business_id = v_business_id and id = p_product_id;
  if not found then
    perform private.fail('not_found');
  end if;
  perform private.log_event(v_business_id, 'product', p_product_id,
    case when p_archived then 'product_archived' else 'product_restored' end);
end;
$$;

create or replace function public.adjust_stock(
  p_variant_id uuid,
  p_delta integer,
  p_reason text,
  p_operation_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := private.require_business();
  v_variant public.product_variants;
begin
  if p_operation_key is null then
    perform private.fail('missing_idempotency_key');
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000000 then
    perform private.fail('invalid_quantity');
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 300 then
    perform private.fail('reason_required');
  end if;

  select * into v_variant from public.product_variants
    where business_id = v_business_id and id = p_variant_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if not v_variant.track_inventory then
    perform private.fail('variant_not_tracked');
  end if;
  if v_variant.on_hand + p_delta < v_variant.reserved then
    perform private.fail('adjustment_below_reserved', (v_variant.reserved)::text);
  end if;

  if private.apply_stock_change(
    v_business_id, p_variant_id, null, 'adjustment', p_delta, 0, btrim(p_reason),
    'adjust:' || p_operation_key::text
  ) then
    perform private.log_event(v_business_id, 'product', v_variant.product_id, 'stock_adjusted',
      jsonb_build_object('variant_id', p_variant_id, 'delta', p_delta, 'reason', btrim(p_reason)));
  end if;

  select * into v_variant from public.product_variants where id = p_variant_id;
  return jsonb_build_object('on_hand', v_variant.on_hand, 'reserved', v_variant.reserved);
end;
$$;

-- ---------------------------------------------------------------------------
-- Pedidos: cabecera y líneas
-- ---------------------------------------------------------------------------

create or replace function private.order_header(p_business_id uuid, p_input jsonb)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.orders;
  v_customer public.customers;
  v_date text := private.j_text(p_input, 'promised_date', 10);
begin
  r.customer_id := private.j_uuid(p_input, 'customer_id');
  if r.customer_id is not null then
    select * into v_customer from public.customers where business_id = p_business_id and id = r.customer_id;
    if not found then
      perform private.fail('customer_not_found');
    end if;
    if v_customer.archived_at is not null then
      perform private.fail('customer_archived');
    end if;
    r.customer_name := v_customer.name;
    r.customer_phone := v_customer.phone;
  else
    r.customer_name := private.j_text(p_input, 'customer_name', 120);
    r.customer_phone := private.check_phone(private.j_text(p_input, 'customer_phone', 20));
  end if;

  r.fulfillment_type := coalesce(private.j_text(p_input, 'fulfillment_type', 20), 'pickup');
  if r.fulfillment_type not in ('pickup', 'delivery') then
    perform private.fail('invalid_input', 'fulfillment_type');
  end if;
  if v_date is not null then
    if v_date !~ '^\d{4}-\d{2}-\d{2}$' then
      perform private.fail('invalid_date');
    end if;
    begin
      r.promised_date := v_date::date;
    exception when others then
      perform private.fail('invalid_date');
    end;
  end if;
  r.time_window := private.j_text(p_input, 'time_window', 60);
  r.delivery_address := private.j_text(p_input, 'delivery_address', 300);
  r.delivery_reference := private.j_text(p_input, 'delivery_reference', 300);
  r.notes := private.j_text(p_input, 'notes', 2000);
  r.discount_cents := coalesce(private.j_int(p_input, 'discount_cents'), 0);
  r.delivery_fee_cents := coalesce(private.j_int(p_input, 'delivery_fee_cents'), 0);
  if r.discount_cents < 0 then
    perform private.fail('invalid_discount');
  end if;
  if r.delivery_fee_cents < 0 or r.delivery_fee_cents > 100000000 then
    perform private.fail('invalid_delivery_fee');
  end if;
  return r;
end;
$$;

-- Inserta las líneas (instantáneas de nombre, opciones, SKU, precio y costo) y devuelve el subtotal.
create or replace function private.write_order_items(p_business_id uuid, p_order_id uuid, p_items jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_variant record;
  v_qty bigint;
  v_price bigint;
  v_subtotal bigint := 0;
  v_position integer := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform private.fail('order_needs_items');
  end if;
  if jsonb_array_length(p_items) > 50 then
    perform private.fail('too_many_items');
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty := private.j_int(v_item, 'quantity');
    v_price := private.j_int(v_item, 'unit_price_cents');
    if v_qty is null or v_qty < 1 or v_qty > 10000 then
      perform private.fail('invalid_quantity');
    end if;
    if v_price is null or v_price < 0 or v_price > 100000000 then
      perform private.fail('invalid_price');
    end if;

    select pv.id, pv.sku, pv.size, pv.color, pv.cost_cents, pv.archived_at,
           p.name as product_name, p.archived_at as product_archived_at
      into v_variant
      from public.product_variants pv
      join public.products p on p.business_id = pv.business_id and p.id = pv.product_id
      where pv.business_id = p_business_id and pv.id = private.j_uuid(v_item, 'variant_id');
    if not found then
      perform private.fail('variant_not_found');
    end if;
    if v_variant.archived_at is not null or v_variant.product_archived_at is not null then
      perform private.fail('variant_archived', v_variant.product_name);
    end if;

    insert into public.order_items (
      business_id, order_id, variant_id, product_name, variant_label, sku,
      quantity, unit_price_cents, unit_cost_cents, line_total_cents, position
    ) values (
      p_business_id, p_order_id, v_variant.id, v_variant.product_name,
      nullif(concat_ws(' / ', v_variant.size, v_variant.color), ''),
      v_variant.sku, v_qty, v_price, v_variant.cost_cents, v_qty * v_price, v_position
    );
    v_subtotal := v_subtotal + v_qty * v_price;
    v_position := v_position + 1;
  end loop;
  return v_subtotal;
end;
$$;

create or replace function private.lock_order(p_business_id uuid, p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders
    where business_id = p_business_id and id = p_order_id
    for update;
  if not found then
    perform private.fail('not_found');
  end if;
  return v_order;
end;
$$;

-- Bloquea las variantes de un pedido en orden de id (reduce interbloqueos).
create or replace function private.lock_order_variants(p_business_id uuid, p_order_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select 1 from public.product_variants
  where business_id = p_business_id
    and id in (select variant_id from public.order_items where business_id = p_business_id and order_id = p_order_id)
  order by id
  for update;
$$;

-- ---------------------------------------------------------------------------
-- Pedidos: ciclo de vida
-- ---------------------------------------------------------------------------

create or replace function private.confirm_order_tx(p_business_id uuid, p_order_id uuid, p_expected_revision integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders := private.lock_order(p_business_id, p_order_id);
  r record;
begin
  if v_order.status = 'confirmed' then
    return; -- idempotente
  end if;
  if p_expected_revision is not null and v_order.revision <> p_expected_revision then
    perform private.fail('stale_order');
  end if;
  if v_order.status <> 'new' then
    perform private.fail('invalid_transition');
  end if;

  perform private.lock_order_variants(p_business_id, p_order_id);

  for r in
    select v.id, v.track_inventory, v.on_hand, v.reserved,
           sum(i.quantity)::integer as qty,
           min(i.product_name || coalesce(' (' || i.variant_label || ')', '')) as label
      from public.order_items i
      join public.product_variants v on v.business_id = i.business_id and v.id = i.variant_id
      where i.business_id = p_business_id and i.order_id = p_order_id
      group by v.id, v.track_inventory, v.on_hand, v.reserved
      order by v.id
  loop
    if r.track_inventory then
      if r.on_hand - r.reserved < r.qty then
        perform private.fail('insufficient_stock',
          r.label || ': disponible ' || (r.on_hand - r.reserved)::text || ', pedido ' || r.qty::text);
      end if;
      perform private.apply_stock_change(
        p_business_id, r.id, p_order_id, 'reserve', 0, r.qty, null,
        'order:' || p_order_id::text || ':reserve:' || r.id::text
      );
    end if;
  end loop;

  update public.order_items i
    set stock_state = case when v.track_inventory then 'reserved' else 'untracked' end
    from public.product_variants v
    where v.business_id = i.business_id and v.id = i.variant_id
      and i.business_id = p_business_id and i.order_id = p_order_id;

  update public.orders
    set status = 'confirmed', confirmed_at = coalesce(confirmed_at, now()), revision = revision + 1
    where id = p_order_id;

  perform private.log_event(p_business_id, 'order', p_order_id, 'order_confirmed',
    jsonb_build_object('code', v_order.code, 'total_cents', v_order.total_cents));
end;
$$;

-- Inserta un pago validando estado, saldo e idempotencia con el pedido bloqueado.
create or replace function private.record_payment_tx(
  p_business_id uuid,
  p_order_id uuid,
  p_amount_cents bigint,
  p_method text,
  p_occurred_at timestamptz,
  p_reference text,
  p_note text,
  p_receipt_path text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders := private.lock_order(p_business_id, p_order_id);
  v_existing public.payments;
  v_net bigint;
  v_id uuid;
begin
  if p_idempotency_key is null then
    perform private.fail('missing_idempotency_key');
  end if;
  -- Con el pedido bloqueado, una repetición con la misma clave devuelve el mismo pago.
  select * into v_existing from public.payments
    where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.order_id <> p_order_id or v_existing.amount_cents <> p_amount_cents then
      perform private.fail('idempotency_conflict');
    end if;
    return v_existing.id;
  end if;

  if v_order.status not in ('confirmed', 'preparing', 'delivered') then
    perform private.fail(case when v_order.status = 'canceled' then 'order_canceled' else 'order_not_confirmed' end);
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    perform private.fail('invalid_amount');
  end if;
  if v_order.total_cents = 0 then
    perform private.fail('order_has_no_charge');
  end if;
  if p_method is null or p_method not in ('cash', 'qr', 'transfer', 'other') then
    perform private.fail('invalid_method');
  end if;

  select coalesce((select sum(amount_cents) from public.payments
                    where business_id = p_business_id and order_id = p_order_id and voided_at is null), 0)
       - coalesce((select sum(amount_cents) from public.refunds
                    where business_id = p_business_id and order_id = p_order_id and voided_at is null), 0)
    into v_net;
  if v_net + p_amount_cents > v_order.total_cents then
    perform private.fail('payment_exceeds_balance', greatest(v_order.total_cents - v_net, 0)::text);
  end if;

  insert into public.payments (
    business_id, order_id, amount_cents, method, occurred_at, reference, note, receipt_path,
    idempotency_key, created_by
  ) values (
    p_business_id, p_order_id, p_amount_cents, p_method, private.check_occurred_at(p_occurred_at),
    nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''),
    private.check_storage_path(p_business_id, p_receipt_path, 'receipts'),
    p_idempotency_key, auth.uid()
  )
  returning id into v_id;

  perform private.log_event(p_business_id, 'order', p_order_id, 'payment_recorded',
    jsonb_build_object('payment_id', v_id, 'amount_cents', p_amount_cents, 'method', p_method));
  return v_id;
end;
$$;

create or replace function public.create_order(
  p_input jsonb,
  p_confirm boolean,
  p_payment jsonb,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := private.require_business();
  v_header public.orders;
  v_order_id uuid;
  v_number bigint;
  v_subtotal bigint;
  v_amount bigint;
begin
  if p_idempotency_key is null then
    perform private.fail('missing_idempotency_key');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('create_order:' || p_idempotency_key::text, 0));
  select id into v_order_id from public.orders
    where business_id = v_business_id and create_idempotency_key = p_idempotency_key;
  if v_order_id is not null then
    return v_order_id; -- idempotente
  end if;

  v_header := private.order_header(v_business_id, p_input);

  update public.order_counters set last_number = last_number + 1
    where business_id = v_business_id
    returning last_number into v_number;
  if v_number is null then
    perform private.fail('no_business');
  end if;

  insert into public.orders (
    business_id, number, customer_id, customer_name, customer_phone, status, fulfillment_type,
    promised_date, time_window, delivery_address, delivery_reference, notes,
    create_idempotency_key, created_by
  ) values (
    v_business_id, v_number, v_header.customer_id, v_header.customer_name, v_header.customer_phone,
    'new', v_header.fulfillment_type, v_header.promised_date, v_header.time_window,
    v_header.delivery_address, v_header.delivery_reference, v_header.notes,
    p_idempotency_key, auth.uid()
  )
  returning id into v_order_id;

  v_subtotal := private.write_order_items(v_business_id, v_order_id, p_input -> 'items');
  if v_header.discount_cents > v_subtotal then
    perform private.fail('discount_exceeds_subtotal');
  end if;
  update public.orders set
    subtotal_cents = v_subtotal,
    discount_cents = v_header.discount_cents,
    delivery_fee_cents = v_header.delivery_fee_cents,
    total_cents = v_subtotal - v_header.discount_cents + v_header.delivery_fee_cents
  where id = v_order_id;

  perform private.log_event(v_business_id, 'order', v_order_id, 'order_created',
    jsonb_build_object('code', 'PED-' || lpad(v_number::text, 6, '0')));

  if coalesce(p_confirm, false) then
    perform private.confirm_order_tx(v_business_id, v_order_id, null);
  end if;

  if p_payment is not null and jsonb_typeof(p_payment) = 'object' then
    if not coalesce(p_confirm, false) then
      perform private.fail('order_not_confirmed');
    end if;
    v_amount := private.j_int(p_payment, 'amount_cents');
    perform private.record_payment_tx(
      v_business_id, v_order_id, v_amount,
      private.j_text(p_payment, 'method', 20),
      (private.j_text(p_payment, 'occurred_at', 40))::timestamptz,
      private.j_text(p_payment, 'reference', 120),
      private.j_text(p_payment, 'note', 500),
      null,
      p_idempotency_key
    );
  end if;

  return v_order_id;
end;
$$;

create or replace function public.update_order_draft(p_order_id uuid, p_expected_revision integer, p_input jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := private.require_business();
  v_order public.orders := private.lock_order(v_business_id, p_order_id);
  v_header public.orders;
  v_subtotal bigint;
  v_revision integer;
begin
  if p_expected_revision is null or v_order.revision <> p_expected_revision then
    perform private.fail('stale_order');
  end if;
  if v_order.status <> 'new' then
    perform private.fail('order_not_editable');
  end if;
  v_header := private.order_header(v_business_id, p_input);

  delete from public.order_items where business_id = v_business_id and order_id = p_order_id;
  v_subtotal := private.write_order_items(v_business_id, p_order_id, p_input -> 'items');
  if v_header.discount_cents > v_subtotal then
    perform private.fail('discount_exceeds_subtotal');
  end if;

  update public.orders set
    customer_id = v_header.customer_id,
    customer_name = v_header.customer_name,
    customer_phone = v_header.customer_phone,
    fulfillment_type = v_header.fulfillment_type,
    promised_date = v_header.promised_date,
    time_window = v_header.time_window,
    delivery_address = v_header.delivery_address,
    delivery_reference = v_header.delivery_reference,
    notes = v_header.notes,
    subtotal_cents = v_subtotal,
    discount_cents = v_header.discount_cents,
    delivery_fee_cents = v_header.delivery_fee_cents,
    total_cents = v_subtotal - v_header.discount_cents + v_header.delivery_fee_cents,
    revision = revision + 1
  where id = p_order_id
  returning revision into v_revision;

  perform private.log_event(v_business_id, 'order', p_order_id, 'order_updated');
  return v_revision;
end;
$$;

-- Datos logísticos y notas privadas: editables mientras el pedido no esté cancelado.
create or replace function public.update_order_logistics(p_order_id uuid, p_expected_revision integer, p_input jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := private.require_business();
  v_order public.orders := private.lock_order(v_business_id, p_order_id);
  v_header public.orders;
  v_revision integer;
begin
  if p_expected_revision is null or v_order.revision <> p_expected_revision then
    perform private.fail('stale_order');
  end if;
  if v_order.status = 'canceled' then
    perform private.fail('order_canceled');
  end if;
  v_header := private.order_header(v_business_id, (p_input - 'customer_id') - 'discount_cents' - 'delivery_fee_cents');

  update public.orders set
    fulfillment_type = v_header.fulfillment_type,
    promised_date = v_header.promised_date,
    time_window = v_header.time_window,
    delivery_address = v_header.delivery_address,
    delivery_reference = v_header.delivery_reference,
    notes = v_header.notes,
    revision = revision + 1
  where id = p_order_id
  returning revision into v_revision;

  perform private.log_event(v_business_id, 'order', p_order_id, 'logistics_updated');
  return v_revision;
end;
$$;

create or replace function public.confirm_order(p_order_id uuid, p_expected_revision integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.confirm_order_tx(private.require_business(), p_order_id, p_expected_revision);
end;
$$;

create or replace function public.mark_order_preparing(p_order_id uuid, p_expected_revision integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := private.require_business();
  v_order public.orders := private.lock_order(v_business_id, p_order_id);
begin
  if v_order.status = 'preparing' then
    return;
  end if;
  if p_expected_revision is not null and v_order.revision <> p_expected_revision then
    perform private.fail('stale_order');
  end if;
  if v_order.status <> 'confirmed' then
    perform private.fail('invalid_transition');
  end if;
  update public.orders set status = 'preparing', preparing_at = now(), revision = revision + 1
    where id = p_order_id;
  perform private.log_event(v_business_id, 'order', p_order_id, 'order_preparing');
end;
$$;

create or replace function public.mark_order_delivered(p_order_id uuid, p_expected_revision integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := private.require_business();
  v_order public.orders := private.lock_order(v_business_id, p_order_id);
  r record;
begin
  if v_order.status = 'delivered' then
    return;
  end if;
  if p_expected_revision is not null and v_order.revision <> p_expected_revision then
    perform private.fail('stale_order');
  end if;
  if v_order.status not in ('confirmed', 'preparing') then
    perform private.fail('invalid_transition');
  end if;

  perform private.lock_order_variants(v_business_id, p_order_id);
  for r in
    select variant_id, sum(quantity)::integer as qty
      from public.order_items
      where business_id = v_business_id and order_id = p_order_id and stock_state = 'reserved'
      group by variant_id
      order by variant_id
  loop
    perform private.apply_stock_change(
      v_business_id, r.variant_id, p_order_id, 'deliver', -r.qty, -r.qty, null,
      'order:' || p_order_id::text || ':deliver:' || r.variant_id::text
    );
  end loop;
  update public.order_items set stock_state = 'deducted'
    where business_id = v_business_id and order_id = p_order_id and stock_state = 'reserved';

  update public.orders set status = 'delivered', delivered_at = now(), revision = revision + 1
    where id = p_order_id;
  perform private.log_event(v_business_id, 'order', p_order_id, 'order_delivered');
end;
$$;

create or replace function public.cancel_order(
  p_order_id uuid,
  p_expected_revision integer,
  p_reason text,
  p_returned_to_stock boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := private.require_business();
  v_order public.orders := private.lock_order(v_business_id, p_order_id);
  r record;
begin
  if v_order.status = 'canceled' then
    return; -- idempotente: nunca repone stock dos veces
  end if;
  if p_expected_revision is not null and v_order.revision <> p_expected_revision then
    perform private.fail('stale_order');
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    perform private.fail('reason_required');
  end if;
  if v_order.status = 'delivered' and p_returned_to_stock is null then
    perform private.fail('return_decision_required');
  end if;

  perform private.lock_order_variants(v_business_id, p_order_id);

  if v_order.status in ('confirmed', 'preparing') then
    -- Libera reservas sin aumentar la existencia física.
    for r in
      select variant_id, sum(quantity)::integer as qty
        from public.order_items
        where business_id = v_business_id and order_id = p_order_id and stock_state = 'reserved'
        group by variant_id
        order by variant_id
    loop
      perform private.apply_stock_change(
        v_business_id, r.variant_id, p_order_id, 'release', 0, -r.qty, btrim(p_reason),
        'order:' || p_order_id::text || ':release:' || r.variant_id::text
      );
    end loop;
    update public.order_items set stock_state = 'released'
      where business_id = v_business_id and order_id = p_order_id and stock_state = 'reserved';
  elsif v_order.status = 'delivered' and p_returned_to_stock then
    -- Devolución completa a stock vendible: una sola vez.
    for r in
      select variant_id, sum(quantity)::integer as qty
        from public.order_items
        where business_id = v_business_id and order_id = p_order_id and stock_state = 'deducted'
        group by variant_id
        order by variant_id
    loop
      perform private.apply_stock_change(
        v_business_id, r.variant_id, p_order_id, 'return', r.qty, 0, btrim(p_reason),
        'order:' || p_order_id::text || ':return:' || r.variant_id::text
      );
    end loop;
    update public.order_items set stock_state = 'returned'
      where business_id = v_business_id and order_id = p_order_id and stock_state = 'deducted';
  end if;

  update public.orders set
    status = 'canceled',
    canceled_at = now(),
    cancel_reason = btrim(p_reason),
    canceled_from_status = v_order.status,
    returned_to_stock = case when v_order.status = 'delivered' then p_returned_to_stock else null end,
    revision = revision + 1
  where id = p_order_id;

  perform private.log_event(v_business_id, 'order', p_order_id, 'order_canceled',
    jsonb_build_object('from', v_order.status, 'returned_to_stock', p_returned_to_stock));
end;
$$;

-- ---------------------------------------------------------------------------
-- Pagos y reembolsos
-- ---------------------------------------------------------------------------

create or replace function public.record_payment(
  p_order_id uuid,
  p_amount_cents bigint,
  p_method text,
  p_occurred_at timestamptz,
  p_reference text,
  p_note text,
  p_receipt_path text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.record_payment_tx(
    private.require_business(), p_order_id, p_amount_cents, p_method, p_occurred_at,
    p_reference, p_note, p_receipt_path, p_idempotency_key
  );
end;
$$;

create or replace function public.void_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := private.require_business();
  v_payment public.payments;
begin
  select * into v_payment from public.payments where business_id = v_business_id and id = p_payment_id;
  if not found then
    perform private.fail('not_found');
  end if;
  perform private.lock_order(v_business_id, v_payment.order_id);
  select * into v_payment from public.payments where id = p_payment_id;
  if v_payment.voided_at is not null then
    return; -- idempotente
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    perform private.fail('reason_required');
  end if;
  if exists (
    select 1 from public.refunds
    where business_id = v_business_id and payment_id = p_payment_id and voided_at is null
  ) then
    perform private.fail('payment_has_refunds');
  end if;

  update public.payments set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
    where id = p_payment_id;
  perform private.log_event(v_business_id, 'order', v_payment.order_id, 'payment_voided',
    jsonb_build_object('payment_id', p_payment_id, 'amount_cents', v_payment.amount_cents));
end;
$$;

create or replace function public.record_refund(
  p_payment_id uuid,
  p_amount_cents bigint,
  p_method text,
  p_occurred_at timestamptz,
  p_reason text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := private.require_business();
  v_payment public.payments;
  v_order public.orders;
  v_existing public.refunds;
  v_refunded bigint;
  v_net bigint;
  v_id uuid;
begin
  if p_idempotency_key is null then
    perform private.fail('missing_idempotency_key');
  end if;
  select * into v_payment from public.payments where business_id = v_business_id and id = p_payment_id;
  if not found then
    perform private.fail('not_found');
  end if;
  v_order := private.lock_order(v_business_id, v_payment.order_id);

  select * into v_existing from public.refunds
    where business_id = v_business_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.payment_id <> p_payment_id or v_existing.amount_cents <> p_amount_cents then
      perform private.fail('idempotency_conflict');
    end if;
    return v_existing.id;
  end if;

  select * into v_payment from public.payments where id = p_payment_id;
  if v_order.status <> 'canceled' then
    perform private.fail('refund_requires_cancellation');
  end if;
  if v_payment.voided_at is not null then
    perform private.fail('payment_voided');
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    perform private.fail('invalid_amount');
  end if;
  if p_method is null or p_method not in ('cash', 'qr', 'transfer', 'other') then
    perform private.fail('invalid_method');
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    perform private.fail('reason_required');
  end if;

  select coalesce(sum(amount_cents), 0) into v_refunded from public.refunds
    where business_id = v_business_id and payment_id = p_payment_id and voided_at is null;
  if v_refunded + p_amount_cents > v_payment.amount_cents then
    perform private.fail('refund_exceeds_payment', (v_payment.amount_cents - v_refunded)::text);
  end if;
  select coalesce((select sum(amount_cents) from public.payments
                    where business_id = v_business_id and order_id = v_order.id and voided_at is null), 0)
       - coalesce((select sum(amount_cents) from public.refunds
                    where business_id = v_business_id and order_id = v_order.id and voided_at is null), 0)
    into v_net;
  if v_net - p_amount_cents < 0 then
    perform private.fail('refund_exceeds_payment', v_net::text);
  end if;

  insert into public.refunds (
    business_id, order_id, payment_id, amount_cents, method, occurred_at, reason, idempotency_key, created_by
  ) values (
    v_business_id, v_order.id, p_payment_id, p_amount_cents, p_method,
    private.check_occurred_at(p_occurred_at), btrim(p_reason), p_idempotency_key, auth.uid()
  )
  returning id into v_id;

  perform private.log_event(v_business_id, 'order', v_order.id, 'refund_recorded',
    jsonb_build_object('refund_id', v_id, 'payment_id', p_payment_id, 'amount_cents', p_amount_cents));
  return v_id;
end;
$$;

create or replace function public.void_refund(p_refund_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := private.require_business();
  v_refund public.refunds;
begin
  select * into v_refund from public.refunds where business_id = v_business_id and id = p_refund_id;
  if not found then
    perform private.fail('not_found');
  end if;
  perform private.lock_order(v_business_id, v_refund.order_id);
  select * into v_refund from public.refunds where id = p_refund_id;
  if v_refund.voided_at is not null then
    return;
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    perform private.fail('reason_required');
  end if;
  update public.refunds set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
    where id = p_refund_id;
  perform private.log_event(v_business_id, 'order', v_refund.order_id, 'refund_voided',
    jsonb_build_object('refund_id', p_refund_id, 'amount_cents', v_refund.amount_cents));
end;
$$;

-- ---------------------------------------------------------------------------
-- Gastos
-- ---------------------------------------------------------------------------

create or replace function private.insert_expense(
  p_business_id uuid,
  p_amount_cents bigint,
  p_category text,
  p_method text,
  p_occurred_at timestamptz,
  p_description text,
  p_receipt_path text,
  p_idempotency_key uuid,
  p_replaces uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 100000000 then
    perform private.fail('invalid_amount');
  end if;
  if p_category is null or p_category not in ('transport', 'rent', 'utilities', 'packaging', 'marketing', 'other') then
    perform private.fail('invalid_category');
  end if;
  if p_method is null or p_method not in ('cash', 'qr', 'transfer', 'other') then
    perform private.fail('invalid_method');
  end if;
  if char_length(coalesce(p_description, '')) > 300 then
    perform private.fail('text_too_long', 'description');
  end if;
  insert into public.expenses (
    business_id, amount_cents, category, method, occurred_at, description, receipt_path,
    idempotency_key, replaces_expense_id, created_by
  ) values (
    p_business_id, p_amount_cents, p_category, p_method, private.check_occurred_at(p_occurred_at),
    nullif(btrim(p_description), ''),
    private.check_storage_path(p_business_id, p_receipt_path, 'receipts'),
    p_idempotency_key, p_replaces, auth.uid()
  )
  returning id into v_id;
  perform private.log_event(p_business_id, 'expense', v_id, 'expense_recorded',
    jsonb_build_object('amount_cents', p_amount_cents, 'category', p_category));
  return v_id;
end;
$$;

create or replace function public.record_expense(
  p_amount_cents bigint,
  p_category text,
  p_method text,
  p_occurred_at timestamptz,
  p_description text,
  p_receipt_path text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := private.require_business();
  v_existing uuid;
begin
  if p_idempotency_key is null then
    perform private.fail('missing_idempotency_key');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('expense:' || p_idempotency_key::text, 0));
  select id into v_existing from public.expenses
    where business_id = v_business_id and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;
  return private.insert_expense(v_business_id, p_amount_cents, p_category, p_method, p_occurred_at,
    p_description, p_receipt_path, p_idempotency_key, null);
end;
$$;

create or replace function public.void_expense(p_expense_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := private.require_business();
  v_expense public.expenses;
begin
  select * into v_expense from public.expenses where business_id = v_business_id and id = p_expense_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  if v_expense.voided_at is not null then
    return;
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    perform private.fail('reason_required');
  end if;
  update public.expenses set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
    where id = p_expense_id;
  perform private.log_event(v_business_id, 'expense', p_expense_id, 'expense_voided',
    jsonb_build_object('amount_cents', v_expense.amount_cents));
end;
$$;

-- Corrección: anula el gasto original y registra el reemplazo en una sola transacción.
create or replace function public.correct_expense(
  p_expense_id uuid,
  p_reason text,
  p_amount_cents bigint,
  p_category text,
  p_method text,
  p_occurred_at timestamptz,
  p_description text,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := private.require_business();
  v_expense public.expenses;
  v_existing uuid;
begin
  if p_idempotency_key is null then
    perform private.fail('missing_idempotency_key');
  end if;
  select * into v_expense from public.expenses where business_id = v_business_id and id = p_expense_id for update;
  if not found then
    perform private.fail('not_found');
  end if;
  select id into v_existing from public.expenses
    where business_id = v_business_id and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;
  if v_expense.voided_at is not null then
    perform private.fail('already_voided');
  end if;
  perform public.void_expense(p_expense_id, p_reason);
  return private.insert_expense(v_business_id, p_amount_cents, p_category, p_method, p_occurred_at,
    p_description, v_expense.receipt_path, p_idempotency_key, p_expense_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Auditoría de acciones de compartir (abrir WhatsApp no prueba envío)
-- ---------------------------------------------------------------------------

create or replace function public.log_share_opened(p_order_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid := private.require_business();
begin
  if p_kind not in ('summary', 'reminder') then
    perform private.fail('invalid_input', 'kind');
  end if;
  if not exists (select 1 from public.orders where business_id = v_business_id and id = p_order_id) then
    perform private.fail('not_found');
  end if;
  perform private.log_event(v_business_id, 'order', p_order_id,
    case when p_kind = 'summary' then 'whatsapp_summary_opened' else 'whatsapp_reminder_opened' end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------------

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.member_business_ids() to authenticated;
grant execute on function private.current_business_id() to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.create_business(text, text, text, text, text),
  public.update_business(jsonb, integer),
  public.set_business_asset(text, text),
  public.update_profile(text),
  public.save_customer(jsonb),
  public.set_customer_archived(uuid, boolean),
  public.save_product(jsonb),
  public.set_product_archived(uuid, boolean),
  public.adjust_stock(uuid, integer, text, uuid),
  public.create_order(jsonb, boolean, jsonb, uuid),
  public.update_order_draft(uuid, integer, jsonb),
  public.update_order_logistics(uuid, integer, jsonb),
  public.confirm_order(uuid, integer),
  public.mark_order_preparing(uuid, integer),
  public.mark_order_delivered(uuid, integer),
  public.cancel_order(uuid, integer, text, boolean),
  public.record_payment(uuid, bigint, text, timestamptz, text, text, text, uuid),
  public.void_payment(uuid, text),
  public.record_refund(uuid, bigint, text, timestamptz, text, uuid),
  public.void_refund(uuid, text),
  public.record_expense(bigint, text, text, timestamptz, text, text, uuid),
  public.void_expense(uuid, text),
  public.correct_expense(uuid, text, bigint, text, text, timestamptz, text, uuid),
  public.log_share_opened(uuid, text)
to authenticated;
