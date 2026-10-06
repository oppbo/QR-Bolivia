// Reglas financieras centralizadas. La vista SQL public.order_summaries aplica
// exactamente las mismas fórmulas (ver supabase/migrations/*_reports.sql) y un test
// de base de datos verifica que coincidan.

export type OrderStatus = 'new' | 'confirmed' | 'preparing' | 'delivered' | 'canceled';
export type PaymentState =
  | 'pending'
  | 'partial'
  | 'paid'
  | 'no_charge'
  | 'refund_pending'
  | 'canceled_settled';

/** Estados en los que el saldo se considera "por cobrar". */
export const COLLECTIBLE_STATUSES: readonly OrderStatus[] = ['confirmed', 'preparing', 'delivered'];
/** Estados que pueden recibir pagos. */
export const PAYABLE_STATUSES = COLLECTIBLE_STATUSES;

export interface LineInput {
  quantity: number;
  unitPriceCents: number;
}

export interface OrderTotals {
  subtotalCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  totalCents: number;
}

export type TotalsResult = { ok: true; totals: OrderTotals } | { ok: false; error: string };

export function lineTotal(line: LineInput): number {
  return line.quantity * line.unitPriceCents;
}

/**
 * item_subtotal = sum(quantity * unit_price)
 * order_total   = item_subtotal - flat_discount + delivery_fee
 */
export function computeOrderTotals(lines: LineInput[], discountCents: number, deliveryFeeCents: number): TotalsResult {
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      return { ok: false, error: 'La cantidad debe ser un número entero mayor a cero.' };
    }
    if (!Number.isInteger(line.unitPriceCents) || line.unitPriceCents < 0) {
      return { ok: false, error: 'El precio no puede ser negativo.' };
    }
  }
  if (!Number.isInteger(discountCents) || discountCents < 0) {
    return { ok: false, error: 'El descuento no puede ser negativo.' };
  }
  if (!Number.isInteger(deliveryFeeCents) || deliveryFeeCents < 0) {
    return { ok: false, error: 'El costo de envío no puede ser negativo.' };
  }
  const subtotalCents = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  if (discountCents > subtotalCents) {
    return { ok: false, error: 'El descuento no puede superar el subtotal de los productos.' };
  }
  return {
    ok: true,
    totals: {
      subtotalCents,
      discountCents,
      deliveryFeeCents,
      totalCents: subtotalCents - discountCents + deliveryFeeCents,
    },
  };
}

export interface MoneyEntry {
  amountCents: number;
  voidedAt?: string | null;
}

/** Suma solo los registros no anulados. */
export function sumValid(entries: MoneyEntry[]): number {
  return entries.reduce((sum, e) => (e.voidedAt ? sum : sum + e.amountCents), 0);
}

export interface BalanceInput {
  status: OrderStatus;
  totalCents: number;
  paidCents: number; // pagos válidos
  refundedCents: number; // reembolsos válidos
}

export interface Balance {
  netPaidCents: number;
  balanceDueCents: number;
  refundDueCents: number;
  paymentState: PaymentState;
}

export function computeBalance({ status, totalCents, paidCents, refundedCents }: BalanceInput): Balance {
  const netPaidCents = paidCents - refundedCents;
  if (status === 'canceled') {
    return {
      netPaidCents,
      balanceDueCents: 0,
      refundDueCents: Math.max(netPaidCents, 0),
      paymentState: netPaidCents > 0 ? 'refund_pending' : 'canceled_settled',
    };
  }
  let paymentState: PaymentState;
  if (totalCents === 0) paymentState = 'no_charge';
  else if (netPaidCents >= totalCents) paymentState = 'paid';
  else if (netPaidCents > 0) paymentState = 'partial';
  else paymentState = 'pending';
  return {
    netPaidCents,
    balanceDueCents: Math.max(totalCents - netPaidCents, 0),
    refundDueCents: 0,
    paymentState,
  };
}

export function isCollectible(status: OrderStatus): boolean {
  return COLLECTIBLE_STATUSES.includes(status);
}

/** Validación previa al envío (la base de datos vuelve a validar con el pedido bloqueado). */
export function validatePaymentAmount(
  amountCents: number,
  order: { status: OrderStatus; totalCents: number; balanceDueCents: number },
): string | null {
  if (order.status === 'canceled') return 'No se pueden registrar pagos en un pedido cancelado.';
  if (!PAYABLE_STATUSES.includes(order.status)) return 'Confirmá el pedido antes de registrar un pago.';
  if (order.totalCents === 0) return 'Este pedido no tiene monto por cobrar.';
  if (amountCents <= 0) return 'El monto debe ser mayor a cero.';
  if (amountCents > order.balanceDueCents) return 'El pago supera el saldo pendiente de este pedido.';
  return null;
}

export interface CashTotals {
  paymentsCents: number;
  refundsCents: number;
  expensesCents: number;
}

/** Movimiento neto registrado = pagos - reembolsos - gastos. No es ganancia ni saldo bancario. */
export function netRecordedMovement(t: CashTotals): number {
  return t.paymentsCents - t.refundsCents - t.expensesCents;
}
