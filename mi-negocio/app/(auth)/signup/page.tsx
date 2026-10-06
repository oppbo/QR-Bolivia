import type { Metadata } from 'next';
import { SignupForm } from '@/features/auth/forms';

export const metadata: Metadata = { title: 'Crear cuenta' };

export default function SignupPage() {
  return <SignupForm />;
}
