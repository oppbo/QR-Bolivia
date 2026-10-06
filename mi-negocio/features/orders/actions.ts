'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireBusiness } from '@/lib/auth/session';
import { fromLocalInputValue, isDateString } from '@/lib/dates';
import { dbErrorCode, dbErrorMessage } from '@/lib/db/errors';
import { callRpc } from '@/lib/db/rpc';
import { normalizePhone } from '@/lib/phone';
import { fileFromForm, removeImage, uploadImage } from '@/lib/storage/images';
import { createClient } from '@/lib/supabase/server';
import { intString, moneyString, optionalText, uuid } from '@/lib/validation/fields';
import { fail, issuesToFieldErrors, type ActionResult } from '@/lib/validation/result';

const METHODS = ['cash', 'qr', 'transfer', 'other'] as const;

const orderSchema = z
  .object({
    customer_id: uuid.nullable(),
    customer_name: optionalText(120),
    customer_phone: z.string().max(30),
    fulfillment_type: z.enum(['pickup', 'delivery']),
    promised_date: z.string().refine((v) => v === '' || isDateString(v), 'La fecha no es válida.'),
    time_window: optionalText(60),
    delivery_address: optionalText(300),
    delivery_reference: optionalText(300),
    notes: optionalText(2000),
    discount: moneyString(),
    delivery_fee: moneyString(),
    items: z
      .array(
        z.object({
          variant_id: uuid,
          quantity: intString({ min: 1, max: 10000, label: 'La cantidad' }),
          unit_price: moneyString(),
        }),
      )
      .min(1, 'Agregá al menos un producto al pedido.')
      .max(50, 'Máximo 50 líneas por pedido.'),
  })
  .superRefine((d, ctx) => {
    const subtotal = d.items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    if (d.discount > subtotal) ctx.addIssue({ code: 'custom', path: ['discount'], message: 'El descuento no puede superar el subtotal de los productos.' });
  });

export type OrderFormInput = z.input<typeof orderSchema>;

function toDbOrder(d: z.output<typeof orderSchema>, phone: string | null) {
  return {
    customer_id: d.customer_id,
    customer_name: d.customer_id ? null : d.customer_name,
    customer_phone: d.customer_id ? null : phone,
    fulfillment_type: d.fulfillment_type,
    promised_date: d.promised_date || null,
    time_window: d.time_window,
    delivery_address: d.fulfillment_type === 'delivery' ? d.delivery_address : null,
    delivery_reference: d.fulfillment_type === 'delivery' ? d.delivery_reference : null,
    notes: d.notes,
    discount_cents: d.discount,
    delivery_fee_cents: d.fulfillment_type === 'delivery' ? d.delivery_fee : 0,
    items: d.items.map((i) => ({ variant_id: i.variant_id, quantity: i.quantity, unit_price_cents: i.unit_price })),
  };
}

function parseOrder(input: OrderFormInput) {
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) return { error: fail('Revisá los campos marcados.', issuesToFieldErrors(parsed.error.issues)) } as const;
  const phone = normalizePhone(parsed.data.customer_phone);
  if (!phone.ok) return { error: fail(phone.error, { customer_phone: phone.error }) } as const;
  return { order: toDbOrder(parsed.data, phone.e164) } as const;
}

function dbFail(error: Parameters<typeof dbErrorMessage>[0]) {
  const code = dbErrorCode(error);
  let message = dbErrorMessage(error);
  // El detalle de stock (producto, disponible, pedido) es seguro de mostrar.
  if (code === 'insufficient_stock' && error?.details) message = `${message} ${error.details}.`;
  if (code === 'payment_exceeds_balance' || code === 'refund_exceeds_payment') message = message.replace(/\.$/, '') + '.';
  return { ok: false as const, error: message, code: code ?? undefined };
}

export type OrderActionResult<T = undefined> = ActionResult<T> | { ok: false; error: string; code?: string };

export async function createOrder(input: {
  order: OrderFormInput;
  confirm: boolean;
  payment: { amount: string; method: string } | null;
  idempotencyKey: string;
}): Promise<OrderActionResult<{ id: string }>> {
  await requireBusiness();
  const r = parseOrder(input.order);
  if ('error' in r) return r.error!;
  if (!uuid.safeParse(input.idempotencyKey).success) return fail('No pudimos procesar el envío. Intentá de nuevo.');
  let payment: { amount_cents: number; method: string } | null = null;
  if (input.payment) {
    if (!input.confirm) return fail('Confirmá el pedido para registrar un pago.');
    const p = z.object({ amount: moneyString({ positive: true }), method: z.enum(METHODS, 'Elegí un medio de pago.') }).safeParse(input.payment);
    if (!p.success) {
      const fe = issuesToFieldErrors(p.error.issues);
      return fail('Revisá los datos del pago.', { payment_amount: fe.amount, payment_method: fe.method });
    }
    payment = { amount_cents: p.data.amount, method: p.data.method };
  }
  const supabase = await createClient();
  const { data, error } = await callRpc(supabase, 'create_order', {
    p_input: r.order,
    p_confirm: input.confirm,
    p_payment: payment,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error || !data) return dbFail(error);
  revalidatePath('/app', 'layout');
  return { ok: true, data: { id: data } };
}

export async function updateOrderDraft(orderId: string, revision: number, order: OrderFormInput): Promise<OrderActionResult<{ id: string }>> {
  await requireBusiness();
  if (!uuid.safeParse(orderId).success) return fail('No encontramos ese pedido.');
  const r = parseOrder(order);
  if ('error' in r) return r.error!;
  const supabase = await createClient();
  const { error } = await callRpc(supabase, 'update_order_draft', { p_order_id: orderId, p_expected_revision: revision, p_input: r.order });
  if (error) return dbFail(error);
  revalidatePath('/app', 'layout');
  return { ok: true, data: { id: orderId } };
}

const logisticsSchema = z.object({
  fulfillment_type: z.enum(['pickup', 'delivery']),
  promised_date: z.string().refine((v) => v === '' || isDateString(v), 'La fecha no es válida.'),
  time_window: optionalText(60),
  delivery_address: optionalText(300),
  delivery_reference: optionalText(300),
  notes: optionalText(2000),
});

export async function updateLogistics(orderId: string, revision: number, input: z.input<typeof logisticsSchema>): Promise<OrderActionResult> {
  await requireBusiness();
  const parsed = logisticsSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(orderId).success) {
    return fail('Revisá los campos marcados.', parsed.success ? undefined : issuesToFieldErrors(parsed.error.issues));
  }
  const supabase = await createClient();
  const { error } = await callRpc(supabase, 'update_order_logistics', {
    p_order_id: orderId,
    p_expected_revision: revision,
    p_input: { ...parsed.data, promised_date: parsed.data.promised_date || null },
  });
  if (error) return dbFail(error);
  revalidatePath('/app', 'layout');
  return { ok: true, data: undefined };
}

export async function transitionOrder(orderId: string, revision: number, to: 'confirmed' | 'preparing' | 'delivered'): Promise<OrderActionResult> {
  await requireBusiness();
  if (!uuid.safeParse(orderId).success) return fail('No encontramos ese pedido.');
  const supabase = await createClient();
  const fn = to === 'confirmed' ? 'confirm_order' : to === 'preparing' ? 'mark_order_preparing' : 'mark_order_delivered';
  const { error } = await callRpc(supabase, fn, { p_order_id: orderId, p_expected_revision: revision });
  if (error) return dbFail(error);
  revalidatePath('/app', 'layout');
  return { ok: true, data: undefined };
}

export async function cancelOrder(orderId: string, revision: number, reason: string, returnedToStock: boolean | null): Promise<OrderActionResult> {
  await requireBusiness();
  if (!uuid.safeParse(orderId).success) return fail('No encontramos ese pedido.');
  const r = reason.trim();
  if (!r) return fail('Indicá el motivo de la cancelación.', { reason: 'Indicá el motivo de la cancelación.' });
  if (r.length > 500) return fail('Máximo 500 caracteres.', { reason: 'Máximo 500 caracteres.' });
  const supabase = await createClient();
  const { error } = await callRpc(supabase, 'cancel_order', {
    p_order_id: orderId,
    p_expected_revision: revision,
    p_reason: r,
    p_returned_to_stock: returnedToStock,
  });
  if (error) return dbFail(error);
  revalidatePath('/app', 'layout');
  return { ok: true, data: undefined };
}

const paymentSchema = z.object({
  order_id: uuid,
  amount: moneyString({ positive: true }),
  method: z.enum(METHODS, 'Elegí un medio de pago.'),
  occurred_at: z.string(),
  reference: optionalText(120),
  note: optionalText(500),
  idempotency_key: uuid,
});

export async function recordPayment(formData: FormData): Promise<OrderActionResult> {
  const { business, timezone } = await requireBusiness();
  const raw = Object.fromEntries(['order_id', 'amount', 'method', 'occurred_at', 'reference', 'note', 'idempotency_key'].map((k) => [k, String(formData.get(k) ?? '')]));
  const parsed = paymentSchema.safeParse(raw);
  if (!parsed.success) return fail('Revisá los campos marcados.', issuesToFieldErrors(parsed.error.issues));
  const occurred = parsed.data.occurred_at ? fromLocalInputValue(parsed.data.occurred_at, timezone) : new Date();
  if (!occurred) return fail('La fecha no es válida.', { occurred_at: 'La fecha no es válida.' });
  if (occurred.getTime() > Date.now() + 60_000) return fail('La fecha y hora no pueden estar en el futuro.', { occurred_at: 'No puede estar en el futuro.' });

  const supabase = await createClient();
  let receipt: string | null = null;
  const file = fileFromForm(formData, 'receipt');
  if (file) {
    const up = await uploadImage(supabase, business.id, 'receipts', file);
    if (!up.ok) return fail(up.error, { receipt: up.error });
    receipt = up.path;
  }
  const { data, error } = await callRpc(supabase, 'record_payment', {
    p_order_id: parsed.data.order_id,
    p_amount_cents: parsed.data.amount,
    p_method: parsed.data.method,
    p_occurred_at: occurred.toISOString(),
    p_reference: parsed.data.reference,
    p_note: parsed.data.note,
    p_receipt_path: receipt,
    p_idempotency_key: parsed.data.idempotency_key,
  });
  if (error || !data) {
    await removeImage(supabase, receipt);
    return dbFail(error);
  }
  revalidatePath('/app', 'layout');
  return { ok: true, data: undefined };
}

export async function voidPayment(paymentId: string, reason: string): Promise<OrderActionResult> {
  await requireBusiness();
  if (!uuid.safeParse(paymentId).success) return fail('No encontramos ese pago.');
  if (!reason.trim()) return fail('Indicá por qué anulás este registro.', { reason: 'Indicá un motivo.' });
  const supabase = await createClient();
  const { error } = await callRpc(supabase, 'void_payment', { p_payment_id: paymentId, p_reason: reason.trim().slice(0, 500) });
  if (error) return dbFail(error);
  revalidatePath('/app', 'layout');
  return { ok: true, data: undefined };
}

const refundSchema = z.object({
  payment_id: uuid,
  amount: moneyString({ positive: true }),
  method: z.string().refine((m) => (METHODS as readonly string[]).includes(m), 'Elegí un medio.'),
  occurred_at: z.string(),
  reason: z.string().trim().min(1, 'Indicá un motivo.').max(500),
  idempotency_key: uuid,
});

export async function recordRefund(input: z.input<typeof refundSchema>): Promise<OrderActionResult> {
  const { timezone } = await requireBusiness();
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) return fail('Revisá los campos marcados.', issuesToFieldErrors(parsed.error.issues));
  const occurred = parsed.data.occurred_at ? fromLocalInputValue(parsed.data.occurred_at, timezone) : new Date();
  if (!occurred) return fail('La fecha no es válida.', { occurred_at: 'La fecha no es válida.' });
  const supabase = await createClient();
  const { error } = await callRpc(supabase, 'record_refund', {
    p_payment_id: parsed.data.payment_id,
    p_amount_cents: parsed.data.amount,
    p_method: parsed.data.method,
    p_occurred_at: occurred.toISOString(),
    p_reason: parsed.data.reason,
    p_idempotency_key: parsed.data.idempotency_key,
  });
  if (error) return dbFail(error);
  revalidatePath('/app', 'layout');
  return { ok: true, data: undefined };
}

export async function voidRefund(refundId: string, reason: string): Promise<OrderActionResult> {
  await requireBusiness();
  if (!uuid.safeParse(refundId).success) return fail('No encontramos ese reembolso.');
  if (!reason.trim()) return fail('Indicá por qué anulás este registro.', { reason: 'Indicá un motivo.' });
  const supabase = await createClient();
  const { error } = await callRpc(supabase, 'void_refund', { p_refund_id: refundId, p_reason: reason.trim().slice(0, 500) });
  if (error) return dbFail(error);
  revalidatePath('/app', 'layout');
  return { ok: true, data: undefined };
}

/** Registra que se ABRIÓ WhatsApp (no que el mensaje se haya enviado). */
export async function logShareOpened(orderId: string, kind: 'summary' | 'reminder'): Promise<void> {
  await requireBusiness();
  if (!uuid.safeParse(orderId).success) return;
  const supabase = await createClient();
  await callRpc(supabase, 'log_share_opened', { p_order_id: orderId, p_kind: kind });
}

export interface CustomerOption {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  delivery_reference: string | null;
}

export async function searchCustomers(q: string): Promise<CustomerOption[]> {
  await requireBusiness();
  const supabase = await createClient();
  const { data } = await supabase.rpc('list_customers', { p_search: q.slice(0, 80) || undefined, p_limit: 8 });
  const ids = (data ?? []).map((c) => c.id);
  if (ids.length === 0) return [];
  const { data: full } = await supabase.from('customers').select('id, name, phone, address, delivery_reference').in('id', ids);
  const byId = new Map((full ?? []).map((c) => [c.id, c]));
  return ids.map((id) => byId.get(id)).filter((c): c is CustomerOption => Boolean(c));
}

export interface VariantOption {
  variant_id: string;
  product_name: string;
  label: string | null;
  sku: string | null;
  price_cents: number;
  track_inventory: boolean;
  available: number;
}

export async function searchVariants(q: string): Promise<VariantOption[]> {
  await requireBusiness();
  const supabase = await createClient();
  const { data } = await supabase.rpc('search_sellable_variants', { p_search: q.slice(0, 80) || undefined, p_limit: 30 });
  return (data ?? []).map((v) => ({
    variant_id: v.variant_id,
    product_name: v.product_name,
    label: [v.size, v.color].filter(Boolean).join(' / ') || null,
    sku: v.sku,
    price_cents: v.price_cents,
    track_inventory: v.track_inventory,
    available: v.available,
  }));
}
