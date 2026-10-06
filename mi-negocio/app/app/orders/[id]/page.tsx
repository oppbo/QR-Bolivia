import { Lock, Paperclip } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert, Badge, Card, PageHeader, SectionTitle } from '@/components/ui/primitives';
import { FulfillmentBadge, OrderStatusBadge, PaymentStateBadge } from '@/components/ui/status';
import {
  CancelDialog,
  LogisticsDialog,
  PaymentDialog,
  RefundDialog,
  ShareDialog,
  TransitionActions,
  VoidEntryDialog,
  type OrderActionsProps,
} from '@/features/orders/detail-actions';
import { requireBusiness } from '@/lib/auth/session';
import { formatDate, formatDateTime } from '@/lib/dates';
import { formatMoney } from '@/lib/money/money';
import { computeBalance, isCollectible, type OrderStatus } from '@/lib/money/order-math';
import { ACTIVITY_LABEL, ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, type FulfillmentType, type PaymentMethod } from '@/lib/orders/labels';
import { formatPhone } from '@/lib/phone';
import { signedImageUrls } from '@/lib/storage/images';
import { createClient } from '@/lib/supabase/server';
import { buildOrderSummary, buildPaymentReminder } from '@/lib/whatsapp';

export const metadata: Metadata = { title: 'Pedido' };

export default async function OrderPage({ params, searchParams }: PageProps<'/app/orders/[id]'>) {
  const { id } = await params;
  const created = (await searchParams).created === '1';
  const { business, timezone } = await requireBusiness(`/app/orders/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: o }, { data: items }, { data: payments }, { data: refunds }, { data: events }] = await Promise.all([
    supabase.from('orders').select('*').eq('id', id).maybeSingle(),
    supabase.from('order_items').select('id, product_name, variant_label, sku, quantity, unit_price_cents, line_total_cents').eq('order_id', id).order('position'),
    supabase.from('payments').select('*').eq('order_id', id).order('occurred_at', { ascending: true }),
    supabase.from('refunds').select('*').eq('order_id', id).order('occurred_at', { ascending: true }),
    supabase.from('activity_events').select('id, event_type, metadata, created_at').eq('entity_type', 'order').eq('entity_id', id).order('created_at', { ascending: false }).limit(50),
  ]);
  if (!o) notFound();
  const code = o.code ?? `PED-${String(o.number).padStart(6, '0')}`;

  const status = o.status as OrderStatus;
  // Saldos con la misma regla central que la vista SQL y el resto de la app.
  const paid = (payments ?? []).filter((p) => !p.voided_at).reduce((s, p) => s + p.amount_cents, 0);
  const refunded = (refunds ?? []).filter((r) => !r.voided_at).reduce((s, r) => s + r.amount_cents, 0);
  const balance = computeBalance({ status, totalCents: o.total_cents, paidCents: paid, refundedCents: refunded });

  const customer = o.customer_id
    ? (await supabase.from('customers').select('id, name, phone').eq('id', o.customer_id).maybeSingle()).data
    : null;
  const phone = customer?.phone ?? o.customer_phone;
  const receiptUrls = await signedImageUrls(supabase, (payments ?? []).map((p) => p.receipt_path), 300);

  const share = {
    code,
    customerName: o.customer_name,
    fulfillmentType: o.fulfillment_type as FulfillmentType,
    promisedDate: o.promised_date,
    timeWindow: o.time_window,
    deliveryAddress: o.delivery_address,
    discountCents: o.discount_cents,
    deliveryFeeCents: o.delivery_fee_cents,
    totalCents: o.total_cents,
    netPaidCents: balance.netPaidCents,
    balanceDueCents: balance.balanceDueCents,
    items: (items ?? []).map((i) => ({ quantity: i.quantity, productName: i.product_name, variantLabel: i.variant_label, lineTotalCents: i.line_total_cents })),
  };
  const shareBusiness = { name: business.name, pickupAddress: business.pickup_address };
  const canPay = isCollectible(status) && balance.balanceDueCents > 0;
  const actionProps: OrderActionsProps = {
    id: o.id,
    code,
    revision: o.revision,
    status,
    totalCents: o.total_cents,
    balanceDueCents: balance.balanceDueCents,
    timezone,
  };
  const refundedByPayment = new Map<string, number>();
  for (const r of refunds ?? []) if (!r.voided_at) refundedByPayment.set(r.payment_id, (refundedByPayment.get(r.payment_id) ?? 0) + r.amount_cents);

  const reminderDisabled =
    status === 'canceled' ? 'El pedido está cancelado.' : !isCollectible(status) ? 'Confirmá el pedido primero.' : balance.balanceDueCents === 0 ? 'No hay saldo pendiente.' : undefined;

  return (
    <>
      <PageHeader
        title={`${code} · ${o.customer_name ?? 'Sin cliente registrado'}`}
        description={`Creado ${formatDateTime(o.created_at, timezone)}${o.confirmed_at ? ` · Confirmado ${formatDateTime(o.confirmed_at, timezone)}` : ''}`}
        back={<Link href="/app/orders" className="mb-1 inline-block text-primary underline">Pedidos</Link>}
      />
      {created ? (
        <div className="mb-4">
          <Alert tone="success" role="status" title="Pedido guardado">
            {status === 'new' ? 'Quedó como Nuevo (sin reservar stock).' : 'Confirmado y con el stock reservado.'} Podés compartir el resumen por WhatsApp.
          </Alert>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <OrderStatusBadge status={status} />
        <PaymentStateBadge state={balance.paymentState} />
        <FulfillmentBadge type={o.fulfillment_type as FulfillmentType} />
      </div>

      {status === 'canceled' ? (
        <div className="mb-4">
          <Alert tone={balance.refundDueCents > 0 ? 'danger' : 'neutral'} title={`Cancelado el ${formatDateTime(o.canceled_at!, timezone)}`}>
            <p>Motivo: {o.cancel_reason}</p>
            {o.canceled_from_status === 'delivered' ? (
              <p>{o.returned_to_stock ? 'La mercadería volvió al stock vendible.' : 'La mercadería no se repuso al stock.'}</p>
            ) : null}
            {balance.refundDueCents > 0 ? (
              <p className="mt-1 font-semibold">Reembolso pendiente: {formatMoney(balance.refundDueCents)}. Registralo cuando devuelvas el dinero.</p>
            ) : null}
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-4">
          {status !== 'canceled' && status !== 'delivered' ? (
            <Card>
              <SectionTitle>Próximo paso</SectionTitle>
              <TransitionActions {...actionProps} />
            </Card>
          ) : null}

          <Card>
            <SectionTitle>Productos</SectionTitle>
            <ul className="flex flex-col divide-y divide-line">
              {(items ?? []).map((i) => (
                <li key={i.id} className="flex justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="font-medium break-words">
                      {i.quantity} × {i.product_name}
                    </p>
                    <p className="text-sm text-muted">
                      {i.variant_label ?? 'Única'} · {formatMoney(i.unit_price_cents)} c/u{i.sku ? ` · SKU ${i.sku}` : ''}
                    </p>
                  </div>
                  <p className="tabular font-medium">{formatMoney(i.line_total_cents)}</p>
                </li>
              ))}
            </ul>
            <dl className="tabular mt-3 flex flex-col gap-1 border-t border-line pt-3">
              <div className="flex justify-between"><dt>Subtotal productos</dt><dd>{formatMoney(o.subtotal_cents)}</dd></div>
              {o.discount_cents > 0 ? <div className="flex justify-between"><dt>Descuento</dt><dd>-{formatMoney(o.discount_cents)}</dd></div> : null}
              {o.delivery_fee_cents > 0 ? <div className="flex justify-between"><dt>Envío</dt><dd>{formatMoney(o.delivery_fee_cents)}</dd></div> : null}
              <div className="flex justify-between text-lg font-bold"><dt>Total</dt><dd>{formatMoney(o.total_cents)}</dd></div>
              <div className="flex justify-between"><dt>Pagado (neto)</dt><dd>{formatMoney(balance.netPaidCents)}</dd></div>
              {status === 'canceled' ? (
                <div className="flex justify-between font-semibold"><dt>Reembolso pendiente</dt><dd>{formatMoney(balance.refundDueCents)}</dd></div>
              ) : (
                <div className="flex justify-between text-lg font-bold text-primary"><dt>Saldo pendiente</dt><dd>{formatMoney(balance.balanceDueCents)}</dd></div>
              )}
            </dl>
            {status !== 'new' ? <p className="mt-2 text-sm text-muted">Precios y montos congelados desde la confirmación.</p> : null}
          </Card>

          <Card>
            <SectionTitle action={canPay ? <PaymentDialog {...actionProps} /> : null}>Pagos y reembolsos</SectionTitle>
            {status === 'new' ? <p className="mb-2 text-muted">Confirmá el pedido para registrar pagos.</p> : null}
            {o.total_cents === 0 ? <p className="mb-2 text-muted">Pedido sin cobro (total Bs 0.00).</p> : null}
            {(payments ?? []).length === 0 ? (
              <p className="text-muted">Sin pagos registrados.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {(payments ?? []).map((p) => {
                  const refundedHere = refundedByPayment.get(p.id) ?? 0;
                  const refundable = Math.min(p.amount_cents - refundedHere, balance.refundDueCents);
                  const receipt = p.receipt_path ? receiptUrls.get(p.receipt_path) : null;
                  return (
                    <li key={p.id} className="flex flex-col gap-1 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className={p.voided_at ? 'text-muted line-through' : 'font-semibold'}>
                          Pago {formatMoney(p.amount_cents)} · {PAYMENT_METHOD_LABEL[p.method as PaymentMethod]}
                        </p>
                        {p.voided_at ? <Badge tone="neutral">Anulado</Badge> : <Badge tone="primary">Registrado manualmente</Badge>}
                      </div>
                      <p className="text-sm text-muted">
                        {formatDateTime(p.occurred_at, timezone)}
                        {p.reference ? ` · Ref. ${p.reference}` : ''}
                        {p.note ? ` · ${p.note}` : ''}
                      </p>
                      {p.voided_at ? <p className="text-sm text-muted">Anulado el {formatDateTime(p.voided_at, timezone)}: {p.void_reason}</p> : null}
                      <div className="flex flex-wrap items-center gap-2">
                        {receipt ? (
                          <a href={receipt} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1 text-sm text-primary underline">
                            <Paperclip aria-hidden className="size-4" /> Ver comprobante
                          </a>
                        ) : null}
                        {!p.voided_at && refundedHere === 0 ? <VoidEntryDialog kind="payment" entryId={p.id} amountCents={p.amount_cents} /> : null}
                        {!p.voided_at && status === 'canceled' && refundable > 0 ? <RefundDialog paymentId={p.id} maxCents={refundable} timezone={timezone} /> : null}
                      </div>
                    </li>
                  );
                })}
                {(refunds ?? []).map((r) => (
                  <li key={r.id} className="flex flex-col gap-1 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className={r.voided_at ? 'text-muted line-through' : 'font-semibold'}>
                        Reembolso −{formatMoney(r.amount_cents)} · {PAYMENT_METHOD_LABEL[r.method as PaymentMethod]}
                      </p>
                      {r.voided_at ? <Badge>Anulado</Badge> : <Badge tone="danger">Reembolso registrado</Badge>}
                    </div>
                    <p className="text-sm text-muted">
                      {formatDateTime(r.occurred_at, timezone)} · {r.reason}
                    </p>
                    {r.voided_at ? <p className="text-sm text-muted">Anulado: {r.void_reason}</p> : <VoidEntryDialog kind="refund" entryId={r.id} amountCents={r.amount_cents} />}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-sm text-muted">
              «Anular registro» corrige un registro equivocado. «Registrar reembolso» anota dinero que devolviste (solo en pedidos cancelados).
            </p>
          </Card>

          <Card>
            <SectionTitle>Historial</SectionTitle>
            <ol className="flex flex-col gap-2">
              {(events ?? []).map((e) => {
                const m = (e.metadata ?? {}) as Record<string, unknown>;
                const amount = typeof m.amount_cents === 'number' ? ` · ${formatMoney(m.amount_cents)}` : '';
                return (
                  <li key={e.id} className="flex flex-wrap justify-between gap-2 text-sm">
                    <span>
                      {ACTIVITY_LABEL[e.event_type] ?? e.event_type}
                      {amount}
                      {e.event_type === 'order_canceled' && typeof m.from === 'string' ? ` (desde ${ORDER_STATUS_LABEL[m.from as OrderStatus]})` : ''}
                    </span>
                    <time className="text-muted">{formatDateTime(e.created_at, timezone)}</time>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-2">
            <SectionTitle>WhatsApp</SectionTitle>
            <ShareDialog
              orderId={o.id}
              kind="summary"
              text={buildOrderSummary(share, shareBusiness)}
              phone={phone}
              customerId={o.customer_id}
              disabledReason={status === 'canceled' ? 'El pedido está cancelado.' : undefined}
            />
            <ShareDialog
              orderId={o.id}
              kind="reminder"
              text={buildPaymentReminder(share, shareBusiness)}
              phone={phone}
              customerId={o.customer_id}
              disabledReason={reminderDisabled}
            />
          </Card>

          <Card>
            <SectionTitle
              action={
                status !== 'canceled' ? (
                  <LogisticsDialog
                    id={o.id}
                    revision={o.revision}
                    initial={{
                      fulfillment_type: o.fulfillment_type as FulfillmentType,
                      promised_date: o.promised_date ?? '',
                      time_window: o.time_window ?? '',
                      delivery_address: o.delivery_address ?? '',
                      delivery_reference: o.delivery_reference ?? '',
                      notes: o.notes ?? '',
                    }}
                  />
                ) : null
              }
            >
              Entrega
            </SectionTitle>
            <dl className="flex flex-col gap-2">
              <div>
                <dt className="text-sm text-muted">Tipo</dt>
                <dd>{o.fulfillment_type === 'delivery' ? 'Envío a domicilio' : 'Retira en tienda'}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Fecha prometida</dt>
                <dd>{o.promised_date ? `${formatDate(o.promised_date)}${o.time_window ? `, ${o.time_window}` : ''}` : 'Sin fecha'}</dd>
              </div>
              {o.fulfillment_type === 'delivery' ? (
                <>
                  <div>
                    <dt className="text-sm text-muted">Dirección</dt>
                    <dd className="break-words">{o.delivery_address ?? <span className="text-warning">Sin dirección</span>}</dd>
                  </div>
                  {o.delivery_reference ? (
                    <div>
                      <dt className="text-sm text-muted">Referencia</dt>
                      <dd className="break-words">{o.delivery_reference}</dd>
                    </div>
                  ) : null}
                </>
              ) : business.pickup_address ? (
                <div>
                  <dt className="text-sm text-muted">Lugar de retiro</dt>
                  <dd className="break-words">{business.pickup_address}</dd>
                </div>
              ) : null}
              {o.delivered_at ? (
                <div>
                  <dt className="text-sm text-muted">Entregado</dt>
                  <dd>{formatDateTime(o.delivered_at, timezone)}</dd>
                </div>
              ) : null}
            </dl>
          </Card>

          <Card>
            <SectionTitle>Cliente</SectionTitle>
            {customer ? (
              <p>
                <Link href={`/app/customers/${customer.id}`} className="font-semibold text-primary underline">{customer.name}</Link>
                <br />
                <span className="text-muted">{customer.phone ? formatPhone(customer.phone) : 'Sin teléfono'}</span>
              </p>
            ) : (
              <p className="text-muted">
                Venta sin cliente registrado{o.customer_name ? `: ${o.customer_name}` : ''}
                {o.customer_phone ? ` · ${formatPhone(o.customer_phone)}` : ''}
              </p>
            )}
          </Card>

          {o.notes ? (
            <section className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-page p-4" aria-labelledby="order-notes">
              <h2 id="order-notes" className="mb-1 flex items-center gap-2 font-semibold">
                <Lock aria-hidden className="size-4" /> Notas privadas
              </h2>
              <p className="whitespace-pre-line break-words">{o.notes}</p>
            </section>
          ) : null}

          {status !== 'canceled' ? (
            <div>
              <CancelDialog {...actionProps} />
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
