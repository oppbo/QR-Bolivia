'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireBusiness } from '@/lib/auth/session';
import { dbErrorMessage } from '@/lib/db/errors';
import { callRpc } from '@/lib/db/rpc';
import { normalizePhone } from '@/lib/phone';
import { createClient } from '@/lib/supabase/server';
import { optionalText, uuid } from '@/lib/validation/fields';
import { fail, issuesToFieldErrors, type ActionResult } from '@/lib/validation/result';

const schema = z.object({
  id: uuid.optional(),
  expected_revision: z.number().int().optional(),
  name: z.string().trim().min(1, 'Ingresá el nombre del cliente.').max(120, 'Máximo 120 caracteres.'),
  phone: z.string().max(30),
  address: optionalText(300),
  delivery_reference: optionalText(300),
  notes: optionalText(2000),
  allow_duplicate_phone: z.boolean().optional(),
});

export type CustomerInput = z.input<typeof schema>;
export type SaveCustomerResult =
  | ActionResult<{ id: string; name: string; phone: string | null; address: string | null; delivery_reference: string | null }>
  | { ok: false; error: string; duplicates: { id: string; name: string }[] };

export async function saveCustomer(input: CustomerInput): Promise<SaveCustomerResult> {
  await requireBusiness();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail('Revisá los campos marcados.', issuesToFieldErrors(parsed.error.issues));
  const phone = normalizePhone(parsed.data.phone);
  if (!phone.ok) return fail(phone.error, { phone: phone.error });

  const supabase = await createClient();
  // Los teléfonos pueden compartirse (familias): solo advertimos, nunca fusionamos.
  if (phone.e164 && !parsed.data.allow_duplicate_phone) {
    let q = supabase.from('customers').select('id, name').eq('phone', phone.e164).limit(5);
    if (parsed.data.id) q = q.neq('id', parsed.data.id);
    const { data: dupes } = await q;
    if (dupes && dupes.length > 0) {
      return { ok: false, error: 'Ya hay clientes con este teléfono.', duplicates: dupes };
    }
  }

  const { data, error } = await callRpc(supabase, 'save_customer', {
    p_input: {
      id: parsed.data.id ?? null,
      expected_revision: parsed.data.expected_revision ?? null,
      name: parsed.data.name,
      phone: phone.e164,
      address: parsed.data.address,
      delivery_reference: parsed.data.delivery_reference,
      notes: parsed.data.notes,
    },
  });
  if (error || !data) return fail(dbErrorMessage(error));
  revalidatePath('/app/customers');
  return {
    ok: true,
    data: { id: data, name: parsed.data.name, phone: phone.e164, address: parsed.data.address, delivery_reference: parsed.data.delivery_reference },
  };
}

export async function setCustomerArchived(customerId: string, archived: boolean): Promise<ActionResult> {
  await requireBusiness();
  if (!uuid.safeParse(customerId).success) return fail('No encontramos ese cliente.');
  const supabase = await createClient();
  const { error } = await callRpc(supabase, 'set_customer_archived', { p_customer_id: customerId, p_archived: archived });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath('/app/customers');
  return { ok: true, data: undefined };
}
