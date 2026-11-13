"use server";

import { revalidatePath } from "next/cache";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/** Activa o quita un permiso a un rol. RLS + trigger protegen lo que solo el superadmin puede tocar. */
export async function alternarPermisoRol(formData: FormData) {
  await exigirPermiso("GESTIONAR_ROLES");
  const rol = String(formData.get("rol"));
  const permiso = String(formData.get("permiso"));
  const activo = formData.get("activo") === "1";
  const supabase = await crearClienteServidor();

  const { error } = activo
    ? await supabase.from("rol_permiso").delete().eq("rol_id", rol).eq("permiso", permiso)
    : await supabase.from("rol_permiso").insert({ rol_id: rol, permiso });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/roles");
}

/** P-30: ceder un permiso a una persona concreta. */
export async function delegarPermiso(formData: FormData) {
  const sesion = await exigirPermiso("GESTIONAR_ROLES");
  const usuario = String(formData.get("usuario"));
  const permiso = String(formData.get("permiso"));
  const supabase = await crearClienteServidor();
  const { error } = await supabase
    .from("usuario_permiso")
    .insert({ usuario_id: usuario, permiso, otorgado_por: sesion.id });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/roles");
}

export async function retirarPermisoDelegado(formData: FormData) {
  await exigirPermiso("GESTIONAR_ROLES");
  const supabase = await crearClienteServidor();
  const { error } = await supabase
    .from("usuario_permiso")
    .delete()
    .eq("usuario_id", String(formData.get("usuario")))
    .eq("permiso", String(formData.get("permiso")));
  if (error) throw new Error(error.message);
  revalidatePath("/admin/roles");
}
