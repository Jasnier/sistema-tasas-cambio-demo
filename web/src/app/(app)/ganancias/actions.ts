"use server";

import { ejecutar, numero, revisar, texto, type EstadoAccion } from "@/lib/acciones";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/** P-20: recalcular ganancias de un cliente (solo superadmin). Si algo no cuadra, deja AJUSTES; nunca reescribe. */
export async function recalcularGanancias(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar("/ganancias", async () => {
    await exigirPermiso("RECALCULAR_GANANCIAS");
    const supabase = await crearClienteServidor();
    const r = revisar(await supabase.rpc("recalcular_ganancias", { p_libro: texto(fd, "libro") })) as { ajustes: number };
    return r.ajustes ? `Recalculado: ${r.ajustes} ajuste(s) agregados a la caja.` : "Recalculado: todo cuadraba, no hubo cambios.";
  });
}

/** STW-45: retiro de la caja (cliente o administración). Monto con decimales, no mayor que lo disponible. */
export async function registrarRetiro(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar("/ganancias", async () => {
    await exigirPermiso("REGISTRAR_RETIRO");
    const supabase = await crearClienteServidor();
    const r = revisar(await supabase.rpc("registrar_retiro", {
      p_libro: texto(fd, "libro"), p_monto: numero(fd, "monto"), p_descripcion: texto(fd, "descripcion"),
    })) as { codigo: string };
    return `${r.codigo} registrado.`;
  });
}

/** Anular un retiro mal registrado: entra un ajuste por el mismo valor (solo administración). */
export async function anularRetiro(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar("/ganancias", async () => {
    await exigirPermiso("APROBAR_MOVIMIENTO");
    const supabase = await crearClienteServidor();
    const r = revisar(await supabase.rpc("anular_retiro", { p_codigo: texto(fd, "codigo"), p_motivo: texto(fd, "motivo") })) as { codigo: string };
    return `Retiro anulado (${r.codigo}).`;
  });
}
