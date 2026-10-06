import type { Metadata } from 'next';
import { LoginForm } from '@/features/auth/forms';
import { safeNextPath } from '@/lib/auth/redirect';

export const metadata: Metadata = { title: 'Iniciar sesión' };

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === 'string' ? sp.next : null);
  const notice =
    sp.error === 'link'
      ? 'El enlace no es válido o ya venció. Pedí uno nuevo.'
      : sp.signedout
        ? 'Cerraste sesión.'
        : typeof sp.next === 'string'
          ? 'Iniciá sesión para continuar.'
          : undefined;
  return <LoginForm next={next} notice={notice} />;
}
