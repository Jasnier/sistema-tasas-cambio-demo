import { NextResponse, type NextRequest } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * Cierra la sesión y borra las cookies de Supabase. Lo usa obtenerSesion cuando la cookie trae un
 * token válido pero el usuario ya no existe o está inactivo (p. ej. después de `supabase db reset`
 * en local). Una página del servidor no puede borrar cookies; un Route Handler sí. Sin esto el
 * proxy (que solo valida la firma del token) y la página se mandan el uno al otro en bucle.
 */
export async function GET(request: NextRequest) {
  const supabase = await crearClienteServidor();
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);

  const destino = new URL("/login", request.url);
  if (request.nextUrl.searchParams.get("inactivo") === "1") destino.searchParams.set("inactivo", "1");
  const res = NextResponse.redirect(destino);
  // Por si signOut no pudo hablar con Auth (usuario borrado): borrar igual las cookies de sesión
  for (const c of request.cookies.getAll()) {
    if (c.name.startsWith("sb-")) res.cookies.set(c.name, "", { path: "/", maxAge: 0 });
  }
  return res;
}
