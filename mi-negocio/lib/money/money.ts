// Dinero en centavos enteros (BOB). Bs 125.50 se guarda como 12550.

export const MAX_AMOUNT_CENTS = 100_000_000; // Bs 1,000,000.00 por campo

export type MoneyParseResult =
  | { ok: true; cents: number }
  | { ok: false; error: string };

/**
 * Interpreta un monto escrito por la persona. Acepta un único separador decimal
 * ("." o ",") con hasta dos decimales. Rechaza separadores de miles o mezclas
 * ambiguas ("1.234", "1,234.50", "1 234") en lugar de adivinar.
 */
export function parseMoneyInput(raw: string, opts: { allowZero?: boolean } = {}): MoneyParseResult {
  const allowZero = opts.allowZero ?? true;
  const value = raw.trim().replace(/^bs\.?\s*/i, '');
  if (value === '') return { ok: false, error: 'Ingresá un monto.' };
  if (value.startsWith('-')) return { ok: false, error: 'El monto no puede ser negativo.' };

  const match = /^(\d+)(?:[.,](\d*))?$/.exec(value);
  if (!match) {
    return { ok: false, error: 'Formato no válido. Escribí el monto sin separador de miles, por ejemplo 1234.50.' };
  }
  const [, whole, decimals = ''] = match;
  if (decimals.length > 2) {
    return { ok: false, error: 'Usá como máximo dos decimales (sin separador de miles).' };
  }
  if (whole.length > 9) return { ok: false, error: 'El monto es demasiado grande.' };

  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > MAX_AMOUNT_CENTS) {
    return { ok: false, error: 'El monto es demasiado grande.' };
  }
  if (!allowZero && cents === 0) return { ok: false, error: 'El monto debe ser mayor a cero.' };
  return { ok: true, cents };
}

/** Formato visible: "Bs 1,234.50". */
export function formatMoney(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error('formatMoney espera centavos enteros');
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const decimals = (abs % 100).toString().padStart(2, '0');
  return `${negative ? '-' : ''}Bs ${whole}.${decimals}`;
}

/** Valor para precargar un campo de monto: 12550 -> "125.50". */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return '';
  return `${Math.floor(cents / 100)}.${(cents % 100).toString().padStart(2, '0')}`;
}
