import { Download, Plus, ReceiptText, SlidersHorizontal } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Pagination, parsePage } from '@/components/ui/pagination';
import { Alert, ButtonLink, buttonClass, cx, EmptyState, Input, PageHeader, Select } from '@/components/ui/primitives';
import { FulfillmentBadge, OrderStatusBadge, PaymentStateBadge } from '@/components/ui/status';
import { requireBusiness } from '@/lib/auth/session';
import { formatDate, isDateString, todayInTimezone } from '@/lib/dates';
import { formatMoney } from '@/lib/money/money';
import type { OrderStatus, PaymentState } from '@/lib/money/order-math';
import { ORDER_STATUS_LABEL, PAYMENT_STATE_LABEL, type FulfillmentType } from '@/lib/orders/labels';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Pedidos' };
const PAGE_SIZE = 25;
const STATUSES = Object.keys(ORDER_STATUS_LABEL);
const PAYMENT_STATES = Object.keys(PAYMENT_STATE_LABEL);
const QUICK = { today: 'Entregas de hoy', overdue: 'Atrasados', balance: 'Con saldo' } as const;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function OrdersPage({ searchParams }: PageProps<'/app/orders'>) {
  const { timezone } = await requireBusiness('/app/orders');
  const sp = await searchParams;
  const q = (one(sp.q) ?? '').slice(0, 80);
  const status = STATUSES.includes(one(sp.status) ?? '') ? one(sp.status) : undefined;
  const pay = PAYMENT_STATES.includes(one(sp.pay) ?? '') ? one(sp.pay) : undefined;
  const type = one(sp.type) === 'pickup' || one(sp.type) === 'delivery' ? one(sp.type) : undefined;
  const from = isDateString(one(sp.from) ?? '') ? one(sp.from) : undefined;
  const to = isDateString(one(sp.to) ?? '') ? one(sp.to) : undefined;
  const quick = (one(sp.quick) ?? '') in QUICK ? (one(sp.quick) as keyof typeof QUICK) : undefined;
  const sort = ['created_desc', 'created_asc', 'promised_asc', 'balance_desc'].includes(one(sp.sort) ?? '') ? one(sp.sort)! : 'created_desc';
  const page = parsePage(sp.page);
  const today = todayInTimezone(timezone);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('list_orders', {
    p_search: q || undefined,
    p_status: status,
    p_payment_state: pay,
    p_fulfillment_type: type,
    p_from: from,
    p_to: to,
    p_quick: quick,
    p_today: today,
    p_sort: sort,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });
  const rows = data ?? [];
  const total = rows[0]?.total_count ?? 0;
  const params = { q: q || undefined, status, pay, type, from, to, quick, sort: sort !== 'created_desc' ? sort : undefined };
  const anyFilter = Boolean(q || status || pay || type || from || to || quick);
  const advancedOpen = Boolean(status || pay || type || from || to || sort !== 'created_desc');

  const quickHref = (k?: string) => {
    const s = new URLSearchParams();
    if (k) s.set('quick', k);
    return `/app/orders${s.size ? `?${s}` : ''}`;
  };

  return (
    <>
      <PageHeader
        title="Pedidos"
        actions={
          <ButtonLink href="/app/orders/new">
            <Plus aria-hidden className="size-5" /> Nuevo pedido
          </ButtonLink>
        }
      />
      <nav aria-label="Filtros rápidos" className="mb-3 flex flex-wrap gap-2">
        <Link href={quickHref()} aria-current={!anyFilter ? 'true' : undefined} className={cx(buttonClass(!anyFilter ? 'primary' : 'secondary'), 'min-h-10 px-3 text-sm')}>
          Todos
        </Link>
        {Object.entries(QUICK).map(([k, label]) => (
          <Link key={k} href={quickHref(k)} aria-current={quick === k ? 'true' : undefined} className={cx(buttonClass(quick === k ? 'primary' : 'secondary'), 'min-h-10 px-3 text-sm')}>
            {label}
          </Link>
        ))}
      </nav>

      <form className="mb-4 flex flex-col gap-3" role="search">
        {quick ? <input type="hidden" name="quick" value={quick} /> : null}
        <div className="flex gap-2">
          <label htmlFor="q" className="sr-only">Buscar por número, cliente o teléfono</label>
          <Input id="q" name="q" type="search" defaultValue={q} placeholder="Número, cliente o teléfono" />
          <button className={buttonClass('primary')}>Buscar</button>
        </div>
        <details open={advancedOpen} className="rounded-[var(--radius-card)] border border-line bg-surface">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 font-medium">
            <SlidersHorizontal aria-hidden className="size-4" /> Más filtros
          </summary>
          <div className="grid gap-3 p-4 pt-0 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Estado</span>
              <Select name="status" defaultValue={status ?? ''}>
                <option value="">Todos</option>
                {STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABEL[s as OrderStatus]}</option>)}
              </Select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Pago</span>
              <Select name="pay" defaultValue={pay ?? ''}>
                <option value="">Todos</option>
                {PAYMENT_STATES.map((s) => <option key={s} value={s}>{PAYMENT_STATE_LABEL[s as PaymentState]}</option>)}
              </Select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Entrega</span>
              <Select name="type" defaultValue={type ?? ''}>
                <option value="">Retiro y envío</option>
                <option value="pickup">Retiro</option>
                <option value="delivery">Envío</option>
              </Select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Fecha de entrega desde</span>
              <Input type="date" name="from" defaultValue={from} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">hasta</span>
              <Input type="date" name="to" defaultValue={to} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">Ordenar por</span>
              <Select name="sort" defaultValue={sort}>
                <option value="created_desc">Más recientes</option>
                <option value="created_asc">Más antiguos</option>
                <option value="promised_asc">Fecha de entrega</option>
                <option value="balance_desc">Mayor saldo</option>
              </Select>
            </label>
            <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
              <button className={buttonClass('primary')}>Aplicar filtros</button>
              <Link href="/app/orders" className={buttonClass('secondary')}>Limpiar</Link>
            </div>
          </div>
        </details>
      </form>

      {error ? (
        <Alert tone="danger" role="alert">No pudimos cargar los pedidos. Actualizá la página.</Alert>
      ) : rows.length === 0 ? (
        anyFilter ? (
          <EmptyState title="No hay pedidos con estos filtros" actions={<ButtonLink variant="secondary" href="/app/orders">Ver todos</ButtonLink>} />
        ) : (
          <EmptyState
            icon={<ReceiptText aria-hidden className="size-10" />}
            title="Todavía no hay pedidos"
            description="Cuando un cliente te pida algo por WhatsApp, registralo acá para no perder el saldo ni la entrega."
            actions={<ButtonLink href="/app/orders/new">Crear pedido</ButtonLink>}
          />
        )
      ) : (
        <>
          {/* Móvil: tarjetas */}
          <ul className="flex flex-col gap-2 md:hidden">
            {rows.map((o) => {
              const overdue = o.promised_date && o.promised_date < today && ['new', 'confirmed', 'preparing'].includes(o.status);
              return (
                <li key={o.id}>
                  <Link href={`/app/orders/${o.id}`} className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:border-line-strong">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold">{o.code}</p>
                        <p className="break-words text-muted">{o.customer_name ?? 'Sin cliente registrado'}</p>
                      </div>
                      <div className="tabular text-right">
                        <p className="font-semibold">{formatMoney(o.total_cents)}</p>
                        {o.balance_due_cents > 0 ? <p className="text-sm text-warning">Saldo {formatMoney(o.balance_due_cents)}</p> : null}
                        {o.refund_due_cents > 0 ? <p className="text-sm text-danger">Reembolso {formatMoney(o.refund_due_cents)}</p> : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <OrderStatusBadge status={o.status as OrderStatus} />
                      <PaymentStateBadge state={o.payment_state as PaymentState} />
                      <FulfillmentBadge type={o.fulfillment_type as FulfillmentType} />
                      {o.promised_date ? (
                        <span className={cx('text-sm', overdue ? 'font-semibold text-danger' : 'text-muted')}>
                          {overdue ? 'Atrasado · ' : ''}
                          {formatDate(o.promised_date)}
                        </span>
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          {/* Escritorio: tabla */}
          <div className="hidden overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface md:block">
            <table className="w-full text-left">
              <thead className="border-b border-line bg-page text-sm text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Pedido</th>
                  <th scope="col" className="px-4 py-3 font-medium">Cliente</th>
                  <th scope="col" className="px-4 py-3 font-medium">Estado</th>
                  <th scope="col" className="px-4 py-3 font-medium">Entrega</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Total</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((o) => {
                  const overdue = o.promised_date && o.promised_date < today && ['new', 'confirmed', 'preparing'].includes(o.status);
                  return (
                    <tr key={o.id} className="hover:bg-page">
                      <td className="px-4 py-3">
                        <Link href={`/app/orders/${o.id}`} className="font-semibold text-primary underline-offset-2 hover:underline">{o.code}</Link>
                      </td>
                      <td className="max-w-48 truncate px-4 py-3">{o.customer_name ?? 'Sin cliente registrado'}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          <OrderStatusBadge status={o.status as OrderStatus} />
                          <PaymentStateBadge state={o.payment_state as PaymentState} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <FulfillmentBadge type={o.fulfillment_type as FulfillmentType} />{' '}
                        <span className={overdue ? 'font-semibold text-danger' : 'text-muted'}>
                          {overdue ? 'Atrasado · ' : ''}
                          {formatDate(o.promised_date)}
                        </span>
                      </td>
                      <td className="tabular px-4 py-3 text-right">{formatMoney(o.total_cents)}</td>
                      <td className="tabular px-4 py-3 text-right font-semibold">
                        {o.refund_due_cents > 0 ? <span className="text-danger">Reembolso {formatMoney(o.refund_due_cents)}</span> : formatMoney(o.balance_due_cents)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/app/orders" params={params} />
      {rows.length > 0 ? (
        <p className="mt-3 text-right">
          <a
            className="inline-flex min-h-11 items-center gap-2 text-primary underline"
            href={`/app/orders/export?${new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))).toString()}`}
          >
            <Download aria-hidden className="size-4" /> Exportar CSV (con estos filtros)
          </a>
        </p>
      ) : null}
    </>
  );
}
