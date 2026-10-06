'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { dbErrorMessage } from '@/lib/db/errors';
import { callRpc } from '@/lib/db/rpc';
import { normalizePhone } from '@/lib/phone';
import { createClient } from '@/lib/supabase/server';
import { formValues, zodFieldErrors, type FormState } from '@/lib/validation/forms';

const schema = z.object({
  business_name: z.string().trim().min(1, 'Ingresá el nombre del negocio.').max(80, 'Máximo 80 caracteres.'),
  display_name: z.string().trim().min(1, 'Ingresá cómo querés que te llamemos.').max(80, 'Máximo 80 caracteres.'),
  whatsapp: z.string().trim().max(30),
  pickup_address: z.string().trim().max(300, 'Máximo 300 caracteres.'),
});

export async function createBusiness(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ['business_name', 'display_name', 'whatsapp', 'pickup_address']);
  const parsed = schema.safeParse(values);
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error.issues), values };
  const phone = normalizePhone(parsed.data.whatsapp);
  if (!phone.ok) return { fieldErrors: { whatsapp: phone.error }, values };
  if (!phone.e164) return { fieldErrors: { whatsapp: 'Ingresá el WhatsApp del negocio.' }, values };

  const supabase = await createClient();
  const { error } = await callRpc(supabase, 'create_business', {
    p_business_name: parsed.data.business_name,
    p_display_name: parsed.data.display_name,
    p_whatsapp_phone: phone.e164,
    p_pickup_address: parsed.data.pickup_address || null,
    p_pickup_reference: null,
  });
  if (error) return { error: dbErrorMessage(error), values };
  redirect('/app');
}
