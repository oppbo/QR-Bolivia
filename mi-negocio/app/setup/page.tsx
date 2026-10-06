import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Store } from 'lucide-react';
import { hasSupabaseEnv } from '@/lib/env';

export const metadata: Metadata = { title: 'Configuración pendiente' };
export const dynamic = 'force-dynamic';

export default function SetupPage() {
  if (hasSupabaseEnv()) redirect('/login');
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-4 px-4 py-10">
      <div className="flex items-center gap-2 text-primary">
        <Store aria-hidden className="size-7" />
        <span className="text-xl font-bold">Mi Negocio</span>
      </div>
      <h1 className="text-2xl font-bold">Falta conectar la base de datos</h1>
      <p className="text-muted">
        La aplicación se instaló correctamente, pero todavía no tiene un proyecto de Supabase configurado. Sin eso no se puede iniciar
        sesión ni guardar datos.
      </p>
      <ol className="list-decimal space-y-2 rounded-[var(--radius-card)] border border-line bg-surface p-5 pl-9">
        <li>Creá un proyecto en Supabase y aplicá las migraciones de <code>mi-negocio/supabase/migrations</code> (<code>npx supabase db push</code>).</li>
        <li>
          En Vercel, agregá las variables <code>NEXT_PUBLIC_SUPABASE_URL</code>, <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> y{' '}
          <code>NEXT_PUBLIC_SITE_URL</code>.
        </li>
        <li>En Supabase → Authentication → URL Configuration, agregá <code>&lt;tu-url&gt;/auth/callback</code>.</li>
        <li>Volvé a desplegar.</li>
      </ol>
    </main>
  );
}
