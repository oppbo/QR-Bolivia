import { describe, expect, it } from 'vitest';
import {
  addDays,
  formatDate,
  formatDateTime,
  fromLocalInputValue,
  isDateString,
  localDayBounds,
  localRangeBounds,
  todayInTimezone,
  toLocalInputValue,
} from '@/lib/dates';
import { canTransition, primaryAction, TRANSITIONS } from '@/lib/orders/lifecycle';
import { formatPhone, normalizePhone } from '@/lib/phone';
import { buildOrderSummary, buildPaymentReminder, whatsappUrl, type ShareOrder } from '@/lib/whatsapp';

describe('fechas en America/La_Paz (UTC-4)', () => {
  it('el día local cambia a las 04:00 UTC, no a medianoche UTC', () => {
    expect(todayInTimezone('America/La_Paz', new Date('2026-10-15T03:59:59Z'))).toBe('2026-10-14');
    expect(todayInTimezone('America/La_Paz', new Date('2026-10-15T04:00:00Z'))).toBe('2026-10-15');
  });
  it('límites de un día local', () => {
    const { start, end } = localDayBounds('2026-10-14', 'America/La_Paz');
    expect(start.toISOString()).toBe('2026-10-14T04:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-15T04:00:00.000Z');
  });
  it('un pago a las 23:30 hora local pertenece a ese día aunque en UTC sea el siguiente', () => {
    const { start, end } = localDayBounds('2026-10-14', 'America/La_Paz');
    const payment = new Date('2026-10-15T03:30:00Z'); // 23:30 del 14 en La Paz
    expect(payment >= start && payment < end).toBe(true);
  });
  it('rangos de varios días y cruce de mes', () => {
    const { start, end } = localRangeBounds('2026-10-30', '2026-11-01', 'America/La_Paz');
    expect(start.toISOString()).toBe('2026-10-30T04:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-02T04:00:00.000Z');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('funciona con zonas con horario de verano', () => {
    const { start, end } = localDayBounds('2026-03-08', 'America/New_York');
    expect(start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });
  it('la fecha prometida se muestra sin desplazamiento de zona', () => {
    expect(formatDate('2026-10-14')).toBe('14/10/2026');
    expect(formatDate(null)).toBe('');
  });
  it('formatea instantes en hora local', () => {
    expect(formatDateTime('2026-10-15T03:30:00Z', 'America/La_Paz')).toBe('14/10/2026 23:30');
  });
  it('convierte datetime-local en ambas direcciones', () => {
    const d = fromLocalInputValue('2026-10-14T23:30', 'America/La_Paz');
    expect(d?.toISOString()).toBe('2026-10-15T03:30:00.000Z');
    expect(toLocalInputValue(d!, 'America/La_Paz')).toBe('2026-10-14T23:30');
    expect(fromLocalInputValue('2026-02-30T10:00', 'America/La_Paz')).toBeNull();
  });
  it('valida fechas de calendario', () => {
    expect(isDateString('2026-02-28')).toBe(true);
    expect(isDateString('2026-02-29')).toBe(false);
    expect(isDateString('14/10/2026')).toBe(false);
  });
});

describe('ciclo de vida del pedido', () => {
  it('transiciones permitidas', () => {
    expect(canTransition('new', 'confirmed')).toBe(true);
    expect(canTransition('new', 'canceled')).toBe(true);
    expect(canTransition('confirmed', 'delivered')).toBe(true);
    expect(canTransition('preparing', 'delivered')).toBe(true);
    expect(canTransition('delivered', 'canceled')).toBe(true);
  });
  it('transiciones prohibidas', () => {
    expect(canTransition('new', 'delivered')).toBe(false);
    expect(canTransition('new', 'preparing')).toBe(false);
    expect(canTransition('preparing', 'confirmed')).toBe(false);
    expect(canTransition('delivered', 'preparing')).toBe(false);
    for (const to of Object.keys(TRANSITIONS)) {
      expect(canTransition('canceled', to as never)).toBe(false);
    }
  });
  it('acción principal según estado', () => {
    expect(primaryAction('new')).toBe('confirm');
    expect(primaryAction('confirmed')).toBe('prepare');
    expect(primaryAction('preparing')).toBe('deliver');
    expect(primaryAction('delivered')).toBeNull();
  });
});

describe('teléfonos', () => {
  it('asume +591 para números locales', () => {
    expect(normalizePhone('71234567')).toEqual({ ok: true, e164: '+59171234567' });
    expect(normalizePhone('712 345 67')).toEqual({ ok: true, e164: '+59171234567' });
    expect(normalizePhone('+591 71234567')).toEqual({ ok: true, e164: '+59171234567' });
    expect(normalizePhone('0059171234567')).toEqual({ ok: true, e164: '+59171234567' });
  });
  it('acepta números internacionales válidos', () => {
    expect(normalizePhone('+54 9 11 2345-6789')).toEqual({ ok: true, e164: '+5491123456789' });
  });
  it('vacío es "sin teléfono"; inválido se rechaza', () => {
    expect(normalizePhone('')).toEqual({ ok: true, e164: null });
    expect(normalizePhone('123').ok).toBe(false);
    expect(normalizePhone('7123abc').ok).toBe(false);
  });
  it('formatea para mostrar', () => {
    expect(formatPhone('+59171234567')).toMatch(/^\+591 /);
  });
});

describe('WhatsApp', () => {
  const order: ShareOrder = {
    code: 'PED-000123',
    customerName: 'Ana',
    fulfillmentType: 'delivery',
    promisedDate: '2026-10-14',
    timeWindow: 'por la tarde',
    deliveryAddress: 'Av. Busch 123',
    discountCents: 0,
    deliveryFeeCents: 1500,
    totalCents: 17500,
    netPaidCents: 5000,
    balanceDueCents: 12500,
    items: [{ quantity: 2, productName: 'Polera básica', variantLabel: 'M / Negra', lineTotalCents: 16000 }],
  };
  const business = { name: 'Luna Boutique', pickupAddress: 'Calle 1' };

  it('construye el resumen con valores reales', () => {
    const text = buildOrderSummary(order, business);
    expect(text).toContain('Hola, Ana. Este es el resumen de tu pedido PED-000123 en Luna Boutique:');
    expect(text).toContain('2 × Polera básica — M / Negra: Bs 160.00');
    expect(text).toContain('Envío: Bs 15.00');
    expect(text).toContain('Total: Bs 175.00');
    expect(text).toContain('Pago registrado: Bs 50.00');
    expect(text).toContain('Saldo pendiente: Bs 125.00');
    expect(text).toContain('Entrega: 14/10/2026, por la tarde.');
    expect(text).toContain('¡Gracias por tu compra!');
  });

  it('nunca incluye notas privadas, costos ni IDs internos', () => {
    const withSecrets = {
      ...order,
      notes: 'NOTA PRIVADA',
      unitCostCents: 999,
      id: '00000000-0000-0000-0000-000000000000',
    } as ShareOrder;
    const text = buildOrderSummary(withSecrets, business);
    expect(text).not.toContain('NOTA PRIVADA');
    expect(text).not.toContain('00000000-0000');
    expect(text).not.toContain('9.99');
  });

  it('retiro muestra lugar de retiro y no dirección del cliente', () => {
    const text = buildOrderSummary({ ...order, fulfillmentType: 'pickup' }, business);
    expect(text).toContain('Retiro: 14/10/2026, por la tarde.');
    expect(text).toContain('Lugar de retiro: Calle 1');
    expect(text).not.toContain('Av. Busch');
  });

  it('recordatorio de pago', () => {
    expect(buildPaymentReminder(order, business)).toBe(
      'Hola, Ana. Te escribimos de Luna Boutique por tu pedido PED-000123. El saldo pendiente es Bs 125.00. ' +
        'Si ya realizaste el pago, por favor avisanos para revisarlo. ¡Gracias!',
    );
  });

  it('arma el enlace wa.me con número y texto codificado', () => {
    const url = whatsappUrl('+59171234567', 'Hola & chau\n¿listo?');
    expect(url).toBe('https://wa.me/59171234567?text=Hola%20%26%20chau%0A%C2%BFlisto%3F');
    expect(whatsappUrl(null, 'x')).toBe('https://wa.me/?text=x');
  });
});
