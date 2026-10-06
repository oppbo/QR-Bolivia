// CSV seguro: escapa comillas y neutraliza fórmulas (=, +, -, @, tab, CR) para hojas de cálculo.
export function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r;]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  // BOM para que Excel reconozca UTF-8 (tildes y ñ).
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Monto para CSV: número con punto decimal y dos decimales (sin "Bs"), apto para sumar. */
export function csvAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
