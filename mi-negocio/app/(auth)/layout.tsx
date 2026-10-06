import { Store } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2 text-primary">
        <Store aria-hidden className="size-7" />
        <span className="text-xl font-bold">Mi Negocio</span>
      </div>
      <p className="mb-6 text-muted">Sabé qué vendiste, quién te debe y qué tenés que entregar hoy.</p>
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-6">{children}</div>
    </main>
  );
}
