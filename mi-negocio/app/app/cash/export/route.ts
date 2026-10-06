import { NextResponse, type NextRequest } from 'next/server';
import { csvAmount, toCsv } from '@/lib/csv';
import { getContext } from '@/lib/auth/session';
import { DEFAULT_TIMEZONE, formatDateTime, isDateString, localRangeBounds, todayInTimezone } from '@/lib/dates';
import { EXPENSE_CATEGORY_LABEL, PAYMENT_METHOD_LABEL, type ExpenseCategory, type PaymentMethod } from '@/lib/orders/labels';
import type { Database } from '@/lib/db/database.types';
import { createClient } from '@/lib/supabase/server';

const KIND = { payment: 'Pago', refund: 'Reembolso', expense: 'Gasto' } as Record<string, string>;

// Exporta la vista de Caja filtrada. Usa la sesión del usuario: RLS limita los datos a su negocio.
export async function GET(request: NextRequest) {
  const ctx = await getContext();
  if (!ctx?.business) return NextResponse.json({ error: 'Tu sesión venció. Iniciá sesión para continuar.' }, { status: 401 });
  const tz = ctx.business.timezone || DEFAULT_TIMEZONE;
  const sp = request.nextUrl.searchParams;
  const today = todayInTimezone(tz);
  let from = isDateString(sp.get('from') ?? '') ? sp.get('from')! : today;
  let to = isDateString(sp.get('to') ?? '') ? sp.get('to')! : from;
  if (to < from) [from, to] = [to, from];
  const { start, end } = localRangeBounds(from, to, tz);
  const supabase = await createClient();
  const data: Database['public']['Functions']['cash_entries']['Returns'] = [];
  for (let offset = 0; offset < 5000; offset += 500) {
    const page = await supabase.rpc('cash_entries', { p_start: start.toISOString(), p_end: end.toISOString(), p_limit: 500, p_offset: offset });
    if (page.error) return NextResponse.json({ error: 'No pudimos generar el archivo.' }, { status: 500 });
    data.push(...(page.data ?? []));
    if ((page.data ?? []).length < 500) break;
  }
  const rows = data.map((e) => [
    formatDateTime(e.occurred_at, tz),
    KIND[e.kind] ?? e.kind,
    e.voided_at ? 'Anulado' : 'Válido',
    csvAmount(e.kind === 'payment' ? e.amount_cents : -e.amount_cents),
    PAYMENT_METHOD_LABEL[e.method as PaymentMethod] ?? e.method,
    e.order_code ?? '',
    e.customer_name ?? '',
    e.category ? EXPENSE_CATEGORY_LABEL[e.category as ExpenseCategory] : '',
    e.description ?? '',
  ]);
  const csv = toCsv(['Fecha y hora', 'Tipo', 'Estado', 'Monto (Bs)', 'Medio', 'Pedido', 'Cliente', 'Categoría', 'Detalle'], rows);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="caja_${from}_${to}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
