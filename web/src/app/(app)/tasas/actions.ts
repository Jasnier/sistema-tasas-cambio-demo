"use server";

import { ejecutar, numero, revisar, revisarCambio, revisarSinDatos, texto, type EstadoAccion } from "@/lib/acciones";
import { desdeInputBogota, leerRango, rango } from "@/lib/fechas";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

type Tabla = "tasa_cliente" | "tasa_utilidad";
const tabla = (fd: FormData): Tabla => (texto(fd, "tabla") === "tasa_utilidad" ? "tasa_utilidad" : "tasa_cliente");
const hastaDe = (fd: FormData) => (texto(fd, "hasta") ? desdeInputBogota(texto(fd, "hasta")) : "infinity");

/** Crea un borrador (MODIFICABLE). Se publica aparte con "Publicar", que valida cruces. */
export async function crearTasa(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar("/tasas", async () => {
    await exigirPermiso("GESTIONAR_TASAS");
    const t = tabla(fd);
    const desde = desdeInputBogota(texto(fd, "desde"));
    const hasta = hastaDe(fd);
    if (hasta !== "infinity" && Date.parse(hasta) <= Date.parse(desde)) throw new Error("\"Hasta\" debe ser posterior a \"desde\".");
    const base = { moneda_origen: texto(fd, "moneda_origen"), moneda_destino: texto(fd, "moneda_destino"), vigencia: rango(desde, hasta) };
    const fila: Record<string, unknown> = t === "tasa_cliente"
      ? { ...base, modalidad: texto(fd, "modalidad"), valor: numero(fd, "valor") }
      : { ...base, puntos_efectivo: numero(fd, "puntos_efectivo"), puntos_transferencia: numero(fd, "puntos_transferencia") };
    const supabase = await crearClienteServidor();
    const creada = revisar(await supabase.from(t).insert(fila).select("id").single());
    return `Borrador ${creada.id} creado. Revísalo y publícalo.`;
  });
}

export async function publicarTasa(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar("/tasas", async () => {
    await exigirPermiso("GESTIONAR_TASAS");
    const t = tabla(fd);
    const supabase = await crearClienteServidor();
    revisarSinDatos(await supabase.rpc(t === "tasa_cliente" ? "cerrar_tasa" : "cerrar_utilidad", {
      p_id: texto(fd, "id"), p_recortar_anterior: fd.get("recortar") === "on",
    }));
    return `${texto(fd, "id")} publicada.`;
  });
}

export async function borrarBorrador(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar("/tasas", async () => {
    await exigirPermiso("GESTIONAR_TASAS");
    const supabase = await crearClienteServidor();
    revisarCambio(await supabase.from(tabla(fd)).delete().eq("id", texto(fd, "id")).eq("estado", "MODIFICABLE").select("id"),
      "No se eliminó: ya no es un borrador (¿alguien la publicó?). Recargue la página.");
    return "Borrador eliminado.";
  });
}

/** En una tasa publicada solo cambia "hasta" (acortarla al pasado: solo superadmin, lo valida la base). */
export async function cambiarHasta(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar("/tasas", async () => {
    await exigirPermiso("GESTIONAR_TASAS");
    const t = tabla(fd);
    const supabase = await crearClienteServidor();
    const actual = revisar(await supabase.from(t).select("vigencia").eq("id", texto(fd, "id")).single());
    const { desde } = leerRango(actual.vigencia as string);
    if (!desde) throw new Error("No se pudo leer la vigencia actual.");
    revisarCambio(await supabase.from(t).update({ vigencia: rango(desde, hastaDe(fd)) }).eq("id", texto(fd, "id")).select("id"),
      "No se pudo cambiar la vigencia (sin permiso o ya no existe). Recargue la página.");
    return "Vigencia actualizada.";
  });
}
