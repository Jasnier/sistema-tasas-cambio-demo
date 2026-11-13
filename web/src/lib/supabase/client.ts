import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let cliente: SupabaseClient | undefined;

/**
 * Cliente de Supabase para el navegador (Client Components). Toma la sesión de las mismas cookies que el
 * servidor, así Realtime aplica la RLS del usuario que inició sesión. Uno solo por pestaña.
 */
export function crearClienteNavegador(): SupabaseClient {
  cliente ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
  return cliente;
}
