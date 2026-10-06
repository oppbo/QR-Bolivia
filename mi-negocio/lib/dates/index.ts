// Fechas: los instantes se guardan en UTC; los días de reporte se calculan con la
// zona horaria del negocio. Las fechas prometidas son fechas de calendario
// ("YYYY-MM-DD") y nunca pasan por conversión de zona horaria.

export const DEFAULT_TIMEZONE = 'America/La_Paz';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(tz, f);
  }
  return f;
}

function zonedParts(date: Date, tz: string): Parts {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/** Diferencia (ms) entre la hora local de `tz` y UTC en el instante dado. */
function offsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Convierte una hora local de pared en `tz` a un instante UTC. */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let result = guess - offsetMs(new Date(guess), tz);
  // Segunda pasada por si el desfase cambia (horario de verano en otras zonas).
  result = guess - offsetMs(new Date(result), tz);
  return new Date(result);
}

export function isDateString(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Fecha local de hoy en la zona del negocio: "YYYY-MM-DD". */
export function todayInTimezone(tz: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  const p = zonedParts(now, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Suma días a una fecha de calendario sin tocar zonas horarias. */
export function addDays(date: string, days: number): string {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error('Fecha no válida');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

/** Límites UTC [start, end) del rango de días locales from..to (ambos incluidos). */
export function localRangeBounds(from: string, to: string, tz: string = DEFAULT_TIMEZONE): { start: Date; end: Date } {
  const [fy, fm, fd] = from.split('-').map(Number);
  const next = addDays(to, 1);
  const [ty, tm, td] = next.split('-').map(Number);
  return { start: zonedToUtc(fy, fm, fd, 0, 0, tz), end: zonedToUtc(ty, tm, td, 0, 0, tz) };
}

export function localDayBounds(date: string, tz: string = DEFAULT_TIMEZONE) {
  return localRangeBounds(date, date, tz);
}

/** "2026-10-14" -> "14/10/2026" (sin conversión de zona horaria). */
export function formatDate(date: string | null | undefined): string {
  if (!date) return '';
  const m = DATE_RE.exec(date.slice(0, 10));
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Instante UTC -> "14/10/2026 15:30" en la zona del negocio. */
export function formatDateTime(iso: string | Date, tz: string = DEFAULT_TIMEZONE): string {
  const p = zonedParts(typeof iso === 'string' ? new Date(iso) : iso, tz);
  const dd = String(p.day).padStart(2, '0');
  const mm = String(p.month).padStart(2, '0');
  const hh = String(p.hour).padStart(2, '0');
  const mi = String(p.minute).padStart(2, '0');
  return `${dd}/${mm}/${p.year} ${hh}:${mi}`;
}

/** Instante -> valor para <input type="datetime-local"> en la zona del negocio. */
export function toLocalInputValue(date: Date, tz: string = DEFAULT_TIMEZONE): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Valor de <input type="datetime-local"> interpretado en la zona del negocio -> instante UTC. */
export function fromLocalInputValue(value: string, tz: string = DEFAULT_TIMEZONE): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  if (!isDateString(`${m[1]}-${m[2]}-${m[3]}`)) return null;
  const h = Number(m[4]);
  const mi = Number(m[5]);
  if (h > 23 || mi > 59) return null;
  return zonedToUtc(Number(m[1]), Number(m[2]), Number(m[3]), h, mi, tz);
}
