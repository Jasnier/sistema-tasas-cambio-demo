"use server";

import { ejecutar, numero, revisar, revisarCambio, texto, type EstadoAccion } from "@/lib/acciones";
import { desdeInputBogota, leerRango, rango } from "@/lib/fechas";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/** P-5: el beneficio nuevo rige desde una fecha; el anterior se cierra justo antes. Los históricos no cambian. */
export async function cambiarBeneficio(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar("/beneficios", async () => {
    await exigirPermiso("GESTIONAR_CATALOGOS");
    const supabase = await crearClienteServidor();
    const desde = texto(fd, "desde") ? desdeInputBogota(texto(fd, "desde")) : new Date().toISOString();
    const nuevo = revisar(await supabase.rpc("cambiar_beneficio", {
      p_contraparte: texto(fd, "contraparte"),
      p_moneda_origen: texto(fd, "moneda_origen"),
      p_moneda_destino: texto(fd, "moneda_destino"),
      p_beneficio: numero(fd, "beneficio"),
      p_desde: desde,
    }));
    return `Beneficio ${(nuevo as { id: string }).id} vigente desde ${texto(fd, "desde") || "ahora"}.`;
  });
}

/** Termina un beneficio (deja de aplicar desde la fecha indicada). */
export async function terminarBeneficio(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar("/beneficios", async () => {
    await exigirPermiso("GESTIONAR_CATALOGOS");
    const supabase = await crearClienteServidor();
    const actual = revisar(await supabase.from("ajuste_cliente").select("vigencia").eq("id", texto(fd, "id")).single());
    const { desde } = leerRango(actual.vigencia as string);
    if (!desde) throw new Error("No se pudo leer la vigencia actual.");
    const hasta = texto(fd, "hasta") ? desdeInputBogota(texto(fd, "hasta")) : new Date().toISOString();
    revisarCambio(await supabase.from("ajuste_cliente").update({ vigencia: rango(desde, hasta) }).eq("id", texto(fd, "id")).select("id"),
      "No se pudo terminar el beneficio (sin permiso o ya no existe). Recargue la página.");
    return "Beneficio terminado.";
  });
}
