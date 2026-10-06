import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const res = NextResponse.redirect(new URL('/login?signedout=1', request.nextUrl.origin), { status: 303 });
  res.headers.set('Cache-Control', 'no-store');
  // Pide al navegador borrar datos en caché del sitio (las cookies de sesión ya se eliminaron).
  res.headers.set('Clear-Site-Data', '"cache"');
  return res;
}
