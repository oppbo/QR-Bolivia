'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireBusiness } from '@/lib/auth/session';
import { fromLocalInputValue } from '@/lib/dates';
import { dbErrorMessage } from '@/lib/db/errors';
import { callRpc } from '@/lib/db/rpc';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from '@/lib/orders/labels';
import { fileFromForm, removeImage, uploadImage } from '@/lib/storage/images';
import { createClient } from '@/lib/supabase/server';
import { moneyString, optionalText, uuid } from '@/lib/validation/fields';
import { fail, issuesToFieldErrors, type ActionResult } from '@/lib/validation/result';

const expenseSchema = z.object({
  amount: moneyString({ positive: true }),
  category: z.string().refine((c) => (EXPENSE_CATEGORIES as string[]).includes(c), 'Elegí una categoría.'),
  method: z.string().refine((m) => (PAYMENT_METHODS as string[]).includes(m), 'Elegí un medio de pago.'),
  occurred_at: z.string(),
  description: optionalText(300),
  idempotency_key: uuid,
  replaces_id: z.string().optional(),
  reason: z.string().optional(),
});

export async function saveExpense(formData: FormData): Promise<ActionResult> {
  const { business, timezone } = await requireBusiness();
  const raw = Object.fromEntries(
    ['amount', 'category', 'method', 'occurred_at', 'description', 'idempotency_key', 'replaces_id', 'reason'].map((k) => [k, String(formData.get(k) ?? '')]),
  );
  const parsed = expenseSchema.safeParse(raw);
  if (!parsed.success) return fail('Revisá los campos marcados.', issuesToFieldErrors(parsed.error.issues));
  const occurred = parsed.data.occurred_at ? fromLocalInputValue(parsed.data.occurred_at, timezone) : new Date();
  if (!occurred) return fail('La fecha no es válida.', { occurred_at: 'La fecha no es válida.' });
  if (occurred.getTime() > Date.now() + 60_000) return fail('La fecha y hora no pueden estar en el futuro.', { occurred_at: 'No puede estar en el futuro.' });
  const supabase = await createClient();

  if (parsed.data.replaces_id) {
    if (!uuid.safeParse(parsed.data.replaces_id).success) return fail('No encontramos ese gasto.');
    const reason = (parsed.data.reason ?? '').trim();
    if (!reason) return fail('Indicá por qué corregís este gasto.', { reason: 'Indicá un motivo.' });
    const { error } = await callRpc(supabase, 'correct_expense', {
      p_expense_id: parsed.data.replaces_id,
      p_reason: reason.slice(0, 500),
      p_amount_cents: parsed.data.amount,
      p_category: parsed.data.category,
      p_method: parsed.data.method,
      p_occurred_at: occurred.toISOString(),
      p_description: parsed.data.description,
      p_idempotency_key: parsed.data.idempotency_key,
    });
    if (error) return fail(dbErrorMessage(error));
  } else {
    let receipt: string | null = null;
    const file = fileFromForm(formData, 'receipt');
    if (file) {
      const up = await uploadImage(supabase, business.id, 'receipts', file);
      if (!up.ok) return fail(up.error, { receipt: up.error });
      receipt = up.path;
    }
    const { error } = await callRpc(supabase, 'record_expense', {
      p_amount_cents: parsed.data.amount,
      p_category: parsed.data.category,
      p_method: parsed.data.method,
      p_occurred_at: occurred.toISOString(),
      p_description: parsed.data.description,
      p_receipt_path: receipt,
      p_idempotency_key: parsed.data.idempotency_key,
    });
    if (error) {
      await removeImage(supabase, receipt);
      return fail(dbErrorMessage(error));
    }
  }
  revalidatePath('/app', 'layout');
  return { ok: true, data: undefined };
}

export async function voidExpense(expenseId: string, reason: string): Promise<ActionResult> {
  await requireBusiness();
  if (!uuid.safeParse(expenseId).success) return fail('No encontramos ese gasto.');
  if (!reason.trim()) return fail('Indicá un motivo.', { reason: 'Indicá un motivo.' });
  const supabase = await createClient();
  const { error } = await callRpc(supabase, 'void_expense', { p_expense_id: expenseId, p_reason: reason.trim().slice(0, 500) });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath('/app', 'layout');
  return { ok: true, data: undefined };
}
