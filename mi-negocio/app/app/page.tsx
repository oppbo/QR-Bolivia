import { AlertTriangle, Package, Plus, ReceiptText } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, ButtonLink, Card, EmptyState, SectionTitle, Stat } from '@/components/ui/primitives';
import { FulfillmentBadge, OrderStatusBadge, PaymentStateBadge } from '@/components/ui/status';
import { requireBusiness } from '@/lib/auth/session';
import { formatDate, formatDateTime, localDayBounds, todayInTimezone } from '@/lib/dates';
import { formatMoney } from '@/lib/money/money';
import type { OrderStatus, PaymentState } from '@/lib/money/order-math';
import { ACTIVITY_LABEL, type FulfillmentType } from '@/lib/orders/labels';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Inicio' };

interface Summary {
  sales_confirmed_cents: number;
  sales_confirmed_count: number;
  collected_cents: number;
  refunded_cents: number;
  receivable_cents: number;
  receivable_count: number;
  due_today_delivery: number;
  due_today_pickup: number;
  overdue_count: number;
  product_count: number;
  order_count: number;
}

const OPEN = ['new', 'confirmed', 'preparing'];

export default async function DashboardPage() {
  const { business, displayName, timezone } = await requireBusiness('/app');
  const today = todayInTimezone(timezone);
  const { start, end } = localDayBounds(today, timezone);
  const supabase = await createClient();

  const [{ data: summaryRaw, error }, { data: pending }, { data: balances }, { data: activity }] = await Promise.all([
    supabase.rpc('dashboard_summary', { p_start: start.toISOString(), p_end: end.toISOString(), p_today: today }),
    supabase
      .from('order_summaries')
      .select('id, code, customer_name, status, fulfillment_type, promised_date, time_window, balance_due_cents')
      .in('status', OPEN)
      .lte('promised_date', today)
      .order('promised_date', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(6),
    supabase
      .from('order_summaries')
      .select('id, code, customer_name, status, payment_state, balance_due_cents, promised_date')
      .eq('is_collectible', true)
      .gt('balance_due_cents', 0)
      .order('balance_due_cents', { ascending: false })
      .limit(5),
    supabase.from('activity_events').select('id, entity_type, entity_id, event_type, metadata, created_at').order('created_at', { ascending: false }).limit(8),
  ]);
  const s = summaryRaw as unknown as Summary | null;
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const greeting = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';

  if (error || !s) {
    return <Alert tone="danger" role="alert" title="No pudimos cargar el inicio">Revisá tu conexión y actualizá la página.</Alert>;
  }

  const header = (
    <header className="mb-5">
      <p className="text-muted">{greeting}{displayName ? `, ${displayName}` : ''}</p>
      <h1 className="text-2xl font-bold">{business.name}</h1>
      <p className="text-sm text-muted">Hoy, {formatDate(today)}</p>
    </header>
  );

  if (s.product_count === 0 && s.order_count === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={<Package aria-hidden className="size-10" />}
          title="Empecemos por tus productos"
          description="Cargá lo que vendés con sus tallas, colores y stock. Después vas a poder crear pedidos, registrar pagos y ver quién te debe."
          actions={
            <>
              <ButtonLink href="/app/products/new">Agregar primer producto</ButtonLink>
              <ButtonLink variant="secondary" href="/app/orders/new">Crear pedido</ButtonLink>
            </>
          }
        />
      </>
    );
  }

  const dueToday = s.due_today_delivery + s.due_today_pickup;

  return (
    <>
      {header}
      <section aria-label="Resumen de hoy" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Ventas confirmadas hoy"
          value={formatMoney(s.sales_confirmed_cents)}
          help={`${s.sales_confirmed_count} ${s.sales_confirmed_count === 1 ? 'pedido' : 'pedidos'}. Lo vendido, no lo cobrado.`}
        />
        <Stat
          label="Cobrado hoy"
          value={formatMoney(s.collected_cents)}
          help={s.refunded_cents > 0 ? `Reembolsos hoy: ${formatMoney(s.refunded_cents)}` : 'Pagos registrados hoy.'}
        />
        <Stat label="Saldo por cobrar" value={formatMoney(s.receivable_cents)} help={`${s.receivable_count} ${s.receivable_count === 1 ? 'pedido' : 'pedidos'} con saldo.`} />
        <Stat label="Entregas de hoy" value={dueToday} help={`${s.due_today_delivery} envíos · ${s.due_today_pickup} retiros`} />
      </section>

      {s.overdue_count > 0 ? (
        <div className="mb-5">
          <Link href="/app/orders?quick=overdue" className="block rounded-[var(--radius-field)] border border-danger/30 bg-danger-soft px-4 py-3 text-danger hover:underline">
            <span className="flex items-center gap-2 font-semibold">
              <AlertTriangle aria-hidden className="size-5" />
              {s.overdue_count} {s.overdue_count === 1 ? 'entrega atrasada' : 'entregas atrasadas'}
            </span>
          </Link>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle action={<Link href="/app/orders?quick=today" className="text-sm text-primary underline">Ver todas</Link>}>Entregas pendientes</SectionTitle>
          {pending && pending.length > 0 ? (
            <ul className="flex flex-col divide-y divide-line">
              {pending.map((o) => {
                const overdue = (o.promised_date ?? '') < today;
                return (
                  <li key={o.id}>
                    <Link href={`/app/orders/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 hover:bg-page">
                      <div className="min-w-0">
                        <p className="font-medium">{o.code} · {o.customer_name ?? 'Sin cliente'}</p>
                        <p className={overdue ? 'text-sm font-semibold text-danger' : 'text-sm text-muted'}>
                          {overdue ? `Atrasado (${formatDate(o.promised_date)})` : `Hoy${o.time_window ? `, ${o.time_window}` : ''}`}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <FulfillmentBadge type={o.fulfillment_type as FulfillmentType} />
                        <OrderStatusBadge status={o.status as OrderStatus} />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-muted">No hay entregas pendientes para hoy.</p>
          )}
        </Card>

        <Card>
          <SectionTitle action={<Link href="/app/orders?quick=balance" className="text-sm text-primary underline">Ver todos</Link>}>Pedidos con saldo</SectionTitle>
          {balances && balances.length > 0 ? (
            <ul className="flex flex-col divide-y divide-line">
              {balances.map((o) => (
                <li key={o.id}>
                  <Link href={`/app/orders/${o.id}`} className="flex items-center justify-between gap-2 py-2.5 hover:bg-page">
                    <div className="min-w-0">
                      <p className="font-medium">{o.code} · {o.customer_name ?? 'Sin cliente'}</p>
                      <PaymentStateBadge state={o.payment_state as PaymentState} />
                    </div>
                    <p className="tabular font-semibold">{formatMoney(o.balance_due_cents!)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Nadie te debe por ahora.</p>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle>Actividad reciente</SectionTitle>
          {activity && activity.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {activity.map((a) => {
                const m = (a.metadata ?? {}) as Record<string, unknown>;
                const href = a.entity_type === 'order' ? `/app/orders/${a.entity_id}` : a.entity_type === 'product' ? `/app/products/${a.entity_id}` : a.entity_type === 'customer' ? `/app/customers/${a.entity_id}` : a.entity_type === 'expense' ? '/app/cash' : null;
                const detail = typeof m.code === 'string' ? m.code : typeof m.name === 'string' ? m.name : '';
                const amount = typeof m.amount_cents === 'number' ? formatMoney(m.amount_cents) : '';
                const text = [ACTIVITY_LABEL[a.event_type] ?? a.event_type, detail, amount].filter(Boolean).join(' · ');
                return (
                  <li key={a.id} className="flex flex-wrap justify-between gap-2 text-sm">
                    {href ? <Link href={href} className="text-primary underline-offset-2 hover:underline">{text}</Link> : <span>{text}</span>}
                    <time className="text-muted">{formatDateTime(a.created_at, timezone)}</time>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-muted">Sin actividad todavía.</p>
          )}
        </Card>
      </div>

      {s.order_count === 0 ? (
        <div className="mt-5">
          <EmptyState
            icon={<ReceiptText aria-hidden className="size-10" />}
            title="Todavía no hay pedidos"
            description="Cuando un cliente te escriba por WhatsApp, registrá el pedido para saber qué entregar y cuánto falta cobrar."
            actions={
              <ButtonLink href="/app/orders/new">
                <Plus aria-hidden className="size-5" /> Crear pedido
              </ButtonLink>
            }
          />
        </div>
      ) : null}
    </>
  );
}
