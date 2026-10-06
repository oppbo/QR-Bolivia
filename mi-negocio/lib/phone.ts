import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

export const DEFAULT_COUNTRY = 'BO' as const; // +591

export type PhoneResult = { ok: true; e164: string | null } | { ok: false; error: string };

/**
 * Normaliza un teléfono a formato E.164 (+59171234567). Sin prefijo internacional se
 * asume Bolivia (+591). Se aceptan números internacionales válidos. Vacío = sin teléfono.
 */
export function normalizePhone(raw: string | null | undefined): PhoneResult {
  const value = (raw ?? '').trim();
  if (value === '') return { ok: true, e164: null };
  if (!/^[+\d\s().-]+$/.test(value)) {
    return { ok: false, error: 'El teléfono solo puede tener números, espacios y el signo +.' };
  }
  const prepared = value.startsWith('00') ? `+${value.slice(2)}` : value;
  const parsed = parsePhoneNumberFromString(prepared, DEFAULT_COUNTRY);
  if (!parsed || !parsed.isValid()) {
    return { ok: false, error: 'El número de teléfono no es válido. Ejemplo: 71234567 o +591 71234567.' };
  }
  return { ok: true, e164: parsed.number };
}

/** Formato legible para mostrar: "+591 7123 4567". */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}

/** Dígitos para wa.me (sin "+", espacios ni guiones). */
export function whatsappDigits(e164: string): string {
  return e164.replace(/\D/g, '');
}
