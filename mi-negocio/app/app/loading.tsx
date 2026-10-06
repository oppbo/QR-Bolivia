export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <span className="sr-only">Cargando…</span>
      <div className="h-8 w-48 animate-pulse rounded bg-line" />
      <div className="h-24 animate-pulse rounded-[var(--radius-card)] bg-line/70" />
      <div className="h-24 animate-pulse rounded-[var(--radius-card)] bg-line/70" />
    </div>
  );
}
