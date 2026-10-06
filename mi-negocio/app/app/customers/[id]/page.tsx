import { Lock, MessageCircle, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pagination, parsePage } from '@/components/ui/pagination';
import { Alert, buttonClass, ButtonLink, Card, PageHeader, SectionTitle, Stat } from '@/components/ui/primitives';
import { OrderStatusBadge, PaymentStateBadge } from '@/components/ui/status';
import { CustomerArchiveButton, EditCustomerButton } from '@/features/customers/customer-dialogs';
import { requireBusiness } from '@/lib/auth/session';
import { formatDate, formatDateTime } from '@/lib/dates';
import { formatMoney } from '@/lib/money/money';
import type { OrderStatus, PaymentState } from '@/lib/money/order-math';
import { formatPhone } from '@/lib/phone';
import { createClient } from '@/lib/supabase/server';
import { whatsappChatUrl } from '@/lib/whatsapp';

export const metadata: Metadata = { title: 'Cliente' };
const PAGE_SIZE = 20;

export default async function CustomerPage({ params, searchParams }: PageProps<'/app/customers/[id]'>) {
  const { id } = await params;
  const { timezone } = await requireBusiness(`/app/customers/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const page = parsePage((await searchParams).page);
  const supabase = await createClient();
  const [{ data: c }, { data: totalsRows }, { data: orders }] = await Promise.all([
    supabase.from('customers').select('*').eq('id', id).maybeSingle(),
    supabase.rpc('customer_totals', { p_customer_id: id }),
    supabase.rpc('list_orders', { p_customer_id: id, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE }),
  ]);
  if (!c) notFound();
  const totals = totalsRows?.[0] ?? { order_count: 0, net_paid_cents: 0, balance_due_cents: 0, refund_due_cents: 0 };
  const total = orders?.[0]?.total_count ?? 0;

  return (
    <>
      <PageHeader
        title={c.name}
        description={c.archived_at ? 'Cliente archivado' : undefined}
        back={<Link href="/app/customers" className="mb-1 inline-block text-primary underline">Clientes</Link>}
        actions={
          <>
            {c.phone ? (
              <a href={whatsappChatUrl(c.phone)} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary')}>
                <MessageCircle aria-hidden className="size-4" /> Abrir WhatsApp
              </a>
            ) : null}
            {!c.archived_at ? (
              <ButtonLink href={`/app/orders/new?customer=${c.id}`}>
                <Plus aria-hidden className="size-4" /> Nuevo pedido
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Saldo pendiente" value={formatMoney(totals.balance_due_cents)} help="De pedidos confirmados, en preparación o entregados." />
        <Stat label="Pagado (neto)" value={formatMoney(totals.net_paid_cents)} help="Pagos válidos menos reembolsos." />
        {totals.refund_due_cents > 0 ? (
          <Stat tone="warning" label="Reembolso pendiente" value={formatMoney(totals.refund_due_cents)} help="De pedidos cancelados." />
        ) : (
          <Stat label="Pedidos" value={totals.order_count} />
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <SectionTitle>Historial de pedidos</SectionTitle>
          {orders && orders.length > 0 ? (
            <ul className="flex flex-col divide-y divide-line">
              {orders.map((o) => (
                <li key={o.id}>
                  <Link href={`/app/orders/${o.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-page">
                    <div>
                      <p className="font-semibold">{o.code}</p>
                      <p className="text-sm text-muted">
                        Creado {formatDateTime(o.created_at, timezone)}
                        {o.promised_date ? ` · Entrega ${formatDate(o.promised_date)}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <OrderStatusBadge status={o.status as OrderStatus} />
                      <PaymentStateBadge state={o.payment_state as PaymentState} />
                      <span className="tabular text-sm font-semibold">
                        {o.balance_due_cents > 0 ? `Saldo ${formatMoney(o.balance_due_cents)}` : formatMoney(o.total_cents)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Sin pedidos todavía.</p>
          )}
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath={`/app/customers/${id}`} params={{}} />
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <SectionTitle action={<EditCustomerButton initial={{ id: c.id, revision: c.revision, name: c.name, phone: c.phone ?? '', address: c.address ?? '', delivery_reference: c.delivery_reference ?? '', notes: c.notes ?? '' }} />}>
              Datos de contacto
            </SectionTitle>
            <dl className="flex flex-col gap-2">
              <div><dt className="text-sm text-muted">Teléfono</dt><dd>{c.phone ? formatPhone(c.phone) : 'Sin teléfono'}</dd></div>
              <div><dt className="text-sm text-muted">Dirección</dt><dd className="break-words">{c.address ?? '—'}</dd></div>
              <div><dt className="text-sm text-muted">Referencia</dt><dd className="break-words">{c.delivery_reference ?? '—'}</dd></div>
            </dl>
          </Card>
          <section className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-page p-4" aria-labelledby="notes-title">
            <h2 id="notes-title" className="mb-1 flex items-center gap-2 font-semibold">
              <Lock aria-hidden className="size-4" /> Notas privadas
            </h2>
            <p className="mb-2 text-sm text-muted">Solo vos las ves. No se comparten por WhatsApp.</p>
            <p className="whitespace-pre-line break-words">{c.notes ?? 'Sin notas.'}</p>
          </section>
          <div className="flex flex-col gap-2">
            <CustomerArchiveButton customerId={c.id} archived={Boolean(c.archived_at)} />
            {c.archived_at ? <Alert tone="warning">Archivado: no aparece al crear pedidos. Su historial se conserva.</Alert> : null}
          </div>
        </div>
      </div>
    </>
  );
}
