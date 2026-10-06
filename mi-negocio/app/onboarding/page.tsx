import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Store } from 'lucide-react';
import { OnboardingForm } from '@/features/onboarding/form';
import { getContext } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Tu negocio' };

export default async function OnboardingPage() {
  const ctx = await getContext();
  if (!ctx) redirect('/login?next=/onboarding');
  if (ctx.business) redirect('/app');
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-4 flex items-center gap-2 text-primary">
        <Store aria-hidden className="size-7" />
        <span className="text-xl font-bold">Mi Negocio</span>
      </div>
      <h1 className="text-2xl font-bold">Contanos de tu negocio</h1>
      <p className="mt-1 mb-6 text-muted">Son cuatro datos. Productos, QR de cobro y logo los podés agregar después.</p>
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <OnboardingForm defaultName={ctx.displayName ?? undefined} />
      </div>
    </main>
  );
}
