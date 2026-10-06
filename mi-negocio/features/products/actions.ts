'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireBusiness } from '@/lib/auth/session';
import { dbErrorMessage } from '@/lib/db/errors';
import { callRpc } from '@/lib/db/rpc';
import { fileFromForm, removeImage, uploadImage } from '@/lib/storage/images';
import { createClient } from '@/lib/supabase/server';
import { intString, moneyString, optionalIntString, optionalMoneyString, optionalText, uuid } from '@/lib/validation/fields';
import { fail, issuesToFieldErrors, type ActionResult } from '@/lib/validation/result';

const variantSchema = z.object({
  id: uuid.optional(),
  remove: z.boolean().optional(),
  sku: optionalText(60),
  size: optionalText(40),
  color: optionalText(40),
  price: moneyString(),
  cost: optionalMoneyString(),
  track_inventory: z.boolean(),
  initial_stock: optionalIntString({ min: 0, max: 1_000_000, label: 'El stock inicial' }),
  low_stock_threshold: intString({ min: 0, max: 100_000, label: 'El aviso de stock bajo' }),
});

const productSchema = z.object({
  id: uuid.optional(),
  expected_revision: z.number().int().optional(),
  name: z.string().trim().min(1, 'Ingresá el nombre del producto.').max(120, 'Máximo 120 caracteres.'),
  description: optionalText(1000),
  category: optionalText(60),
  remove_image: z.boolean(),
  variants: z.array(variantSchema).min(1, 'Agregá al menos una variante.').max(60),
});

export async function saveProduct(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const { business } = await requireBusiness();
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get('payload') ?? ''));
  } catch {
    return fail('Revisá los datos ingresados.');
  }
  const parsed = productSchema.safeParse(raw);
  if (!parsed.success) return fail('Revisá los campos marcados.', issuesToFieldErrors(parsed.error.issues));
  const input = parsed.data;
  if (input.variants.every((v) => v.remove)) return fail('El producto necesita al menos una variante.');

  const supabase = await createClient();
  let previousImage: string | null = null;
  if (input.id) {
    const { data } = await supabase.from('products').select('image_path').eq('id', input.id).maybeSingle();
    if (!data) return fail('No encontramos ese producto.');
    previousImage = data.image_path;
  }

  let imagePath = input.remove_image ? null : previousImage;
  let uploaded: string | null = null;
  const file = fileFromForm(formData, 'image');
  if (file) {
    const up = await uploadImage(supabase, business.id, 'products', file);
    if (!up.ok) return fail(up.error, { image: up.error });
    uploaded = up.path;
    imagePath = up.path;
  }

  const { data, error } = await callRpc(supabase, 'save_product', {
    p_input: {
      id: input.id ?? null,
      expected_revision: input.expected_revision ?? null,
      name: input.name,
      description: input.description,
      category: input.category,
      image_path: imagePath,
      variants: input.variants.map((v) => ({
        id: v.id ?? null,
        remove: v.remove ?? false,
        sku: v.sku,
        size: v.size,
        color: v.color,
        price_cents: v.price,
        cost_cents: v.cost,
        track_inventory: v.track_inventory,
        initial_stock: v.initial_stock ?? 0,
        low_stock_threshold: v.low_stock_threshold,
      })),
    },
  });
  if (error || !data) {
    await removeImage(supabase, uploaded);
    return fail(dbErrorMessage(error));
  }
  if (previousImage && previousImage !== imagePath) await removeImage(supabase, previousImage);
  revalidatePath('/app/products');
  return { ok: true, data: { id: data } };
}

const adjustSchema = z.object({
  variant_id: uuid,
  delta: intString({ min: -1_000_000, max: 1_000_000, label: 'La cantidad' }),
  reason: z.string().trim().min(1, 'Indicá un motivo.').max(300),
  operation_key: uuid,
});

export async function adjustStock(input: z.input<typeof adjustSchema>): Promise<ActionResult<{ on_hand: number; reserved: number }>> {
  await requireBusiness();
  const parsed = adjustSchema.safeParse(input);
  if (!parsed.success) return fail('Revisá los campos marcados.', issuesToFieldErrors(parsed.error.issues));
  if (parsed.data.delta === 0) return fail('La cantidad no puede ser cero.', { delta: 'Usá un número positivo para sumar o negativo para restar.' });
  const supabase = await createClient();
  const { data, error } = await callRpc(supabase, 'adjust_stock', {
    p_variant_id: parsed.data.variant_id,
    p_delta: parsed.data.delta,
    p_reason: parsed.data.reason,
    p_operation_key: parsed.data.operation_key,
  });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath('/app/products');
  return { ok: true, data: data as { on_hand: number; reserved: number } };
}

export async function setProductArchived(productId: string, archived: boolean): Promise<ActionResult> {
  await requireBusiness();
  if (!uuid.safeParse(productId).success) return fail('No encontramos ese producto.');
  const supabase = await createClient();
  const { error } = await callRpc(supabase, 'set_product_archived', { p_product_id: productId, p_archived: archived });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath('/app/products');
  return { ok: true, data: undefined };
}
