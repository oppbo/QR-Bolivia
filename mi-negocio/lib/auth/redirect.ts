/** Solo permite rutas internas ("/app/..."), nunca URLs externas ni "//host". */
export function safeNextPath(raw: string | null | undefined, fallback = '/app'): string {
  if (!raw || typeof raw !== 'string') return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  if (/[\r\n]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, 'http://localhost');
    if (url.origin !== 'http://localhost') return fallback;
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}
