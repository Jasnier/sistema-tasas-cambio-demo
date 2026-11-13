"use server";

import { ejecutar, revisarSinDatos, texto, type EstadoAccion } from "@/lib/acciones";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/** P-1 / P-25: operador que atiende al cliente grande, su código CT y si tiene ganancias (auditado). */
export async function guardarCliente(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar("/admin/clientes", async () => {
    await exigirPermiso("GESTIONAR_CATALOGOS");
    const supabase = await crearClienteServidor();
    const r = await supabase.from("libro").update({
      operador_id: texto(fd, "operador_id") || null,
      contraparte_id: texto(fd, "contraparte_id") || null,
      usa_ganancias: fd.get("usa_ganancias") === "on",
      // STW-47: los retiros solo tienen sentido con ganancias
      usa_retiros: fd.get("usa_retiros") === "on" && fd.get("usa_ganancias") === "on",
    }).eq("id", texto(fd, "id")).eq("tipo", "cliente_grande").select("nombre");
    revisarSinDatos(traducir(r));
    if (!r.data?.length) throw new Error("No se pudo guardar (¿permiso?).");
    return `${r.data[0].nombre} guardado.`;
  });
}

/**
 * Nuevo libro de cliente grande. La administración elige a qué código CT van sus movimientos (el cliente ya no lo
 * escoge: su formulario lo trae fijo) y qué operador lo atiende. El usuario de acceso se asigna aparte (Usuarios).
 */
export async function crearCliente(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar("/admin/clientes", async () => {
    await exigirPermiso("GESTIONAR_CATALOGOS");
    const nombre = texto(fd, "nombre").replace(/\s+/g, " ");
    const prefijo = texto(fd, "prefijo").toUpperCase();
    const contraparte = texto(fd, "contraparte_id");
    if (nombre.length < 2) throw new Error("Escriba el nombre del cliente grande.");
    if (!/^[A-Z]{2,5}$/.test(prefijo)) throw new Error("El prefijo son de 2 a 5 letras (sin números ni tildes), por ejemplo LAZ.");
    if (!contraparte) throw new Error("Elija el código CT al que van los movimientos de este libro.");
    // Código interno del libro (como libro_origen de Sheets): el nombre en mayúsculas, sin tildes ni espacios
    const codigo = nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
    const supabase = await crearClienteServidor();
    const ganancias = fd.get("usa_ganancias") === "on";
    const r = await supabase.from("libro").insert({
      tipo: "cliente_grande", codigo, prefijo, nombre, contraparte_id: contraparte,
      operador_id: texto(fd, "operador_id") || null,
      usa_ganancias: ganancias, usa_retiros: ganancias && fd.get("usa_retiros") === "on",
    }).select("nombre, prefijo");
    revisarSinDatos(traducir(r));
    if (!r.data?.length) throw new Error("No se pudo crear (¿permiso?).");
    return `${r.data[0].nombre} creado: sus movimientos saldrán como ${r.data[0].prefijo}-0001, ${r.data[0].prefijo}-0002… Falta asignarle su usuario.`;
  });
}

/** Los choques con índices únicos de libro, dichos en palabras. */
function traducir<T extends { error: { message: string; code?: string } | null }>(r: T): T {
  if (r.error?.code !== "23505") return r;
  const m = r.error.message;
  const texto = /libro_cliente_grande_ct/.test(m) ? "Ese código CT ya pertenece a otro cliente grande activo."
    : /prefijo/.test(m) ? "Ese prefijo ya lo usa otro libro."
    : /codigo/.test(m) ? "Ya existe un libro con ese nombre."
    : m;
  return { ...r, error: { ...r.error, code: "P0001", message: texto } };
}
