import { Download } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Pagination, parsePage } from '@/components/ui/pagination';
import { Alert, Badge, buttonClass, Card, cx, EmptyState, Input, PageHeader, SectionTitle, Stat } from '@/components/ui/primitives';
import { ExpenseDialog, VoidExpenseDialog } from '@/features/cash/expense-dialogs';
import { requireBusiness } from '@/lib/auth/session';
import { addDays, formatDate, formatDateTime, isDateString, localRangeBounds, todayInTimezone } from '@/lib/dates';
import { formatMoney } from '@/lib/money/money';
import { netRecordedMovement } from '@/lib/money/order-math';
import { EXPENSE_CATEGORY_LABEL, PAYMENT_METHOD_LABEL, type ExpenseCategory, type PaymentMethod } from '@/lib/orders/labels';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Caja' };
const PAGE_SIZE = 25;

interface CashSummary {
  payments_cents: number;
  refunds_cents: number;
  expenses_cents: number;
  by_method: { method: PaymentMethod; payments_cents: number; refunds_cents: number; expenses_cents: number }[];
}

const KIND_LABEL = { payment: 'Pago', refund: 'Reembolso', expense: 'Gasto' } as const;

export default async function CashPage({ searchParams }: PageProps<'/app/cash'>) {
  const { timezone } = await requireBusiness('/app/cash');
  const sp = await searchParams;
  const today = todayInTimezone(timezone);
  let from = typeof sp.from === 'string' && isDateString(sp.from) ? sp.from : today;
  let to = typeof sp.to === 'string' && isDateString(sp.to) ? sp.to : from;
  if (to < from) [from, to] = [to, from];
  const page = parsePage(sp.page);
  const { start, end } = localRangeBounds(from, to, timezone);

  const supabase = await createClient();
  const [{ data: summaryRaw, error }, { data: entries }] = await Promise.all([
    supabase.rpc('cash_summary', { p_start: start.toISOString(), p_end: end.toISOString() }),
    supabase.rpc('cash_entries', { p_start: start.toISOString(), p_end: end.toISOString(), p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE }),
  ]);
  const s = summaryRaw as unknown as CashSummary | null;
  const total = entries?.[0]?.total_count ?? 0;
  const net = s ? netRecordedMovement({ paymentsCents: s.payments_cents, refundsCents: s.refunds_cents, expensesCents: s.expenses_cents }) : 0;
  const rangeLabel = from === to ? (from === today ? `Hoy, ${formatDate(from)}` : formatDate(from)) : `${formatDate(from)} al ${formatDate(to)}`;
  const preset = (label: string, f: string, t: string) => (
    <Link href={`/app/cash?from=${f}&to=${t}`} aria-current={from === f && to === t ? 'true' : undefined} className={cx(buttonClass(from === f && to === t ? 'primary' : 'secondary'), 'min-h-10 px-3 text-sm')}>
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Caja"
        description="Registro de movimientos de dinero anotados en Mi Negocio. No es un estado de cuenta bancario ni un cálculo de ganancia."
        actions={<ExpenseDialog timezone={timezone} />}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        {preset('Hoy', today, today)}
        {preset('Ayer', addDays(today, -1), addDays(today, -1))}
        {preset('Últimos 7 días', addDays(today, -6), today)}
      </div>
      <form className="mb-5 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Desde</span>
          <Input type="date" name="from" defaultValue={from} className="w-auto" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Hasta</span>
          <Input type="date" name="to" defaultValue={to} className="w-auto" />
        </label>
        <button className={buttonClass('secondary')}>Ver</button>
        <a href={`/app/cash/export?from=${from}&to=${to}`} className={cx(buttonClass('ghost'), 'ml-auto')}>
          <Download aria-hidden className="size-4" /> Exportar CSV
        </a>
      </form>

      {error || !s ? (
        <Alert tone="danger" role="alert">No pudimos cargar la caja. Actualizá la página.</Alert>
      ) : (
        <>
          <h2 className="mb-2 font-semibold">{rangeLabel}</h2>
          <section aria-label="Totales" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Cobrado" value={formatMoney(s.payments_cents)} help="Pagos válidos registrados." />
            <Stat label="Reembolsos" value={formatMoney(s.refunds_cents)} help="Dinero devuelto a clientes." />
            <Stat label="Gastos" value={formatMoney(s.expenses_cents)} help="Gastos operativos registrados." />
            <Stat label="Movimiento neto registrado" value={formatMoney(net)} help="Cobrado − reembolsos − gastos. No es ganancia." />
          </section>

          <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
            <Card>
              <SectionTitle>Por medio de pago</SectionTitle>
              <ul className="flex flex-col divide-y divide-line">
                {s.by_method.map((m) => {
                  const mNet = netRecordedMovement({ paymentsCents: m.payments_cents, refundsCents: m.refunds_cents, expensesCents: m.expenses_cents });
                  return (
                    <li key={m.method} className="py-2">
                      <div className="flex justify-between font-medium">
                        <span>{PAYMENT_METHOD_LABEL[m.method]}</span>
                        <span className="tabular">{formatMoney(mNet)}</span>
                      </div>
                      <p className="tabular text-sm text-muted">
                        +{formatMoney(m.payments_cents)} · −{formatMoney(m.refunds_cents)} reemb. · −{formatMoney(m.expenses_cents)} gastos
                      </p>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-sm text-muted">Los envíos ya están incluidos en los pagos de los pedidos. Un pedido cuenta acá solo cuando registrás su pago.</p>
            </Card>
            <Card>
              <SectionTitle>Movimientos</SectionTitle>
              {!entries || entries.length === 0 ? (
                <EmptyState title="Sin movimientos en este período" description="Los pagos, reembolsos y gastos que registres aparecen acá." />
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {entries.map((e) => {
                    const sign = e.kind === 'payment' ? '+' : '−';
                    return (
                      <li key={`${e.kind}-${e.id}`} className="flex flex-col gap-1 py-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={e.kind === 'payment' ? 'success' : e.kind === 'refund' ? 'danger' : 'warning'}>{KIND_LABEL[e.kind as keyof typeof KIND_LABEL]}</Badge>
                            {e.voided_at ? <Badge>Anulado</Badge> : null}
                          </div>
                          <span className={cx('tabular font-semibold', e.voided_at && 'text-muted line-through')}>
                            {sign}
                            {formatMoney(e.amount_cents)}
                          </span>
                        </div>
                        <p className="text-sm">
                          {e.order_id ? (
                            <Link href={`/app/orders/${e.order_id}`} className="text-primary underline">
                              {e.order_code}
                              {e.customer_name ? ` · ${e.customer_name}` : ''}
                            </Link>
                          ) : (
                            <span>
                              {EXPENSE_CATEGORY_LABEL[e.category as ExpenseCategory] ?? ''}
                              {e.description ? ` · ${e.description}` : ''}
                            </span>
                          )}
                        </p>
                        <p className="text-sm text-muted">
                          {formatDateTime(e.occurred_at, timezone)} · {PAYMENT_METHOD_LABEL[e.method as PaymentMethod]}
                          {e.kind === 'payment' ? ' · Registrado manualmente' : ''}
                          {e.voided_at ? ` · Anulado: ${e.void_reason}` : ''}
                        </p>
                        {e.kind === 'expense' && !e.voided_at ? (
                          <div className="flex gap-1">
                            <ExpenseDialog
                              timezone={timezone}
                              correcting={{ id: e.id, amount_cents: e.amount_cents, category: e.category!, method: e.method, occurred_at: e.occurred_at, description: e.description }}
                            />
                            <VoidExpenseDialog id={e.id} amountCents={e.amount_cents} />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/app/cash" params={{ from, to }} />
            </Card>
          </div>
        </>
      )}
    </>
  );
}
