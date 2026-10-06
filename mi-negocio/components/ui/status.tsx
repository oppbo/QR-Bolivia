import { Ban, CheckCircle2, CircleDashed, Clock, Gift, PackageCheck, PackageOpen, RotateCcw, Truck, Wallet } from 'lucide-react';
import type { OrderStatus, PaymentState } from '@/lib/money/order-math';
import { FULFILLMENT_LABEL, ORDER_STATUS_LABEL, PAYMENT_STATE_LABEL, type FulfillmentType } from '@/lib/orders/labels';
import { Badge } from './primitives';

const ic = 'size-3.5';

// El estado nunca se comunica solo con color: siempre texto + ícono.
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const map = {
    new: { tone: 'info', icon: <CircleDashed aria-hidden className={ic} /> },
    confirmed: { tone: 'primary', icon: <CheckCircle2 aria-hidden className={ic} /> },
    preparing: { tone: 'warning', icon: <PackageOpen aria-hidden className={ic} /> },
    delivered: { tone: 'success', icon: <PackageCheck aria-hidden className={ic} /> },
    canceled: { tone: 'neutral', icon: <Ban aria-hidden className={ic} /> },
  } as const;
  const m = map[status];
  return (
    <Badge tone={m.tone} icon={m.icon}>
      <span className="sr-only">Estado: </span>
      {ORDER_STATUS_LABEL[status]}
    </Badge>
  );
}

export function PaymentStateBadge({ state }: { state: PaymentState }) {
  const map = {
    pending: { tone: 'warning', icon: <Clock aria-hidden className={ic} /> },
    partial: { tone: 'info', icon: <Wallet aria-hidden className={ic} /> },
    paid: { tone: 'success', icon: <CheckCircle2 aria-hidden className={ic} /> },
    no_charge: { tone: 'neutral', icon: <Gift aria-hidden className={ic} /> },
    refund_pending: { tone: 'danger', icon: <RotateCcw aria-hidden className={ic} /> },
    canceled_settled: { tone: 'neutral', icon: <Ban aria-hidden className={ic} /> },
  } as const;
  const m = map[state];
  return (
    <Badge tone={m.tone} icon={m.icon}>
      <span className="sr-only">Pago: </span>
      {PAYMENT_STATE_LABEL[state]}
    </Badge>
  );
}

export function FulfillmentBadge({ type }: { type: FulfillmentType }) {
  return (
    <Badge tone="neutral" icon={type === 'delivery' ? <Truck aria-hidden className={ic} /> : <PackageCheck aria-hidden className={ic} />}>
      {FULFILLMENT_LABEL[type]}
    </Badge>
  );
}
