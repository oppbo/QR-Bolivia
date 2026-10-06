/**
 * Seed de DESARROLLO (datos ficticios). Seguro de repetir: borra y recrea solo las
 * cuentas de demostración. Usa las mismas funciones transaccionales que la app
 * (sesión del dueño de demo), así stock, pagos y totales quedan conciliados.
 *
 * Ancla de fechas: SEED_ANCHOR_DATE=YYYY-MM-DD (por defecto, "hoy" en America/La_Paz).
 * Las fechas de entrega y pagos se calculan relativas a esa ancla, en la zona del negocio.
 *
 * Uso: npm run db:seed   (requiere Supabase local en marcha y .env.local completo)
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { addDays, DEFAULT_TIMEZONE, isDateString, todayInTimezone, zonedToUtc } from '../lib/dates';

// Carga .env.local sin dependencias extra.
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* sin .env.local: se usan variables del entorno */
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRET = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(URL_);
if (!isLocal && process.env.ALLOW_REMOTE_SEED !== '1') {
  console.error('El seed solo corre contra Supabase local. Para un proyecto de desarrollo alojado, definí ALLOW_REMOTE_SEED=1.');
  process.exit(1);
}
if (!ANON || !SECRET) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY y SUPABASE_SECRET_KEY (ver .env.example).');
  process.exit(1);
}

export const DEMO = { email: 'demo@luna-boutique.test', password: 'demo-luna-2026', business: 'Luna Boutique' };
export const OTHER = { email: 'prueba-b@negocio-b.test', password: 'prueba-b-2026', business: 'Tienda Prueba B' };

const TZ = DEFAULT_TIMEZONE;
const anchor = process.env.SEED_ANCHOR_DATE && isDateString(process.env.SEED_ANCHOR_DATE) ? process.env.SEED_ANCHOR_DATE : todayInTimezone(TZ);
const admin = createClient(URL_, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
const pool = new pg.Pool({ connectionString: DB });

/**
 * Ajusta marcas de tiempo históricas del seed. activity_events es de solo agregado
 * (trigger); este script de desarrollo desactiva los triggers solo para esta sentencia.
 */
async function backdate(sql: string, args: unknown[]) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local session_replication_role = replica');
    await client.query(sql, args);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

/** Instante local (día relativo al ancla, hora:min) sin superar "ahora". */
function at(dayOffset: number, hh: number, mm = 0): string {
  const [y, m, d] = addDays(anchor, dayOffset).split('-').map(Number);
  const t = zonedToUtc(y, m, d, hh, mm, TZ).getTime();
  return new Date(Math.min(t, Date.now() - 60_000)).toISOString();
}

async function check<T>(p: PromiseLike<{ data: T; error: unknown }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${JSON.stringify(error)}`);
  return data;
}

async function removeAccount(email: string) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const user = data?.users.find((u) => u.email === email);
  if (!user) return;
  const { rows } = await pool.query<{ business_id: string }>('select business_id from public.business_members where user_id = $1', [user.id]);
  for (const { business_id } of rows) {
    for (const folder of ['logo', 'qr', 'products', 'receipts']) {
      const { data: files } = await admin.storage.from('business-files').list(`${business_id}/${folder}`, { limit: 1000 });
      if (files?.length) await admin.storage.from('business-files').remove(files.map((f) => `${business_id}/${folder}/${f.name}`));
    }
    await pool.query('delete from public.businesses where id = $1', [business_id]);
  }
  await admin.auth.admin.deleteUser(user.id);
}

async function account(email: string, password: string, business: string, owner: string, phone: string | null) {
  await removeAccount(email);
  await check(admin.auth.admin.createUser({ email, password, email_confirm: true }), 'crear usuario');
  const client = createClient(URL_, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
  await check(client.auth.signInWithPassword({ email, password }), 'iniciar sesión');
  const businessId = await check(
    client.rpc('create_business', {
      p_business_name: business,
      p_display_name: owner,
      p_whatsapp_phone: phone,
      p_pickup_address: business === DEMO.business ? 'Av. Ejemplo 123, Santa Cruz de la Sierra (dirección ficticia)' : null,
      p_pickup_reference: null,
    }),
    'crear negocio',
  );
  return { client, businessId: businessId as string };
}

type Variant = { size?: string; color?: string; sku?: string; price: number; cost?: number; stock: number; track?: boolean; low?: number };

async function product(c: SupabaseClient, name: string, category: string, variants: Variant[], description?: string) {
  const id = await check(
    c.rpc('save_product', {
      p_input: {
        name,
        category,
        description: description ?? null,
        variants: variants.map((v) => ({
          size: v.size ?? null,
          color: v.color ?? null,
          sku: v.sku ?? null,
          price_cents: v.price,
          cost_cents: v.cost ?? null,
          track_inventory: v.track ?? true,
          initial_stock: v.stock,
          low_stock_threshold: v.low ?? 2,
        })),
      },
    }),
    `producto ${name}`,
  );
  const rows = await check(c.from('product_variants').select('id, size, color').eq('product_id', id as string).order('position'), 'variantes');
  const map: Record<string, string> = {};
  for (const r of rows ?? []) map[[r.size, r.color].filter(Boolean).join('/') || 'unica'] = r.id;
  return map;
}

async function customer(c: SupabaseClient, name: string, extra: Record<string, string> = {}) {
  return (await check(c.rpc('save_customer', { p_input: { name, phone: null, ...extra } }), `cliente ${name}`)) as string;
}

interface OrderSpec {
  customer?: string;
  walkIn?: string;
  type: 'pickup' | 'delivery';
  promised?: number; // días relativos al ancla
  window?: string;
  address?: string;
  fee?: number;
  discount?: number;
  notes?: string;
  items: [string, number, number][]; // variantId, cantidad, precio
  confirm: boolean;
  createdAt: string;
  confirmedAt?: string;
}

async function order(c: SupabaseClient, s: OrderSpec) {
  const id = (await check(
    c.rpc('create_order', {
      p_input: {
        customer_id: s.customer ?? null,
        customer_name: s.walkIn ?? null,
        fulfillment_type: s.type,
        promised_date: s.promised === undefined ? null : addDays(anchor, s.promised),
        time_window: s.window ?? null,
        delivery_address: s.address ?? null,
        notes: s.notes ?? null,
        discount_cents: s.discount ?? 0,
        delivery_fee_cents: s.fee ?? 0,
        items: s.items.map(([variant_id, quantity, unit_price_cents]) => ({ variant_id, quantity, unit_price_cents })),
      },
      p_confirm: s.confirm,
      p_payment: null,
      p_idempotency_key: randomUUID(),
    }),
    'pedido',
  )) as string;
  // Fechas históricas coherentes para el panel (solo marcas de tiempo; montos y stock ya están conciliados).
  await pool.query('update public.orders set created_at = $2, confirmed_at = coalesce($3, confirmed_at) where id = $1', [id, s.createdAt, s.confirmedAt ?? null]);
  await backdate(`update public.activity_events set created_at = $2 where entity_id = $1 and event_type = 'order_created'`, [id, s.createdAt]);
  if (s.confirmedAt) await backdate(`update public.activity_events set created_at = $2 where entity_id = $1 and event_type = 'order_confirmed'`, [id, s.confirmedAt]);
  return id;
}

async function pay(c: SupabaseClient, orderId: string, amount: number, method: string, when: string, reference?: string) {
  return (await check(
    c.rpc('record_payment', {
      p_order_id: orderId,
      p_amount_cents: amount,
      p_method: method,
      p_occurred_at: when,
      p_reference: reference ?? null,
      p_note: null,
      p_receipt_path: null,
      p_idempotency_key: randomUUID(),
    }),
    'pago',
  )) as string;
}

async function setStatus(c: SupabaseClient, orderId: string, fn: 'mark_order_preparing' | 'mark_order_delivered', when?: string) {
  await check(c.rpc(fn, { p_order_id: orderId, p_expected_revision: null }), fn);
  if (when && fn === 'mark_order_delivered') await pool.query('update public.orders set delivered_at = $2 where id = $1', [orderId, when]);
}

async function seedDemo() {
  const { client: c, businessId } = await account(DEMO.email, DEMO.password, DEMO.business, 'Lucía', '+59170000001');

  const polera = await product(c, 'Polera básica', 'Poleras', [
    { size: 'S', color: 'Negra', sku: 'POL-S-NEG', price: 8000, cost: 4500, stock: 6 },
    { size: 'M', color: 'Negra', sku: 'POL-M-NEG', price: 8000, cost: 4500, stock: 10 },
    { size: 'M', color: 'Blanca', sku: 'POL-M-BLA', price: 8000, cost: 4500, stock: 8 },
    { size: 'L', color: 'Blanca', sku: 'POL-L-BLA', price: 8500, stock: 5 },
  ], 'Algodón peinado.');
  const jean = await product(c, 'Jean clásico', 'Pantalones', [
    { size: '38', color: 'Azul', sku: 'JEA-38', price: 22000, cost: 13000, stock: 4 },
    { size: '40', color: 'Azul', sku: 'JEA-40', price: 22000, cost: 13000, stock: 6 },
    { size: '42', color: 'Azul', sku: 'JEA-42', price: 23000, cost: 13500, stock: 3 },
  ]);
  const vestido = await product(c, 'Vestido casual', 'Vestidos', [
    { size: 'S', color: 'Floreado', price: 18000, stock: 3 },
    { size: 'M', color: 'Floreado', price: 18000, stock: 4 },
  ]);
  const gorra = await product(c, 'Gorra urbana', 'Accesorios', [
    { color: 'Negra', sku: 'GOR-NEG', price: 6000, cost: 2500, stock: 3, low: 2 },
    { color: 'Beige', sku: 'GOR-BEI', price: 6000, cost: 2500, stock: 7 },
  ]);
  const bolso = await product(c, 'Bolso pequeño', 'Accesorios', [
    { color: 'Rojo', sku: 'BOL-ROJ', price: 15000, stock: 0 },
    { color: 'Negro', sku: 'BOL-NEG', price: 15000, stock: 5 },
  ]);
  const campera = await product(c, 'Campera liviana', 'Abrigos', [
    { size: 'M', color: 'Verde', price: 32000, stock: 2, low: 1 },
    { size: 'L', color: 'Verde', price: 32000, stock: 2, low: 1 },
  ]);
  const calcetines = await product(c, 'Calcetines (par)', 'Accesorios', [{ price: 1500, stock: 40, low: 10 }]);
  const tarjeta = await product(c, 'Tarjeta de regalo impresa', 'Servicios', [{ price: 0, stock: 0, track: false }]);

  const ana = await customer(c, 'Ana Rojas', { address: 'Barrio Equipetrol, calle ficticia 4', delivery_reference: 'Portón verde' });
  const carla = await customer(c, 'Carla Méndez');
  const diego = await customer(c, 'Diego Vaca', { address: 'Zona Norte, 4.º anillo (ficticia)' });
  const elena = await customer(c, 'Elena Suárez', { notes: 'Prefiere que le escriban por la tarde.' });
  const fabio = await customer(c, 'Fabio Justiniano');
  const gabi = await customer(c, 'Gabriela Áñez');
  const hugo = await customer(c, 'Hugo Paz', { address: 'Av. Banzer km 6 (ficticia)' });
  const ines = await customer(c, 'Inés Cuéllar');

  // 1. Entregado y pagado (hace 5 días)
  const o1 = await order(c, { customer: ana, type: 'delivery', promised: -5, address: 'Barrio Equipetrol, calle ficticia 4', fee: 1500, items: [[jean['40/Azul'], 1, 22000]], confirm: true, createdAt: at(-6, 11), confirmedAt: at(-6, 11, 5) });
  await pay(c, o1, 10000, 'qr', at(-6, 11, 10));
  await setStatus(c, o1, 'mark_order_delivered', at(-5, 16));
  await pay(c, o1, 13500, 'cash', at(-5, 16, 5));

  // 2. Entregado con saldo pendiente (hace 3 días)
  const o2 = await order(c, { customer: carla, type: 'pickup', promised: -3, items: [[vestido['M/Floreado'], 1, 18000], [gorra['Beige'], 1, 6000]], confirm: true, createdAt: at(-4, 10), confirmedAt: at(-4, 10, 2) });
  await pay(c, o2, 10000, 'transfer', at(-4, 10, 30), 'Ref. 4521');
  await setStatus(c, o2, 'mark_order_delivered', at(-3, 18));

  // 3. Confirmado, atrasado (prometido ayer), sin pago
  await order(c, { customer: diego, type: 'delivery', promised: -1, window: 'por la mañana', address: 'Zona Norte, 4.º anillo (ficticia)', fee: 2000, items: [[polera['L/Blanca'], 2, 8500]], confirm: true, createdAt: at(-2, 15), confirmedAt: at(-2, 15, 1) });

  // 4. En preparación, entrega hoy, anticipo de Bs 50 por QR (escenario principal)
  const o4 = await order(c, { customer: ana, type: 'delivery', promised: 0, window: 'por la tarde', address: 'Barrio Equipetrol, calle ficticia 4', fee: 1500, items: [[polera['M/Negra'], 2, 8000]], confirm: true, createdAt: at(0, 9), confirmedAt: at(0, 9, 2), notes: 'Pidió por WhatsApp.' });
  await pay(c, o4, 5000, 'qr', at(0, 9, 5));
  await setStatus(c, o4, 'mark_order_preparing');

  // 5. Confirmado, retiro hoy, pagado completo
  const o5 = await order(c, { customer: elena, type: 'pickup', promised: 0, window: '17:00 a 19:00', items: [[bolso['Negro'], 1, 15000]], confirm: true, createdAt: at(0, 9, 30), confirmedAt: at(0, 9, 31) });
  await pay(c, o5, 15000, 'cash', at(0, 9, 35));

  // 6. Nuevo (sin reserva), entrega mañana
  await order(c, { customer: fabio, type: 'pickup', promised: 1, items: [[campera['M/Verde'], 1, 32000]], confirm: false, createdAt: at(0, 9, 40) });

  // 7. Confirmado, entrega en 2 días, sin pago
  await order(c, { customer: gabi, type: 'delivery', promised: 2, fee: 1500, address: 'Urbanización ficticia, casa 12', items: [[gorra['Negra'], 1, 6000], [calcetines['unica'], 3, 1500]], confirm: true, createdAt: at(-1, 17), confirmedAt: at(-1, 17, 1) });

  // 8. Promoción de total cero, entregado
  const o8 = await order(c, { customer: hugo, type: 'pickup', promised: -2, discount: 1500, items: [[calcetines['unica'], 1, 1500], [tarjeta['unica'], 1, 0]], confirm: true, createdAt: at(-2, 12), confirmedAt: at(-2, 12, 1), notes: 'Regalo por compra anterior.' });
  await setStatus(c, o8, 'mark_order_delivered', at(-2, 13));

  // 9. Cancelado antes de entregar; anticipo reembolsado completo
  const o9 = await order(c, { customer: ines, type: 'delivery', promised: -1, fee: 1500, items: [[polera['S/Negra'], 2, 8000]], confirm: true, createdAt: at(-3, 10), confirmedAt: at(-3, 10, 1) });
  const p9 = await pay(c, o9, 5000, 'qr', at(-3, 10, 5));
  await check(c.rpc('cancel_order', { p_order_id: o9, p_expected_revision: null, p_reason: 'La clienta ya no lo necesita', p_returned_to_stock: null }), 'cancelar 9');
  await check(c.rpc('record_refund', { p_payment_id: p9, p_amount_cents: 5000, p_method: 'qr', p_occurred_at: at(-1, 11), p_reason: 'Devolución del anticipo', p_idempotency_key: randomUUID() }), 'reembolso 9');

  // 10. Cancelado hoy con anticipo: reembolso pendiente
  const o10 = await order(c, { customer: carla, type: 'pickup', promised: 1, items: [[jean['38/Azul'], 1, 22000]], confirm: true, createdAt: at(-1, 9), confirmedAt: at(-1, 9, 1) });
  await pay(c, o10, 8000, 'transfer', at(-1, 9, 10), 'Ref. 7788');
  await check(c.rpc('cancel_order', { p_order_id: o10, p_expected_revision: null, p_reason: 'Cambió de talla; se hará otro pedido', p_returned_to_stock: null }), 'cancelar 10');

  // 11. Entregado y luego devuelto completo al stock, con reembolso
  const o11 = await order(c, { customer: diego, type: 'pickup', promised: -4, items: [[polera['M/Blanca'], 1, 8000], [gorra['Beige'], 1, 6000]], confirm: true, createdAt: at(-5, 10), confirmedAt: at(-5, 10, 1) });
  const p11 = await pay(c, o11, 14000, 'cash', at(-5, 10, 5));
  await setStatus(c, o11, 'mark_order_delivered', at(-4, 12));
  await check(c.rpc('cancel_order', { p_order_id: o11, p_expected_revision: null, p_reason: 'Devolución: no le quedó', p_returned_to_stock: true }), 'cancelar 11');
  await check(c.rpc('record_refund', { p_payment_id: p11, p_amount_cents: 14000, p_method: 'cash', p_occurred_at: at(0, 10), p_reason: 'Devolución completa', p_idempotency_key: randomUUID() }), 'reembolso 11');

  // 12. Venta sin cliente registrado, nuevo, retiro hoy
  await order(c, { walkIn: 'Cliente de mostrador', type: 'pickup', promised: 0, items: [[calcetines['unica'], 2, 1500]], confirm: false, createdAt: at(0, 10, 15) });

  // Gastos operativos
  const expenses: [number, string, string, number, number, string][] = [
    [2500, 'transport', 'cash', 0, 8, 'Moto para entregas'],
    [1800, 'packaging', 'cash', 0, 8, 'Bolsas y cinta'],
    [150000, 'rent', 'transfer', -5, 9, 'Alquiler del puesto (ficticio)'],
    [12000, 'utilities', 'qr', -3, 12, 'Internet y luz'],
    [5000, 'marketing', 'qr', -2, 20, 'Publicidad en redes'],
  ];
  for (const [amount, category, method, day, hh, description] of expenses) {
    await check(
      c.rpc('record_expense', { p_amount_cents: amount, p_category: category, p_method: method, p_occurred_at: at(day, hh), p_description: description, p_receipt_path: null, p_idempotency_key: randomUUID() }),
      'gasto',
    );
  }
  void businessId;
  return businessId;
}

async function seedOther() {
  const { client: c, businessId } = await account(OTHER.email, OTHER.password, OTHER.business, 'Prueba B', null);
  const v = await product(c, 'Producto exclusivo de B', 'Pruebas', [{ price: 5000, stock: 3 }]);
  const cust = await customer(c, 'Cliente privado de B', { notes: 'Nota privada de B' });
  const o = await order(c, { customer: cust, type: 'pickup', promised: 0, items: [[v['unica'], 1, 5000]], confirm: true, createdAt: at(0, 8), confirmedAt: at(0, 8, 1) });
  await pay(c, o, 2000, 'cash', at(0, 8, 5));
  return businessId;
}

async function main() {
  console.log(`Seed de desarrollo · ancla ${anchor} (${TZ})`);
  const demoId = await seedDemo();
  const otherId = await seedOther();
  const { rows } = await pool.query(
    `select (select count(*) from public.products where business_id = $1) as products,
            (select count(*) from public.product_variants where business_id = $1) as variants,
            (select count(*) from public.customers where business_id = $1) as customers,
            (select count(*) from public.orders where business_id = $1) as orders,
            (select count(*) from public.expenses where business_id = $1) as expenses`,
    [demoId],
  );
  console.log('Luna Boutique:', rows[0]);
  console.log(`Negocio aislado para pruebas: ${OTHER.business} (${otherId})`);
  console.log(`\nIngresá con ${DEMO.email} / ${DEMO.password}`);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await pool.end();
  process.exit(1);
});
