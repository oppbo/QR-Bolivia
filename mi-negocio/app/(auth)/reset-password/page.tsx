import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/primitives';
import { ResetPasswordForm } from '@/features/auth/forms';
import { getContext } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Nueva contraseña' };

export default async function ResetPasswordPage() {
  const ctx = await getContext();
  if (!ctx) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-bold">Nueva contraseña</h1>
        <Alert tone="warning">Abrí esta página desde el enlace que te enviamos por correo.</Alert>
        <Link href="/forgot-password" className="text-primary underline">Pedir un enlace</Link>
      </div>
    );
  }
  return <ResetPasswordForm />;
}
