import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { safeNextPath } from '@/lib/auth/redirect';
import { createClient } from '@/lib/supabase/server';

// Destino de los enlaces de confirmación y recuperación de Supabase Auth.
// Soporta el flujo PKCE (?code=) y el de token_hash (?token_hash=&type=).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNextPath(searchParams.get('next'), '/app');
  const supabase = await createClient();

  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;

  let ok = false;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  }
  if (!ok) {
    return NextResponse.redirect(new URL('/login?error=link', origin));
  }
  return NextResponse.redirect(new URL(next, origin));
}
