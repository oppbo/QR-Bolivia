import { redirect } from 'next/navigation';
import { getContext } from '@/lib/auth/session';

export default async function Home() {
  const ctx = await getContext();
  if (!ctx) redirect('/login');
  redirect(ctx.business ? '/app' : '/onboarding');
}
