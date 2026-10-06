import Link from 'next/link';
import { buttonClass } from './primitives';

/** Paginación por URL (?page=N) para que recargar y "Atrás" funcionen. */
export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="mt-4 text-sm text-muted">{total} {total === 1 ? 'resultado' : 'resultados'}</p>;
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    if (p > 1) sp.set('page', String(p));
    const q = sp.toString();
    return q ? `${basePath}?${q}` : basePath;
  };
  return (
    <nav aria-label="Paginación" className="mt-4 flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link className={buttonClass('secondary')} href={href(page - 1)}>
          Anterior
        </Link>
      ) : (
        <span />
      )}
      <p className="text-sm text-muted">
        Página {page} de {pages} · {total} resultados
      </p>
      {page < pages ? (
        <Link className={buttonClass('secondary')} href={href(page + 1)}>
          Siguiente
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

export function parsePage(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n > 0 && n < 100000 ? n : 1;
}
