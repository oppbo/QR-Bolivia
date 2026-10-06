import { z } from 'zod';
import { parseMoneyInput } from '@/lib/money/money';

/** Monto en texto -> centavos, con la misma regla en cliente y servidor. */
export function moneyString(opts: { positive?: boolean } = {}) {
  return z.string().transform((raw, ctx): number => {
    const r = parseMoneyInput(raw, { allowZero: !opts.positive });
    if (!r.ok) {
      ctx.addIssue({ code: 'custom', message: r.error });
      return z.NEVER;
    }
    return r.cents;
  });
}

/** Igual que moneyString, pero vacío = null (p. ej. costo desconocido). */
export function optionalMoneyString() {
  return z.string().transform((raw, ctx): number | null => {
    if (raw.trim() === '') return null;
    const r = parseMoneyInput(raw);
    if (!r.ok) {
      ctx.addIssue({ code: 'custom', message: r.error });
      return z.NEVER;
    }
    return r.cents;
  });
}

function parseInt_(raw: string, min: number, max: number, label: string, ctx: z.RefinementCtx): number | typeof z.NEVER {
  const v = raw.trim();
  if (!/^-?\d+$/.test(v)) {
    ctx.addIssue({ code: 'custom', message: v === '' ? `${label} es obligatorio.` : `${label} debe ser un número entero.` });
    return z.NEVER;
  }
  const n = Number(v);
  if (n < min || n > max) {
    ctx.addIssue({ code: 'custom', message: `${label} debe estar entre ${min} y ${max}.` });
    return z.NEVER;
  }
  return n;
}

export function intString(opts: { min?: number; max?: number; label?: string } = {}) {
  const { min = 0, max = 1_000_000, label = 'El valor' } = opts;
  return z.string().transform((raw, ctx): number => parseInt_(raw, min, max, label, ctx));
}

export function optionalIntString(opts: { min?: number; max?: number; label?: string } = {}) {
  const { min = 0, max = 1_000_000, label = 'El valor' } = opts;
  return z.string().transform((raw, ctx): number | null => (raw.trim() === '' ? null : parseInt_(raw, min, max, label, ctx)));
}

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres.`)
    .transform((v) => (v === '' ? null : v));

export const uuid = z.string().uuid();
