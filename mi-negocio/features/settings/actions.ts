'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireBusiness } from '@/lib/auth/session';
import { TIMEZONES } from '@/lib/dates';
import { dbErrorMessage } from '@/lib/db/errors';
import { callRpc } from '@/lib/db/rpc';
import { normalizePhone } from '@/lib/phone';
import { fileFromForm, removeImage, uploadImage } from '@/lib/storage/images';
import { createClient } from '@/lib/supabase/server';
import { optionalText } from '@/lib/validation/fields';
import { fail, issuesToFieldErrors, type ActionResult } from '@/lib/validation/result';


const businessSchema = z.object({
  revision: z.number().int(),
  name: z.string().trim().min(1, 'Ingresá el nombre del negocio.').max(80, 'Máximo 80 caracteres.'),
  whatsapp_phone: z.string().max(30),
  pickup_address: optionalText(300),
  pickup_reference: optionalText(300),
  payment_qr_label: optionalText(160),
  timezone: z.string().refine((t) => TIMEZONES.includes(t), 'Elegí una zona horaria.'),
  display_name: z.string().trim().min(1, 'Ingresá tu nombre.').max(80),
});

export async function updateSettings(input: z.input<typeof businessSchema>): Promise<ActionResult> {
  await requireBusiness();
  const parsed = businessSchema.safeParse(input);
  if (!parsed.success) return fail('Revisá los campos marcados.', issuesToFieldErrors(parsed.error.issues));
  const phone = normalizePhone(parsed.data.whatsapp_phone);
  if (!phone.ok) return fail(phone.error, { whatsapp_phone: phone.error });
  const supabase = await createClient();
  const { error } = await callRpc(supabase, 'update_business', {
    p_expected_revision: parsed.data.revision,
    p_input: {
      name: parsed.data.name,
      whatsapp_phone: phone.e164,
      pickup_address: parsed.data.pickup_address,
      pickup_reference: parsed.data.pickup_reference,
      payment_qr_label: parsed.data.payment_qr_label,
      timezone: parsed.data.timezone,
    },
  });
  if (error) return fail(dbErrorMessage(error));
  const { error: e2 } = await callRpc(supabase, 'update_profile', { p_display_name: parsed.data.display_name });
  if (e2) return fail(dbErrorMessage(e2));
  revalidatePath('/app', 'layout');
  return { ok: true, data: undefined };
}

export async function setBusinessAsset(kind: 'logo' | 'payment_qr', formData: FormData): Promise<ActionResult> {
  const { business } = await requireBusiness();
  if (kind !== 'logo' && kind !== 'payment_qr') return fail('Revisá los datos ingresados.');
  const supabase = await createClient();
  const file = fileFromForm(formData, 'file');
  let path: string | null = null;
  if (file) {
    const up = await uploadImage(supabase, business.id, kind === 'logo' ? 'logo' : 'qr', file);
    if (!up.ok) return fail(up.error);
    path = up.path;
  }
  const { data: oldPath, error } = await callRpc(supabase, 'set_business_asset', { p_kind: kind, p_path: path });
  if (error) {
    await removeImage(supabase, path);
    return fail(dbErrorMessage(error));
  }
  if (oldPath && oldPath !== path) await removeImage(supabase, oldPath);
  revalidatePath('/app/settings');
  return { ok: true, data: undefined };
}
