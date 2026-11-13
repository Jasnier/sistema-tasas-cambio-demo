"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { parsearNumero } from "@/lib/numeros";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

type Lado = { tasa: number; monto_destino: number; moneda_destino: string; modalidad: string; contraparte_id: string; utilidad: number | null };
export type ResultadoCorreccion = {
  error?: string; simulado?: boolean; corregidos?: number; t?: number;
  resultados?: { id: string; codigo: string; antes: Lado; despues: Lado; saldo_post: number }[];
  saldos?: { contraparte_id: string; moneda: string; modalidad: string; saldo: number; primer_negativo: string | null }[];
  negativos?: { contraparte_id: string; moneda: string; modalidad: string; primer_negativo: string; saldo_negativo: number }[];
};

const limpiar = (m: string) => m.replace(/^SALDO_NEGATIVO:\s*/, "Atención: ");

function refrescar() {
  revalidatePath("/movimientos", "layout");
  revalidatePath("/saldos");
  revalidatePath("/estado-cuenta");
  revalidatePath("/finanzas", "layout");
}

/** STW-35: corregir fecha, hora, modalidad, monedas, monto o cliente de un aprobado (recalcula todo). */
export async function corregir(_p: ResultadoCorreccion, fd: FormData): Promise<ResultadoCorreccion> {
  try {
    await exigirPermiso("CORREGIR_MOVIMIENTO");
    const cambios: Record<string, string> = {};
    const orig = (k: string) => String(fd.get(`orig_${k}`) ?? "");
    for (const k of ["fecha", "hora", "modalidad", "moneda_origen", "moneda_destino", "contraparte_id"]) {
      const v = String(fd.get(k) ?? "").trim();
      if (v && v !== orig(k)) cambios[k] = v;
    }
    const monto = String(fd.get("monto_origen") ?? "").trim();
    if (monto && parsearNumero(monto, "monto") !== Number(orig("monto_origen"))) cambios.monto_origen = String(parsearNumero(monto, "monto"));
    if (cambios.fecha || cambios.hora) { cambios.fecha ??= orig("fecha"); cambios.hora ??= orig("hora"); }
    if (!Object.keys(cambios).length) return { error: "No cambió ningún dato.", t: Date.now() };
    const simular = fd.get("op") !== "aplicar";
    const supabase = await crearClienteServidor();
    const { data, error } = await supabase.rpc("corregir_movimiento", {
      p_id: String(fd.get("id")), p_cambios: cambios, p_motivo: String(fd.get("motivo") ?? "").trim(),
      p_confirmar_negativo: fd.get("confirmar_negativo") === "on", p_simular: simular,
    });
    if (error) return { error: limpiar(error.message), t: Date.now() };
    if (!simular) refrescar();
    return { ...(data as ResultadoCorreccion), t: Date.now() };
  } catch (e) {
    // redirect() de exigirPermiso (sesión vencida, permiso retirado) no es un error de la acción
    unstable_rethrow(e);
    return { error: limpiar((e as Error).message), t: Date.now() };
  }
}
