import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";

/** Cliente de Supabase para Server Components, Server Actions y Route Handlers. */
export async function crearClienteServidor() {
  // Supabase usa la hora actual (Date.now) para ver si la sesión venció. Con Cache Components, Next.js
  // primero arma la página con las cookies pero sin "la hora": connection() le dice que esta página
  // se arma en cada petición, y así no aparece el aviso "unstable value Date.now()".
  await connection();
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Llamado desde un Server Component: el proxy ya refresca la sesión.
          }
        },
      },
    },
  );
}
