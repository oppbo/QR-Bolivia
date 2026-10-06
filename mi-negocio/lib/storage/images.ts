import 'server-only';
import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/database.types';

export const BUCKET = 'business-files';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export type ImageFolder = 'logo' | 'qr' | 'products' | 'receipts';

type Detected = { ext: 'jpg' | 'png' | 'webp'; contentType: 'image/jpeg' | 'image/png' | 'image/webp' };

/** Detecta el tipo real por la firma del archivo (no confía en el nombre ni en el MIME declarado). */
export function detectImageType(bytes: Uint8Array): Detected | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', contentType: 'image/jpeg' };
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) {
    return { ext: 'png', contentType: 'image/png' };
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return { ext: 'webp', contentType: 'image/webp' };
  }
  return null;
}

export type UploadResult = { ok: true; path: string } | { ok: false; error: string };

/** Valida y sube una imagen a <businessId>/<folder>/<nombre aleatorio>.<ext> con la sesión del usuario. */
export async function uploadImage(
  supabase: SupabaseClient<Database>,
  businessId: string,
  folder: ImageFolder,
  file: File,
): Promise<UploadResult> {
  if (file.size === 0) return { ok: false, error: 'El archivo está vacío.' };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: 'La imagen supera 5 MB. Elegí una más liviana.' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectImageType(bytes);
  if (!type) return { ok: false, error: 'Solo se aceptan imágenes JPG, PNG o WebP.' };
  const path = `${businessId}/${folder}/${randomBytes(16).toString('hex')}.${type.ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: type.contentType, upsert: false });
  if (error) return { ok: false, error: 'No pudimos subir la imagen. Intentá de nuevo.' };
  return { ok: true, path };
}

export async function removeImage(supabase: SupabaseClient<Database>, path: string | null | undefined) {
  if (!path) return;
  await supabase.storage.from(BUCKET).remove([path]);
}

/** URL firmada de corta duración (por defecto 5 minutos). */
export async function signedImageUrl(supabase: SupabaseClient<Database>, path: string | null | undefined, seconds = 300, download?: string) {
  if (!path) return null;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds, download ? { download } : undefined);
  return data?.signedUrl ?? null;
}

export async function signedImageUrls(supabase: SupabaseClient<Database>, paths: (string | null | undefined)[], seconds = 300) {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  if (unique.length === 0) return new Map<string, string>();
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(unique, seconds);
  const map = new Map<string, string>();
  for (const item of data ?? []) if (item.path && item.signedUrl) map.set(item.path, item.signedUrl);
  return map;
}

export function fileFromForm(formData: FormData, key: string): File | null {
  const v = formData.get(key);
  return v instanceof File && v.size > 0 ? v : null;
}
