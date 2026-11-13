"use server";

import { ejecutar, numero, revisarCambio, revisarSinDatos, texto, type EstadoAccion } from "@/lib/acciones";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { catalogoPorTabla } from "./config";

function filaDesdeForm(fd: FormData) {
  const cat = catalogoPorTabla(texto(fd, "tabla"));
  const fila: Record<string, unknown> = { nombre: texto(fd, "nombre") };
  if (cat.conOrden) fila.orden = texto(fd, "orden") ? numero(fd, "orden") : null;
  if (cat.conTipo) fila.tipo = texto(fd, "tipo") || "CLIENTE";
  if (cat.conDescuento) {
    fila.descuento_fijo = texto(fd, "descuento_fijo") ? numero(fd, "descuento_fijo") : 0;
    fila.descuento_moneda = texto(fd, "descuento_moneda") || null;
  }
  return { cat, fila };
}

export async function crearItem(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar("/catalogos", async () => {
    await exigirPermiso("GESTIONAR_CATALOGOS");
    const { cat, fila } = filaDesdeForm(fd);
    if (!fila.nombre) throw new Error("El nombre es obligatorio.");
    // Código vacío = la base asigna el siguiente (migración 2200)
    const id = texto(fd, "id").toUpperCase() || undefined;
    const supabase = await crearClienteServidor();
    const r = await supabase.from(cat.tabla).insert({ ...(id ? { id } : {}), ...fila }).select("id").single();
    revisarSinDatos(r);
    return `${cat.titulo}: ${r.data?.id ?? id} creado.`;
  });
}

export async function editarItem(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar("/catalogos", async () => {
    await exigirPermiso("GESTIONAR_CATALOGOS");
    const { cat, fila } = filaDesdeForm(fd);
    const supabase = await crearClienteServidor();
    revisarCambio(await supabase.from(cat.tabla).update(fila).eq("id", texto(fd, "id")).select("id"), "No se actualizó: el registro ya no existe o no tiene permiso.");
    return "Actualizado.";
  });
}

/** Nada se borra: se activa o desactiva. */
export async function alternarActivo(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar("/catalogos", async () => {
    await exigirPermiso("GESTIONAR_CATALOGOS");
    const cat = catalogoPorTabla(texto(fd, "tabla"));
    const supabase = await crearClienteServidor();
    revisarCambio(await supabase.from(cat.tabla).update({ activo: texto(fd, "activo") !== "1" }).eq("id", texto(fd, "id")).select("id"),
      "No se cambió: el registro ya no existe o no tiene permiso.");
    return texto(fd, "activo") === "1" ? "Desactivado." : "Activado.";
  });
}
