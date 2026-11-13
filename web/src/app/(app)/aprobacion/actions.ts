"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type ResultadoAprobacion = {
  id: string; codigo: string; ok: boolean; error?: string; tasa?: number; monto_destino?: number;
  moneda_destino?: string; tipo?: string; saldo_anterior?: number; saldo_post?: number; utilidad?: number;
};
export type EstadoAprobacion = {
  error?: string; simulado?: boolean; aprobados?: number; con_error?: number; resultados?: ResultadoAprobacion[]; t?: number;
};

/**
 * STW-29: vista previa o aprobación de lo seleccionado. La base hace todo (tasa vigente, cálculo, saldo
 * del bucket con bloqueo); cada movimiento se aprueba o falla solo, como hoy responde el libro madre.
 */
export async function aprobar(_p: EstadoAprobacion, fd: FormData): Promise<EstadoAprobacion> {
  try {
    await exigirPermiso("APROBAR_MOVIMIENTO");
    const ids = fd.getAll("ids").map(String).filter((s) => /^[0-9a-f-]{36}$/i.test(s));
    if (!ids.length) return { error: "Seleccione al menos un movimiento.", t: Date.now() };
    const simular = fd.get("op") !== "aprobar";
    const supabase = await crearClienteServidor();
    const { data, error } = await supabase.rpc("aprobar_movimientos", { p_ids: ids, p_simular: simular });
    if (error) return { error: error.message, t: Date.now() };
    if (!simular) {
      revalidatePath("/aprobacion");
      revalidatePath("/movimientos", "layout");
      revalidatePath("/saldos");
      revalidatePath("/");
    }
    return { ...(data as EstadoAprobacion), t: Date.now() };
  } catch (e) {
    // redirect() de exigirPermiso (sesión vencida, permiso retirado) no es un error de la acción
    unstable_rethrow(e);
    return { error: (e as Error).message ?? String(e), t: Date.now() };
  }
}
