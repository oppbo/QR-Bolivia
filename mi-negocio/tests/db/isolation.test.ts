// Escenario G: aislamiento entre negocios (RLS, funciones y almacenamiento).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOwner,
  createProduct,
  errorOf,
  orderInput,
  pool,
  query,
  randomUUID,
  rpc,
  variantStock,
  type TestUser,
} from './helpers';

// Clave anónima de demostración que la CLI de Supabase usa en todo entorno local.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

let A: { user: TestUser; businessId: string };
let B: { user: TestUser; businessId: string };
let bOrderId: string;
let bVariantId: string;
let bCustomerId: string;
let bPaymentId: string;

beforeAll(async () => {
  A = await createOwner('iso-a');
  B = await createOwner('iso-b');
  const p = await createProduct(B.user, { stock: 5 });
  bVariantId = p.variantId;
  bCustomerId = await rpc<string>(B.user, 'save_customer', [{ name: 'Cliente de B', notes: 'secreto de B' }]);
  bOrderId = await rpc<string>(B.user, 'create_order', [
    orderInput(bVariantId, { customer_id: bCustomerId }),
    true,
    { amount_cents: 1000, method: 'cash' },
    randomUUID(),
  ]);
  [{ id: bPaymentId }] = await query<{ id: string }>(B.user, 'select id from public.payments where order_id = $1', [bOrderId]);
});

afterAll(async () => {
  await pool.end();
});

describe('lecturas', () => {
  it.each([
    'businesses',
    'customers',
    'products',
    'product_variants',
    'orders',
    'order_items',
    'payments',
    'refunds',
    'expenses',
    'inventory_movements',
    'activity_events',
    'order_summaries',
    'variant_stock',
  ])('A no ve filas de B en %s', async (table) => {
    const rows = await query<{ business_id?: string; id: string }>(A.user, `select * from public.${table}`);
    for (const r of rows) {
      expect(r.business_id ?? r.id).not.toBe(B.businessId);
    }
    const byId = await query(A.user, `select * from public.${table} where ${table === 'businesses' ? 'id' : 'business_id'} = $1`, [
      B.businessId,
    ]);
    expect(byId).toHaveLength(0);
  });

  it('las funciones de listado y reportes solo devuelven datos propios', async () => {
    expect(await query(A.user, 'select * from public.list_orders()')).toHaveLength(0);
    expect(await query(A.user, 'select * from public.list_customers()')).toHaveLength(0);
    expect(await query(A.user, 'select * from public.list_products()')).toHaveLength(0);
    expect(await query(A.user, 'select * from public.search_sellable_variants()')).toHaveLength(0);
    const [totals] = await query<{ order_count: string }>(A.user, 'select * from public.customer_totals($1)', [bCustomerId]);
    expect(Number(totals.order_count)).toBe(0);
    const cash = await rpc<{ payments_cents: number }>(A.user, 'cash_summary', ['2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z']);
    expect(cash.payments_cents).toBe(0);
    expect(await query(A.user, `select * from public.cash_entries('2000-01-01', '2100-01-01', 100, 0)`)).toHaveLength(0);
  });

  it('anon no lee nada ni ejecuta funciones', async () => {
    expect(await errorOf(query(null, 'select * from public.orders'))).toBe('42501');
    expect(await errorOf(rpc(null, 'create_business', ['x', 'y', null, null, null]))).toBe('42501');
  });

  it('order_counters no es accesible', async () => {
    expect(await errorOf(query(A.user, 'select * from public.order_counters'))).toBe('42501');
  });
});

describe('escrituras', () => {
  it('no hay escritura directa en tablas', async () => {
    expect(await errorOf(query(A.user, `update public.orders set notes = 'x'`))).toBe('42501');
    expect(await errorOf(query(B.user, `update public.product_variants set reserved = 0`))).toBe('42501');
    expect(await errorOf(query(B.user, `delete from public.payments`))).toBe('42501');
    expect(
      await errorOf(query(A.user, `insert into public.customers (business_id, name) values ($1, 'intruso')`, [B.businessId])),
    ).toBe('42501');
  });

  it('A no puede mutar registros de B por UUID', async () => {
    expect(await errorOf(rpc(A.user, 'confirm_order', [bOrderId, null]))).toBe('not_found');
    expect(await errorOf(rpc(A.user, 'mark_order_delivered', [bOrderId, null]))).toBe('not_found');
    expect(await errorOf(rpc(A.user, 'cancel_order', [bOrderId, null, 'x', null]))).toBe('not_found');
    expect(await errorOf(rpc(A.user, 'update_order_logistics', [bOrderId, 1, {}]))).toBe('not_found');
    expect(await errorOf(rpc(A.user, 'record_payment', [bOrderId, 100, 'cash', null, null, null, null, randomUUID()]))).toBe(
      'not_found',
    );
    expect(await errorOf(rpc(A.user, 'void_payment', [bPaymentId, 'x']))).toBe('not_found');
    expect(await errorOf(rpc(A.user, 'record_refund', [bPaymentId, 100, 'cash', null, 'x', randomUUID()]))).toBe('not_found');
    expect(await errorOf(rpc(A.user, 'adjust_stock', [bVariantId, 10, 'x', randomUUID()]))).toBe('not_found');
    expect(await errorOf(rpc(A.user, 'save_customer', [{ id: bCustomerId, name: 'hack' }]))).toBe('not_found');
    expect(await errorOf(rpc(A.user, 'set_customer_archived', [bCustomerId, true]))).toBe('not_found');
    expect(await errorOf(rpc(A.user, 'log_share_opened', [bOrderId, 'summary']))).toBe('not_found');
    expect(await variantStock(B.user, bVariantId)).toEqual({ on_hand: 5, reserved: 2, available: 3 });
  });

  it('A no puede referenciar clientes ni variantes de B en sus pedidos', async () => {
    expect(
      await errorOf(rpc(A.user, 'create_order', [orderInput(bVariantId), false, null, randomUUID()])),
    ).toBe('variant_not_found');
    const own = await createProduct(A.user, { stock: 5 });
    expect(
      await errorOf(rpc(A.user, 'create_order', [orderInput(own.variantId, { customer_id: bCustomerId }), false, null, randomUUID()])),
    ).toBe('customer_not_found');
  });

  it('las FK compuestas impiden mezclar negocios incluso con acceso privilegiado', async () => {
    const [aOrder] = (
      await pool.query(
        `insert into public.orders (business_id, number, fulfillment_type, create_idempotency_key, customer_id)
         values ($1, 999, 'pickup', gen_random_uuid(), $2) returning id`,
        [A.businessId, bCustomerId],
      ).catch((e) => ({ rows: [{ error: e.code }] }))
    ).rows;
    expect(aOrder).toEqual({ error: '23503' });
  });

  it('A no puede asignar rutas de archivos de B', async () => {
    const path = `${B.businessId}/qr/${'a'.repeat(32)}.png`;
    expect(await errorOf(rpc(A.user, 'set_business_asset', ['payment_qr', path]))).toBe('invalid_file_path');
    expect(
      await errorOf(rpc(A.user, 'record_expense', [100, 'other', 'cash', null, null, `${B.businessId}/receipts/${'b'.repeat(32)}.jpg`, randomUUID()])),
    ).toBe('invalid_file_path');
  });
});

describe('almacenamiento (API real de Supabase Storage)', () => {
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let businessA: string;
  let businessB: string;
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00,
    0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78,
    0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82,
  ]);

  async function signedUpClient(label: string) {
    const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const email = `${label}-${randomUUID().slice(0, 8)}@test.local`;
    const { error } = await client.auth.signUp({ email, password: 'clave-segura-123' });
    if (error) throw error;
    const { data, error: e2 } = await client.rpc('create_business', {
      p_business_name: label,
      p_display_name: label,
      p_whatsapp_phone: null,
    });
    if (e2) throw e2;
    return { client, businessId: data as string };
  }

  beforeAll(async () => {
    ({ client: clientA, businessId: businessA } = await signedUpClient('stor-a'));
    ({ client: clientB, businessId: businessB } = await signedUpClient('stor-b'));
  });

  it('cada negocio sube y lee solo en su carpeta', async () => {
    const pathB = `${businessB}/receipts/${randomUUID().replace(/-/g, '')}.png`;
    const upB = await clientB.storage.from('business-files').upload(pathB, png, { contentType: 'image/png' });
    expect(upB.error).toBeNull();

    // A no puede descargar, firmar, listar ni borrar el archivo de B.
    const dl = await clientA.storage.from('business-files').download(pathB);
    expect(dl.data).toBeNull();
    const signed = await clientA.storage.from('business-files').createSignedUrl(pathB, 60);
    expect(signed.data).toBeNull();
    const list = await clientA.storage.from('business-files').list(`${businessB}/receipts`);
    expect(list.data ?? []).toHaveLength(0);
    await clientA.storage.from('business-files').remove([pathB]);
    const stillThere = await clientB.storage.from('business-files').download(pathB);
    expect(stillThere.error).toBeNull();

    // A no puede subir en la carpeta de B.
    const upA = await clientA.storage
      .from('business-files')
      .upload(`${businessB}/receipts/${randomUUID().replace(/-/g, '')}.png`, png, { contentType: 'image/png' });
    expect(upA.error).not.toBeNull();

    // B sí obtiene una URL firmada de corta duración.
    const own = await clientB.storage.from('business-files').createSignedUrl(pathB, 60);
    expect(own.data?.signedUrl).toContain('token=');
  });

  it('rechaza tipos no permitidos (SVG/HTML) y rutas fuera del patrón', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const r1 = await clientA.storage
      .from('business-files')
      .upload(`${businessA}/receipts/${randomUUID().replace(/-/g, '')}.png`, svg, { contentType: 'image/svg+xml' });
    expect(r1.error).not.toBeNull();
    const r2 = await clientA.storage
      .from('business-files')
      .upload(`${businessA}/otra/${randomUUID().replace(/-/g, '')}.html`, png, { contentType: 'text/html' });
    expect(r2.error).not.toBeNull();
    const r3 = await clientA.storage.from('business-files').upload(`${businessA}/receipts/x.png`, png, { contentType: 'image/png' });
    expect(r3.error).not.toBeNull();
  });
});
