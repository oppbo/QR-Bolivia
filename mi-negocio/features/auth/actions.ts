'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { safeNextPath } from '@/lib/auth/redirect';
import { createClient } from '@/lib/supabase/server';
import { formValues, zodFieldErrors, type FormState } from '@/lib/validation/forms';

const email = z.string().trim().toLowerCase().email('Ingresá un correo válido.');
const password = z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').max(72, 'La contraseña es demasiado larga.');

async function origin() {
  const h = await headers();
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, '');
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ['email', 'next']);
  const parsed = z.object({ email, password: z.string().min(1, 'Ingresá tu contraseña.') }).safeParse({
    email: values.email,
    password: formData.get('password'),
  });
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error.issues), values };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === 'email_not_confirmed') {
      return { error: 'Tu correo todavía no está confirmado. Revisá tu bandeja de entrada.', values };
    }
    return { error: 'Correo o contraseña incorrectos.', values };
  }
  redirect(safeNextPath(values.next));
}

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ['email']);
  const parsed = z
    .object({ email, password, confirm: z.string() })
    .refine((d) => d.password === d.confirm, { path: ['confirm'], message: 'Las contraseñas no coinciden.' })
    .safeParse({ email: values.email, password: formData.get('password'), confirm: formData.get('confirm') });
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error.issues), values };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: `${await origin()}/auth/callback?next=/onboarding` },
  });
  if (error) {
    if (error.code === 'user_already_exists') return { error: 'Ya existe una cuenta con ese correo. Iniciá sesión.', values };
    if (error.code === 'weak_password') return { fieldErrors: { password: 'Elegí una contraseña más segura.' }, values };
    return { error: 'No pudimos crear la cuenta. Intentá de nuevo en unos minutos.', values };
  }
  if (data.session) redirect('/onboarding');
  // Con confirmación de correo activada no hay sesión hasta verificar: decirlo con honestidad.
  return {
    ok: true,
    message: 'Te enviamos un correo para confirmar tu cuenta. Abrí el enlace y después iniciá sesión.',
    values,
  };
}

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData, ['email']);
  const parsed = email.safeParse(values.email);
  if (!parsed.success) return { fieldErrors: { email: parsed.error.issues[0].message }, values };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${await origin()}/auth/callback?next=/reset-password`,
  });
  // Mismo mensaje exista o no la cuenta (no revela qué correos están registrados).
  return { ok: true, message: 'Si existe una cuenta con ese correo, te enviamos un enlace para crear una nueva contraseña.', values };
}

export async function resetPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({ password, confirm: z.string() })
    .refine((d) => d.password === d.confirm, { path: ['confirm'], message: 'Las contraseñas no coinciden.' })
    .safeParse({ password: formData.get('password'), confirm: formData.get('confirm') });
  if (!parsed.success) return { fieldErrors: zodFieldErrors(parsed.error.issues) };
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: 'El enlace venció o ya se usó. Pedí uno nuevo.' };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === 'same_password') return { fieldErrors: { password: 'La nueva contraseña debe ser distinta de la anterior.' } };
    return { error: 'No pudimos cambiar la contraseña. Intentá de nuevo.' };
  }
  redirect('/app');
}
