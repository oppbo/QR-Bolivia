import { NextResponse, type NextRequest } from 'next/server';
import { csvAmount, toCsv } from '@/lib/csv';
import { getContext } from '@/lib/auth/session';
import { DEFAULT_TIMEZONE, formatDate, formatDateTime, isDateString, todayInTimezone } from '@/lib/dates';
import type { OrderStatus, PaymentState } from '@/lib/money/order-math';
import { FULFILLMENT_LABEL, ORDER_STATUS_LABEL, PAYMENT_STATE_LABEL, type FulfillmentType } from '@/lib/orders/labels';
import type { Database } from '@/lib/db/database.types';
import { createClient } from '@/lib/supabase/server';

type OrderRow = Database['public']['Functions']['list_orders']['Returns'][number];

// Exporta pedidos con los mismos filtros del listado (máx. 2000 filas). RLS limita al negocio del usuario.
export async function GET(request: NextRequest) {
  const ctx = await getContext();
  if (!ctx?.business) return NextResponse.json({ error: 'Tu sesión venció. Iniciá sesión para continuar.' }, { status: 401 });
  const tz = ctx.business.timezone || DEFAULT_TIMEZONE;
  const sp = request.nextUrl.searchParams;
  const pick = (k: string, allowed?: string[]) => {
    const v = sp.get(k) ?? undefined;
    if (!v) return undefined;
    return allowed && !allowed.includes(v) ? undefined : v;
  };
  const supabase = await createClient();
  const all: OrderRow[] = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    const { data, error } = await supabase.rpc('list_orders', {
      p_search: pick('q')?.slice(0, 80),
      p_status: pick('status', Object.keys(ORDER_STATUS_LABEL)),
      p_payment_state: pick('pay', Object.keys(PAYMENT_STATE_LABEL)),
      p_fulfillment_type: pick('type', ['pickup', 'delivery']),
      p_from: isDateString(sp.get('from') ?? '') ? sp.get('from')! : undefined,
      p_to: isDateString(sp.get('to') ?? '') ? sp.get('to')! : undefined,
      p_quick: pick('quick', ['today', 'overdue', 'balance']),
      p_today: todayInTimezone(tz),
      p_sort: pick('sort', ['created_desc', 'created_asc', 'promised_asc', 'balance_desc']) ?? 'created_desc',
      p_limit: 100,
      p_offset: offset,
    });
    if (error) return NextResponse.json({ error: 'No pudimos generar el archivo.' }, { status: 500 });
    all.push(...(data ?? []));
    if (!data || data.length < 100) break;
  }
  const rows = all.map((o) => [
    o.code,
    formatDateTime(o.created_at, tz),
    o.customer_name ?? '',
    ORDER_STATUS_LABEL[o.status as OrderStatus],
    PAYMENT_STATE_LABEL[o.payment_state as PaymentState],
    FULFILLMENT_LABEL[o.fulfillment_type as FulfillmentType],
    formatDate(o.promised_date),
    csvAmount(o.total_cents),
    csvAmount(o.net_paid_cents),
    csvAmount(o.balance_due_cents),
    csvAmount(o.refund_due_cents),
  ]);
  const csv = toCsv(
    ['Pedido', 'Creado', 'Cliente', 'Estado', 'Pago', 'Entrega', 'Fecha prometida', 'Total (Bs)', 'Pagado neto (Bs)', 'Saldo (Bs)', 'Reembolso pendiente (Bs)'],
    rows,
  );
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="pedidos_${todayInTimezone(tz)}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
