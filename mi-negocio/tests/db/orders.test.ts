import { afterAll, describe, expect, it } from 'vitest';
import { computeBalance, type OrderStatus } from '@/lib/money/order-math';
import {
  asUser,
  createOwner,
  createProduct,
  errorOf,
  orderInput,
  orderSummary,
  pool,
  query,
  randomUUID,
  rpc,
  variantStock,
} from './helpers';

afterAll(async () => {
  await pool.end();
});

describe('escenario A: pago parcial y entrega', () => {
  it('sigue la aritmética exacta y el stock esperado', async () => {
    const { user } = await createOwner('a');
    const { variantId } = await createProduct(user, { stock: 10 });

    const orderId = await rpc<string>(user, 'create_order', [orderInput(variantId), false, null, randomUUID()]);
    let s = await orderSummary(user, orderId);
    expect(s).toMatchObject({ status: 'new', total_cents: 17500, balance_due_cents: 17500 });
    expect(await variantStock(user, variantId)).toEqual({ on_hand: 10, reserved: 0, available: 10 });

    await rpc(user, 'confirm_order', [orderId, s!.revision]);
    expect(await variantStock(user, variantId)).toEqual({ on_hand: 10, reserved: 2, available: 8 });

    const key1 = randomUUID();
    await rpc(user, 'record_payment', [orderId, 5000, 'qr', null, null, null, null, key1]);
    s = await orderSummary(user, orderId);
    expect(s).toMatchObject({ payment_state: 'partial', balance_due_cents: 12500 });

    await rpc(user, 'mark_order_delivered', [orderId, null]);
    expect(await variantStock(user, variantId)).toEqual({ on_hand: 8, reserved: 0, available: 8 });

    const key2 = randomUUID();
    await rpc(user, 'record_payment', [orderId, 12500, 'cash', null, null, null, null, key2]);
    s = await orderSummary(user, orderId);
    expect(s).toMatchObject({ payment_state: 'paid', balance_due_cents: 0, net_paid_cents: 17500 });

    // Repetir con la misma clave no crea otro pago.
    const again = await rpc<string>(user, 'record_payment', [orderId, 12500, 'cash', null, null, null, null, key2]);
    const payments = await query<{ id: string }>(user, 'select id from public.payments where order_id = $1', [orderId]);
    expect(payments).toHaveLength(2);
    expect(payments.map((p) => p.id)).toContain(again);

    // Entregar de nuevo es idempotente y no descuenta otra vez.
    await rpc(user, 'mark_order_delivered', [orderId, null]);
    expect(await variantStock(user, variantId)).toEqual({ on_hand: 8, reserved: 0, available: 8 });
  });
});

describe('escenario B: cancelación antes de la entrega', () => {
  it('libera reservas, deja reembolso pendiente y lo salda', async () => {
    const { user } = await createOwner('b');
    const { variantId } = await createProduct(user, { stock: 10 });
    const orderId = await rpc<string>(user, 'create_order', [
      orderInput(variantId),
      true,
      { amount_cents: 5000, method: 'qr' },
      randomUUID(),
    ]);
    expect(await variantStock(user, variantId)).toEqual({ on_hand: 10, reserved: 2, available: 8 });

    expect(await errorOf(rpc(user, 'cancel_order', [orderId, null, '  ', null]))).toBe('reason_required');
    await rpc(user, 'cancel_order', [orderId, null, 'El cliente ya no lo quiere', null]);
    expect(await variantStock(user, variantId)).toEqual({ on_hand: 10, reserved: 0, available: 10 });
    let s = await orderSummary(user, orderId);
    expect(s).toMatchObject({ status: 'canceled', balance_due_cents: 0, refund_due_cents: 5000, payment_state: 'refund_pending' });

    // No se aceptan pagos en cancelados.
    expect(await errorOf(rpc(user, 'record_payment', [orderId, 100, 'cash', null, null, null, null, randomUUID()]))).toBe(
      'order_canceled',
    );

    const [payment] = await query<{ id: string }>(user, 'select id from public.payments where order_id = $1', [orderId]);
    // No se puede reembolsar más de lo pagado.
    expect(await errorOf(rpc(user, 'record_refund', [payment.id, 5001, 'qr', null, 'Devolución', randomUUID()]))).toBe(
      'refund_exceeds_payment',
    );
    const refundKey = randomUUID();
    await rpc(user, 'record_refund', [payment.id, 3000, 'qr', null, 'Devolución parcial', refundKey]);
    await rpc(user, 'record_refund', [payment.id, 3000, 'qr', null, 'Devolución parcial', refundKey]); // idempotente
    s = await orderSummary(user, orderId);
    expect(s!.refund_due_cents).toBe(2000);
    await rpc(user, 'record_refund', [payment.id, 2000, 'cash', null, 'Resto', randomUUID()]);
    s = await orderSummary(user, orderId);
    expect(s).toMatchObject({ refund_due_cents: 0, payment_state: 'canceled_settled', total_cents: 17500 });

    // El pago con reembolsos no se puede anular.
    expect(await errorOf(rpc(user, 'void_payment', [payment.id, 'error']))).toBe('payment_has_refunds');
    // Anular un reembolso equivocado restaura el saldo a reembolsar.
    const [refund] = await query<{ id: string }>(
      user,
      'select id from public.refunds where order_id = $1 and amount_cents = 2000',
      [orderId],
    );
    await rpc(user, 'void_refund', [refund.id, 'Lo cargué dos veces']);
    s = await orderSummary(user, orderId);
    expect(s!.refund_due_cents).toBe(2000);
    const history = await query(user, 'select * from public.refunds where order_id = $1', [orderId]);
    expect(history).toHaveLength(2); // 3000 (repetido una vez) + 2000 anulado, que sigue visible
    expect(history.filter((r) => (r as { voided_at: string | null }).voided_at)).toHaveLength(1);
  });

  it('cancelar un pedido nuevo no toca el stock', async () => {
    const { user } = await createOwner('b2');
    const { variantId } = await createProduct(user, { stock: 3 });
    const orderId = await rpc<string>(user, 'create_order', [orderInput(variantId), false, null, randomUUID()]);
    await rpc(user, 'cancel_order', [orderId, null, 'Duplicado', null]);
    expect(await variantStock(user, variantId)).toEqual({ on_hand: 3, reserved: 0, available: 3 });
    expect(await errorOf(rpc(user, 'confirm_order', [orderId, null]))).toBe('invalid_transition');
  });
});

describe('escenario C: cancelación después de la entrega', () => {
  it('con devolución repone una sola vez; sin devolución no repone', async () => {
    const { user } = await createOwner('c');
    const { variantId } = await createProduct(user, { stock: 10 });

    const withReturn = await rpc<string>(user, 'create_order', [orderInput(variantId), true, null, randomUUID()]);
    await rpc(user, 'mark_order_delivered', [withReturn, null]);
    expect(await variantStock(user, variantId)).toEqual({ on_hand: 8, reserved: 0, available: 8 });

    expect(await errorOf(rpc(user, 'cancel_order', [withReturn, null, 'Devolución', null]))).toBe('return_decision_required');
    await rpc(user, 'cancel_order', [withReturn, null, 'Devolución', true]);
    await rpc(user, 'cancel_order', [withReturn, null, 'Devolución', true]); // repetición
    expect(await variantStock(user, variantId)).toEqual({ on_hand: 10, reserved: 0, available: 10 });

    // Pedidos concurrentes de la misma cancelación tampoco reponen dos veces.
    const raced = await rpc<string>(user, 'create_order', [orderInput(variantId), true, null, randomUUID()]);
    await rpc(user, 'mark_order_delivered', [raced, null]);
    await Promise.all([
      rpc(user, 'cancel_order', [raced, null, 'Devolución', true]),
      rpc(user, 'cancel_order', [raced, null, 'Devolución', true]),
    ]);
    expect(await variantStock(user, variantId)).toEqual({ on_hand: 10, reserved: 0, available: 10 });

    const noReturn = await rpc<string>(user, 'create_order', [orderInput(variantId), true, null, randomUUID()]);
    await rpc(user, 'mark_order_delivered', [noReturn, null]);
    await rpc(user, 'cancel_order', [noReturn, null, 'Llegó dañado', false]);
    expect(await variantStock(user, variantId)).toEqual({ on_hand: 8, reserved: 0, available: 8 });

    const moves = await query<{ movement_type: string }>(
      user,
      `select movement_type from public.inventory_movements where order_id = $1 order by created_at`,
      [withReturn],
    );
    expect(moves.map((m) => m.movement_type)).toEqual(['reserve', 'deliver', 'return']);
  });
});

describe('escenario E: carrera por la última unidad', () => {
  it('solo una confirmación tiene éxito', async () => {
    const { user } = await createOwner('e');
    const { variantId } = await createProduct(user, { stock: 1 });
    const one = { items: [{ variant_id: variantId, quantity: 1, unit_price_cents: 8000 }] };
    const o1 = await rpc<string>(user, 'create_order', [orderInput(variantId, one), false, null, randomUUID()]);
    const o2 = await rpc<string>(user, 'create_order', [orderInput(variantId, one), false, null, randomUUID()]);

    const results = await Promise.allSettled([rpc(user, 'confirm_order', [o1, null]), rpc(user, 'confirm_order', [o2, null])]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason.message).toBe('insufficient_stock');

    expect(await variantStock(user, variantId)).toEqual({ on_hand: 1, reserved: 1, available: 0 });
    const statuses = [(await orderSummary(user, o1))!.status, (await orderSummary(user, o2))!.status].sort();
    expect(statuses).toEqual(['confirmed', 'new']);
  });
});

describe('escenario F: carrera de pagos', () => {
  it('dos pagos de Bs 80 sobre saldo de Bs 100: solo uno entra', async () => {
    const { user } = await createOwner('f');
    const { variantId } = await createProduct(user, { stock: 5 });
    const orderId = await rpc<string>(user, 'create_order', [
      orderInput(variantId, { items: [{ variant_id: variantId, quantity: 1, unit_price_cents: 10000 }], delivery_fee_cents: 0 }),
      true,
      null,
      randomUUID(),
    ]);
    const results = await Promise.allSettled([
      rpc(user, 'record_payment', [orderId, 8000, 'cash', null, null, null, null, randomUUID()]),
      rpc(user, 'record_payment', [orderId, 8000, 'qr', null, null, null, null, randomUUID()]),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.message).toBe('payment_exceeds_balance');
    const s = await orderSummary(user, orderId);
    expect(s!.net_paid_cents).toBe(8000);
  });

  it('misma clave enviada en paralelo crea un único pago', async () => {
    const { user } = await createOwner('f2');
    const { variantId } = await createProduct(user, { stock: 5 });
    const orderId = await rpc<string>(user, 'create_order', [orderInput(variantId), true, null, randomUUID()]);
    const key = randomUUID();
    const ids = await Promise.all(
      [1, 2, 3].map(() => rpc<string>(user, 'record_payment', [orderId, 1000, 'cash', null, null, null, null, key])),
    );
    expect(new Set(ids).size).toBe(1);
    const rows = await query(user, 'select id from public.payments where order_id = $1', [orderId]);
    expect(rows).toHaveLength(1);
  });
});

describe('reglas de pagos', () => {
  it('rechaza pagos en pedidos nuevos, de total cero, futuros, cero o negativos', async () => {
    const { user } = await createOwner('p');
    const { variantId } = await createProduct(user, { stock: 5 });
    const newOrder = await rpc<string>(user, 'create_order', [orderInput(variantId), false, null, randomUUID()]);
    expect(await errorOf(rpc(user, 'record_payment', [newOrder, 100, 'cash', null, null, null, null, randomUUID()]))).toBe(
      'order_not_confirmed',
    );

    const zero = await rpc<string>(user, 'create_order', [
      orderInput(variantId, { discount_cents: 16000, delivery_fee_cents: 0 }),
      true,
      null,
      randomUUID(),
    ]);
    expect((await orderSummary(user, zero))!.payment_state).toBe('no_charge');
    expect(await errorOf(rpc(user, 'record_payment', [zero, 100, 'cash', null, null, null, null, randomUUID()]))).toBe(
      'order_has_no_charge',
    );

    const confirmed = await rpc<string>(user, 'create_order', [orderInput(variantId), true, null, randomUUID()]);
    const future = new Date(Date.now() + 3600_000).toISOString();
    expect(await errorOf(rpc(user, 'record_payment', [confirmed, 100, 'cash', future, null, null, null, randomUUID()]))).toBe(
      'future_date',
    );
    expect(await errorOf(rpc(user, 'record_payment', [confirmed, 0, 'cash', null, null, null, null, randomUUID()]))).toBe(
      'invalid_amount',
    );
    expect(await errorOf(rpc(user, 'record_payment', [confirmed, -5, 'cash', null, null, null, null, randomUUID()]))).toBe(
      'invalid_amount',
    );
    expect(await errorOf(rpc(user, 'record_payment', [confirmed, 17501, 'cash', null, null, null, null, randomUUID()]))).toBe(
      'payment_exceeds_balance',
    );
    // Refund only on canceled orders
    const pid = await rpc<string>(user, 'record_payment', [confirmed, 1000, 'cash', null, null, null, null, randomUUID()]);
    expect(await errorOf(rpc(user, 'record_refund', [pid, 500, 'cash', null, 'x', randomUUID()]))).toBe(
      'refund_requires_cancellation',
    );
    // Anular un pago requiere motivo y deja el registro visible.
    expect(await errorOf(rpc(user, 'void_payment', [pid, '']))).toBe('reason_required');
    await rpc(user, 'void_payment', [pid, 'Monto equivocado']);
    const [row] = await query<{ voided_at: string; void_reason: string }>(user, 'select * from public.payments where id = $1', [pid]);
    expect(row.void_reason).toBe('Monto equivocado');
    expect((await orderSummary(user, confirmed))!.net_paid_cents).toBe(0);
  });

  it('la transacción se revierte si falla el pago al crear y confirmar', async () => {
    const { user } = await createOwner('rb');
    const { variantId } = await createProduct(user, { stock: 5 });
    const key = randomUUID();
    const code = await errorOf(
      rpc(user, 'create_order', [orderInput(variantId), true, { amount_cents: 999999, method: 'cash' }, key]),
    );
    expect(code).toBe('payment_exceeds_balance');
    expect(await query(user, 'select id from public.orders')).toHaveLength(0);
    expect(await variantStock(user, variantId)).toEqual({ on_hand: 5, reserved: 0, available: 5 });
    // El contador no deja huecos visibles porque también se revierte.
    const id = await rpc<string>(user, 'create_order', [orderInput(variantId), true, { amount_cents: 1000, method: 'cash' }, key]);
    const [o] = await query<{ code: string }>(user, 'select code from public.orders where id = $1', [id]);
    expect(o.code).toBe('PED-000001');
  });

  it('crear con la misma clave es idempotente y los números son correlativos', async () => {
    const { user } = await createOwner('n');
    const { variantId } = await createProduct(user, { stock: 50 });
    const key = randomUUID();
    const a = await rpc<string>(user, 'create_order', [orderInput(variantId), false, null, key]);
    const b = await rpc<string>(user, 'create_order', [orderInput(variantId), false, null, key]);
    expect(a).toBe(b);
    await Promise.all([1, 2, 3, 4].map(() => rpc(user, 'create_order', [orderInput(variantId), false, null, randomUUID()])));
    const codes = (await query<{ code: string }>(user, 'select code from public.orders order by number')).map((r) => r.code);
    expect(codes).toEqual(['PED-000001', 'PED-000002', 'PED-000003', 'PED-000004', 'PED-000005']);
  });
});

describe('edición y concurrencia optimista', () => {
  it('rechaza revisiones viejas y congela montos tras confirmar', async () => {
    const { user } = await createOwner('o');
    const { variantId } = await createProduct(user, { stock: 5 });
    const orderId = await rpc<string>(user, 'create_order', [orderInput(variantId), false, null, randomUUID()]);
    const rev = (await orderSummary(user, orderId))!.revision;
    await rpc(user, 'update_order_draft', [orderId, rev, orderInput(variantId, { discount_cents: 1000 })]);
    expect((await orderSummary(user, orderId))!.total_cents).toBe(16500);
    expect(await errorOf(rpc(user, 'update_order_draft', [orderId, rev, orderInput(variantId)]))).toBe('stale_order');
    expect(await errorOf(rpc(user, 'confirm_order', [orderId, rev]))).toBe('stale_order');

    await rpc(user, 'confirm_order', [orderId, rev + 1]);
    expect(await errorOf(rpc(user, 'update_order_draft', [orderId, rev + 2, orderInput(variantId)]))).toBe('order_not_editable');
    // Se puede actualizar la logística.
    await rpc(user, 'update_order_logistics', [orderId, rev + 2, { fulfillment_type: 'pickup', notes: 'Llamar antes' }]);
    const [o] = await query<{ fulfillment_type: string; total_cents: string }>(user, 'select * from public.orders where id = $1', [
      orderId,
    ]);
    expect(o.fulfillment_type).toBe('pickup');
    expect(Number(o.total_cents)).toBe(16500);
  });

  it('cambiar el producto no reescribe la instantánea del pedido', async () => {
    const { user } = await createOwner('snap');
    const { productId, variantId } = await createProduct(user, { stock: 5, name: 'Gorra' });
    const orderId = await rpc<string>(user, 'create_order', [orderInput(variantId), true, null, randomUUID()]);
    await rpc(user, 'save_product', [
      { id: productId, name: 'Gorra nueva', variants: [{ id: variantId, size: 'L', color: 'Roja', price_cents: 99900 }] },
    ]);
    const [item] = await query<{ product_name: string; variant_label: string; unit_price_cents: string }>(
      user,
      'select * from public.order_items where order_id = $1',
      [orderId],
    );
    expect(item).toMatchObject({ product_name: 'Gorra', variant_label: 'M / Negra' });
    expect(Number(item.unit_price_cents)).toBe(8000);
  });
});

describe('inventario', () => {
  it('ajustes con motivo, sin bajar de lo reservado; seguimiento no desactivable con reservas', async () => {
    const { user } = await createOwner('inv');
    const { productId, variantId } = await createProduct(user, { stock: 3 });
    await rpc(user, 'create_order', [orderInput(variantId), true, null, randomUUID()]); // reserva 2
    expect(await errorOf(rpc(user, 'adjust_stock', [variantId, -2, 'Conteo', randomUUID()]))).toBe('adjustment_below_reserved');
    expect(await errorOf(rpc(user, 'adjust_stock', [variantId, 1, '', randomUUID()]))).toBe('reason_required');
    const key = randomUUID();
    await rpc(user, 'adjust_stock', [variantId, 5, 'Llegó mercadería', key]);
    await rpc(user, 'adjust_stock', [variantId, 5, 'Llegó mercadería', key]); // idempotente
    expect(await variantStock(user, variantId)).toEqual({ on_hand: 8, reserved: 2, available: 6 });
    expect(
      await errorOf(
        rpc(user, 'save_product', [
          { id: productId, name: 'Polera', variants: [{ id: variantId, size: 'M', color: 'Negra', price_cents: 8000, track_inventory: false }] },
        ]),
      ),
    ).toBe('tracking_has_reservations');
  });

  it('las restricciones impiden valores inválidos aun con acceso directo', async () => {
    const { user, businessId } = await createOwner('chk');
    const { productId, variantId } = await createProduct(user, { stock: 1 });
    const bad = [
      `update public.product_variants set reserved = 5 where id = '${variantId}'`,
      `update public.product_variants set on_hand = -1 where id = '${variantId}'`,
      `update public.product_variants set price_cents = -1 where id = '${variantId}'`,
      `insert into public.product_variants (business_id, product_id, price_cents, track_inventory, reserved) values ('${businessId}', '${productId}', 100, false, 1)`,
    ];
    for (const sql of bad) {
      expect(await errorOf(pool.query(sql))).toBe('23514');
    }
    // Variantes duplicadas por talla/color y SKU duplicado.
    expect(
      await errorOf(
        rpc(user, 'save_product', [
          { name: 'Dup', variants: [{ size: 'M', color: 'Azul', price_cents: 1 }, { size: 'm', color: 'azul', price_cents: 1 }] },
        ]),
      ),
    ).toBe('23505');
    await rpc(user, 'save_product', [{ name: 'S1', variants: [{ sku: 'ABC-1', price_cents: 1 }] }]);
    expect(await errorOf(rpc(user, 'save_product', [{ name: 'S2', variants: [{ sku: 'abc-1', price_cents: 1 }] }]))).toBe('23505');
  });
});

describe('paridad de reglas financieras SQL vs TypeScript', () => {
  it('order_summaries coincide con computeBalance', async () => {
    const { user } = await createOwner('parity');
    const { variantId } = await createProduct(user, { stock: 100 });
    const ids: string[] = [];
    ids.push(await rpc<string>(user, 'create_order', [orderInput(variantId), false, null, randomUUID()]));
    ids.push(await rpc<string>(user, 'create_order', [orderInput(variantId), true, null, randomUUID()]));
    ids.push(await rpc<string>(user, 'create_order', [orderInput(variantId), true, { amount_cents: 100, method: 'cash' }, randomUUID()]));
    ids.push(await rpc<string>(user, 'create_order', [orderInput(variantId), true, { amount_cents: 17500, method: 'qr' }, randomUUID()]));
    ids.push(
      await rpc<string>(user, 'create_order', [orderInput(variantId, { discount_cents: 16000, delivery_fee_cents: 0 }), true, null, randomUUID()]),
    );
    const c = await rpc<string>(user, 'create_order', [orderInput(variantId), true, { amount_cents: 4000, method: 'qr' }, randomUUID()]);
    await rpc(user, 'cancel_order', [c, null, 'x', null]);
    ids.push(c);

    const rows = await query<{
      status: OrderStatus;
      total_cents: string;
      paid_cents: string;
      refunded_cents: string;
      balance_due_cents: string;
      refund_due_cents: string;
      net_paid_cents: string;
      payment_state: string;
    }>(user, 'select * from public.order_summaries where id = any($1)', [ids]);
    expect(rows).toHaveLength(ids.length);
    for (const r of rows) {
      const ts = computeBalance({
        status: r.status,
        totalCents: Number(r.total_cents),
        paidCents: Number(r.paid_cents),
        refundedCents: Number(r.refunded_cents),
      });
      expect({
        netPaidCents: Number(r.net_paid_cents),
        balanceDueCents: Number(r.balance_due_cents),
        refundDueCents: Number(r.refund_due_cents),
        paymentState: r.payment_state,
      }).toEqual(ts);
    }
  });
});

describe('escenario D: totales de caja de un día local', () => {
  it('300 cobrado, 50 reembolsado, 40 gastos -> 210 neto; excluye anulados', async () => {
    const { user } = await createOwner('cash');
    const { variantId } = await createProduct(user, { stock: 100 });
    const at = '2026-10-01T15:00:00Z'; // 11:00 en La Paz
    const big = { items: [{ variant_id: variantId, quantity: 1, unit_price_cents: 30000 }], delivery_fee_cents: 0 };
    const o1 = await rpc<string>(user, 'create_order', [orderInput(variantId, big), true, null, randomUUID()]);
    await rpc(user, 'record_payment', [o1, 25000, 'qr', at, null, null, null, randomUUID()]);
    const o2 = await rpc<string>(user, 'create_order', [orderInput(variantId, big), true, null, randomUUID()]);
    const p2 = await rpc<string>(user, 'record_payment', [o2, 5000, 'cash', at, null, null, null, randomUUID()]);
    await rpc(user, 'cancel_order', [o2, null, 'Cancelado', null]);
    await rpc(user, 'record_refund', [p2, 5000, 'cash', at, 'Devolución', randomUUID()]);
    await rpc(user, 'record_expense', [4000, 'transport', 'cash', at, 'Moto', null, randomUUID()]);
    const voided = await rpc<string>(user, 'record_expense', [9900, 'other', 'cash', at, 'Error', null, randomUUID()]);
    await rpc(user, 'void_expense', [voided, 'Cargado por error']);
    // Un pago a las 23:30 del día anterior (hora local) no cuenta.
    await rpc(user, 'record_payment', [o1, 100, 'cash', '2026-10-01T03:30:00Z', null, null, null, randomUUID()]);

    const summary = await rpc<{ payments_cents: number; refunds_cents: number; expenses_cents: number }>(user, 'cash_summary', [
      '2026-10-01T04:00:00Z',
      '2026-10-02T04:00:00Z',
    ]);
    expect(summary).toMatchObject({ payments_cents: 30000, refunds_cents: 5000, expenses_cents: 4000 });
    expect(summary.payments_cents - summary.refunds_cents - summary.expenses_cents).toBe(21000);
    const entries = await query(user, `select * from public.cash_entries('2026-10-01T04:00:00Z', '2026-10-02T04:00:00Z', 50, 0)`);
    expect(entries).toHaveLength(5); // incluye el gasto anulado, marcado
  });

  it('corregir un gasto anula el original y crea el reemplazo', async () => {
    const { user } = await createOwner('exp');
    const id = await rpc<string>(user, 'record_expense', [1000, 'rent', 'cash', null, 'Alquiler', null, randomUUID()]);
    const newId = await rpc<string>(user, 'correct_expense', [id, 'Monto mal', 1500, 'rent', 'cash', null, 'Alquiler', randomUUID()]);
    const rows = await query<{ id: string; voided_at: string | null; replaces_expense_id: string | null }>(
      user,
      'select id, voided_at, replaces_expense_id from public.expenses order by created_at',
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === id)!.voided_at).not.toBeNull();
    expect(rows.find((r) => r.id === newId)!.replaces_expense_id).toBe(id);
  });
});

describe('onboarding', () => {
  it('crear negocio es idempotente y atómico', async () => {
    const { user, businessId } = await createOwner('onb');
    const again = await rpc<string>(user, 'create_business', ['Otro', 'Yo', null, null, null]);
    expect(again).toBe(businessId);
    const members = await asUser(user, async (c) => (await c.query('select * from public.business_members')).rows);
    expect(members).toHaveLength(1);
  });
});
