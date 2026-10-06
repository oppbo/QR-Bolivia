import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/database.types';

type Fns = Database['public']['Functions'];

/**
 * Llama a una función de la base de datos. Los tipos generados marcan como
 * obligatorios argumentos que aceptan NULL; este envoltorio permite pasar null
 * conservando el tipo de retorno.
 */
export async function callRpc<N extends keyof Fns>(
  supabase: SupabaseClient<Database>,
  name: N,
  args: { [K in keyof Fns[N]['Args']]?: Fns[N]['Args'][K] | null },
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (supabase.rpc as any)(name, args);
  return result as { data: Fns[N]['Returns'] | null; error: { code?: string; message?: string; details?: string } | null };
}
