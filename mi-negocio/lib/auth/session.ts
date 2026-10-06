import 'server-only';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { DEFAULT_TIMEZONE } from '@/lib/dates';
import { createClient } from '@/lib/supabase/server';

export interface BusinessContext {
  userId: string;
  email: string | null;
  displayName: string | null;
  business: {
    id: string;
    name: string;
    timezone: string;
    whatsapp_phone: string | null;
    pickup_address: string | null;
    pickup_reference: string | null;
    logo_path: string | null;
    payment_qr_path: string | null;
    payment_qr_label: string | null;
    revision: number;
  } | null;
}

/** Usuario autenticado + su negocio (una vez por request). */
export const getContext = cache(async (): Promise<BusinessContext | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const [{ data: business }, { data: profile }] = await Promise.all([
    supabase
      .from('businesses')
      .select('id, name, timezone, whatsapp_phone, pickup_address, pickup_reference, logo_path, payment_qr_path, payment_qr_label, revision')
      .limit(1)
      .maybeSingle(),
    supabase.from('profiles').select('display_name').eq('id', data.user.id).maybeSingle(),
  ]);
  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    displayName: profile?.display_name ?? null,
    business: business ?? null,
  };
});

/** Para páginas privadas: exige sesión y negocio; si no, redirige. */
export async function requireBusiness(nextPath = '/app') {
  const ctx = await getContext();
  if (!ctx) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (!ctx.business) redirect('/onboarding');
  return { ...ctx, business: ctx.business, timezone: ctx.business.timezone || DEFAULT_TIMEZONE };
}
