// Utilidades para pruebas contra PostgreSQL local real (Supabase CLI).
// Cada "usuario" ejecuta SQL con el rol `authenticated` y sus claims JWT, igual que
// PostgREST, así que RLS y las comprobaciones de membresía se ejercitan de verdad.
import { randomUUID } from 'node:crypto';
import pg from 'pg';

export const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 12 });

export interface TestUser {
  id: string;
  email: string;
}

export async function createUser(label = 'user'): Promise<TestUser> {
  const id = randomUUID();
  const email = `${label}-${id.slice(0, 8)}@test.local`;
  await pool.query(
    `insert into auth.users (id, email, aud, role, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
     values ($1, $2, 'authenticated', 'authenticated', now(), '{}', '{}')`,
    [id, email],
  );
  return { id, email };
}

/** Ejecuta `fn` dentro de una transacción como el usuario dado (rol authenticated). */
export async function asUser<T>(user: TestUser | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (user) {
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: user.id, role: 'authenticated', email: user.email }),
      ]);
      await client.query('set local role authenticated');
    } else {
      await client.query('set local role anon');
    }
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Llama a una función pública como el usuario. Devuelve el valor escalar. */
export async function rpc<T = unknown>(user: TestUser | null, fn: string, args: unknown[] = []): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  return asUser(user, async (c) => {
    const r = await c.query(`select public.${fn}(${placeholders}) as v`, args);
    return r.rows[0]?.v as T;
  });
}

export async function query<T = Record<string, unknown>>(user: TestUser | null, sql: string, args: unknown[] = []) {
  return asUser(user, async (c) => (await c.query(sql, args)).rows as T[]);
}

/** Captura el código de error de dominio (mensaje de private.fail) o el SQLSTATE. */
export async function errorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return err.code === 'P0001' ? (err.message ?? 'P0001') : (err.code ?? 'unknown');
  }
  throw new Error('Se esperaba un error y la operación tuvo éxito');
}

export async function createOwner(label = 'owner') {
  const user = await createUser(label);
  const businessId = await rpc<string>(user, 'create_business', [`Negocio ${label}`, `Dueño ${label}`, '+59171234567', null, null]);
  return { user, businessId };
}

export async function createProduct(
  user: TestUser,
  opts: { name?: string; price?: number; stock?: number; track?: boolean; sku?: string | null } = {},
) {
  const productId = await rpc<string>(user, 'save_product', [
    {
      name: opts.name ?? 'Polera básica',
      variants: [
        {
          size: 'M',
          color: 'Negra',
          sku: opts.sku ?? null,
          price_cents: opts.price ?? 8000,
          track_inventory: opts.track ?? true,
          initial_stock: opts.stock ?? 10,
        },
      ],
    },
  ]);
  const [variant] = await query<{ id: string }>(user, 'select id from public.product_variants where product_id = $1', [productId]);
  return { productId, variantId: variant.id };
}

export async function variantStock(user: TestUser, variantId: string) {
  const [row] = await query<{ on_hand: number; reserved: number; available: number }>(
    user,
    'select on_hand, reserved, available from public.variant_stock where id = $1',
    [variantId],
  );
  return row;
}

export async function orderSummary(user: TestUser, orderId: string) {
  const [row] = await query<{
    status: string;
    revision: number;
    total_cents: string;
    net_paid_cents: string;
    balance_due_cents: string;
    refund_due_cents: string;
    payment_state: string;
  }>(user, 'select * from public.order_summaries where id = $1', [orderId]);
  return row
    ? {
        ...row,
        total_cents: Number(row.total_cents),
        net_paid_cents: Number(row.net_paid_cents),
        balance_due_cents: Number(row.balance_due_cents),
        refund_due_cents: Number(row.refund_due_cents),
      }
    : undefined;
}

export function orderInput(variantId: string, extra: Record<string, unknown> = {}) {
  return {
    fulfillment_type: 'delivery',
    delivery_fee_cents: 1500,
    discount_cents: 0,
    items: [{ variant_id: variantId, quantity: 2, unit_price_cents: 8000 }],
    ...extra,
  };
}

export { randomUUID };
