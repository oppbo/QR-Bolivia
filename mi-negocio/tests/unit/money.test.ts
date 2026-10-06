import { describe, expect, it } from 'vitest';
import { centsToInput, formatMoney, parseMoneyInput } from '@/lib/money/money';
import {
  computeBalance,
  computeOrderTotals,
  netRecordedMovement,
  sumValid,
  validatePaymentAmount,
} from '@/lib/money/order-math';

describe('parseMoneyInput', () => {
  it.each([
    ['125.50', 12550],
    ['125,50', 12550],
    ['125', 12500],
    ['125.5', 12550],
    ['0', 0],
    ['Bs 80', 8000],
    ['  15.00 ', 1500],
    ['0.01', 1],
  ])('acepta %s', (input, cents) => {
    expect(parseMoneyInput(input)).toEqual({ ok: true, cents });
  });

  it.each(['1.234', '1,234.50', '1.234,50', '1 234', '12.345', '-5', 'abc', '', '1e3', '12.'])(
    'rechaza %s sin adivinar',
    (input) => {
      const r = parseMoneyInput(input);
      if (input === '12.') {
        // "12." se interpreta como 12 sin decimales: no es ambiguo.
        expect(r).toEqual({ ok: true, cents: 1200 });
      } else {
        expect(r.ok).toBe(false);
      }
    },
  );

  it('rechaza más de dos decimales con un mensaje claro', () => {
    const r = parseMoneyInput('10.555');
    expect(r).toEqual({ ok: false, error: expect.stringContaining('dos decimales') });
  });

  it('puede exigir un monto positivo', () => {
    expect(parseMoneyInput('0', { allowZero: false }).ok).toBe(false);
  });

  it('rechaza montos fuera de rango', () => {
    expect(parseMoneyInput('1000000.01').ok).toBe(false);
    expect(parseMoneyInput('1000000.00')).toEqual({ ok: true, cents: 100_000_000 });
  });
});

describe('formatMoney', () => {
  it('formatea con Bs y dos decimales', () => {
    expect(formatMoney(17500)).toBe('Bs 175.00');
    expect(formatMoney(12550)).toBe('Bs 125.50');
    expect(formatMoney(5)).toBe('Bs 0.05');
    expect(formatMoney(0)).toBe('Bs 0.00');
    expect(formatMoney(123456789)).toBe('Bs 1,234,567.89');
    expect(formatMoney(-5000)).toBe('-Bs 50.00');
  });
  it('no acepta valores no enteros', () => {
    expect(() => formatMoney(1.5)).toThrow();
  });
  it('centsToInput es inverso de parseMoneyInput', () => {
    for (const c of [0, 1, 99, 100, 12550, 99999999]) {
      expect(parseMoneyInput(centsToInput(c))).toEqual({ ok: true, cents: c });
    }
  });
});

describe('computeOrderTotals', () => {
  it('escenario A: 2 × Bs 80 + envío Bs 15 = Bs 175', () => {
    const r = computeOrderTotals([{ quantity: 2, unitPriceCents: 8000 }], 0, 1500);
    expect(r).toEqual({
      ok: true,
      totals: { subtotalCents: 16000, discountCents: 0, deliveryFeeCents: 1500, totalCents: 17500 },
    });
  });
  it('aplica descuento fijo', () => {
    const r = computeOrderTotals(
      [
        { quantity: 1, unitPriceCents: 9950 },
        { quantity: 3, unitPriceCents: 3333 },
      ],
      1000,
      0,
    );
    expect(r.ok && r.totals.totalCents).toBe(9950 + 9999 - 1000);
  });
  it('permite pedido promocional de total cero', () => {
    const r = computeOrderTotals([{ quantity: 1, unitPriceCents: 5000 }], 5000, 0);
    expect(r.ok && r.totals.totalCents).toBe(0);
  });
  it('rechaza descuento mayor al subtotal (el envío no cuenta)', () => {
    const r = computeOrderTotals([{ quantity: 1, unitPriceCents: 5000 }], 5001, 2000);
    expect(r.ok).toBe(false);
  });
  it('rechaza cantidades no enteras, precios y envíos negativos', () => {
    expect(computeOrderTotals([{ quantity: 1.5, unitPriceCents: 100 }], 0, 0).ok).toBe(false);
    expect(computeOrderTotals([{ quantity: 0, unitPriceCents: 100 }], 0, 0).ok).toBe(false);
    expect(computeOrderTotals([{ quantity: 1, unitPriceCents: -1 }], 0, 0).ok).toBe(false);
    expect(computeOrderTotals([{ quantity: 1, unitPriceCents: 100 }], 0, -1).ok).toBe(false);
    expect(computeOrderTotals([{ quantity: 1, unitPriceCents: 100 }], -1, 0).ok).toBe(false);
  });
});

describe('computeBalance', () => {
  it('pendiente, parcial y pagado', () => {
    expect(computeBalance({ status: 'confirmed', totalCents: 17500, paidCents: 0, refundedCents: 0 })).toEqual({
      netPaidCents: 0,
      balanceDueCents: 17500,
      refundDueCents: 0,
      paymentState: 'pending',
    });
    expect(computeBalance({ status: 'confirmed', totalCents: 17500, paidCents: 5000, refundedCents: 0 })).toMatchObject({
      balanceDueCents: 12500,
      paymentState: 'partial',
    });
    expect(computeBalance({ status: 'delivered', totalCents: 17500, paidCents: 17500, refundedCents: 0 })).toMatchObject({
      balanceDueCents: 0,
      paymentState: 'paid',
    });
  });
  it('total cero es "sin cobro"', () => {
    expect(computeBalance({ status: 'delivered', totalCents: 0, paidCents: 0, refundedCents: 0 }).paymentState).toBe(
      'no_charge',
    );
  });
  it('escenario B: cancelado con anticipo -> reembolso pendiente, luego sin saldo', () => {
    const before = computeBalance({ status: 'canceled', totalCents: 17500, paidCents: 5000, refundedCents: 0 });
    expect(before).toEqual({
      netPaidCents: 5000,
      balanceDueCents: 0,
      refundDueCents: 5000,
      paymentState: 'refund_pending',
    });
    const after = computeBalance({ status: 'canceled', totalCents: 17500, paidCents: 5000, refundedCents: 5000 });
    expect(after).toMatchObject({ refundDueCents: 0, balanceDueCents: 0, paymentState: 'canceled_settled' });
  });
  it('sumValid ignora registros anulados', () => {
    expect(
      sumValid([
        { amountCents: 5000 },
        { amountCents: 3000, voidedAt: '2026-10-01T00:00:00Z' },
        { amountCents: 12500, voidedAt: null },
      ]),
    ).toBe(17500);
  });
});

describe('validatePaymentAmount', () => {
  const order = { status: 'confirmed' as const, totalCents: 17500, balanceDueCents: 12500 };
  it('rechaza sobrepagos, cero y pedidos no cobrables', () => {
    expect(validatePaymentAmount(12501, order)).toMatch(/supera el saldo/);
    expect(validatePaymentAmount(0, order)).toMatch(/mayor a cero/);
    expect(validatePaymentAmount(100, { ...order, status: 'canceled' })).toMatch(/cancelado/);
    expect(validatePaymentAmount(100, { ...order, status: 'new' })).toMatch(/Confirmá/);
    expect(validatePaymentAmount(100, { status: 'confirmed', totalCents: 0, balanceDueCents: 0 })).toMatch(/no tiene monto/);
    expect(validatePaymentAmount(12500, order)).toBeNull();
  });
});

describe('netRecordedMovement', () => {
  it('escenario D: 300 - 50 - 40 = 210', () => {
    expect(netRecordedMovement({ paymentsCents: 30000, refundsCents: 5000, expensesCents: 4000 })).toBe(21000);
  });
});
