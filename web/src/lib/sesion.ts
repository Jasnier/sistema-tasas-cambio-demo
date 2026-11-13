import { redirect } from "next/navigation";
import { cache } from "react";
import { crearClienteServidor } from "@/lib/supabase/server";

export type Sesion = {
  id: string;
  correo: string;
  nombre: string;
  roles: string[];
  permisos: Set<string>;
  esSuperadmin: boolean;
};

/**
 * Usuario actual con roles y permisos (una vez por request).
 * Si la cookie no corresponde a un usuario real (borrado o inactivo), va a /salir, que borra la cookie
 * y lleva a /login. Ir directo a /login haría un bucle: el proxy ve un token válido y devuelve a "/".
 */
export const obtenerSesion = cache(async (): Promise<Sesion> => {
  const supabase = await crearClienteServidor();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/salir");

  const [{ data: perfil }, { data: roles }, { data: permisos }] = await Promise.all([
    supabase.from("usuario").select("nombre, correo, activo").eq("id", auth.user.id).single(),
    supabase.from("usuario_rol").select("rol_id").eq("usuario_id", auth.user.id),
    supabase.rpc("mis_permisos"),
  ]);

  if (!perfil?.activo) redirect("/salir?inactivo=1");

  const listaRoles = (roles ?? []).map((r) => r.rol_id as string);
  return {
    id: auth.user.id,
    correo: perfil.correo,
    nombre: perfil.nombre,
    roles: listaRoles,
    permisos: new Set((permisos as string[] | null) ?? []),
    esSuperadmin: listaRoles.includes("superadmin"),
  };
});

/** Corta la página si el usuario no tiene el permiso. */
export async function exigirPermiso(codigo: string): Promise<Sesion> {
  const sesion = await obtenerSesion();
  if (!sesion.permisos.has(codigo)) redirect("/?sin_permiso=" + encodeURIComponent(codigo));
  return sesion;
}
