"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { parsearNumero } from "@/lib/numeros";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type ResultadoAjuste = {
  error?: string; simulado?: boolean; ajustados?: number; utilidad_antes?: number; utilidad_despues?: number; diferencia?: number;
  resultados?: { id: string; codigo: string; utilidad_antes: number; utilidad_despues: number; tasa_adq_antes: number; tasa_adq_despues: number }[];
  omitidos?: { codigo: string; motivo: string }[]; t?: number;
};

/** STW-34: quitar la utilidad o restar X puntos, solo sobre lo seleccionado (P-35). Con vista previa. */
export async function ajustar(_p: ResultadoAjuste, fd: FormData): Promise<ResultadoAjuste> {
  try {
    await exigirPermiso("AJUSTAR_UTILIDAD");
    const ids = fd.getAll("ids").map(String).filter((s) => /^[0-9a-f-]{36}$/i.test(s));
    const modo = String(fd.get("modo") ?? "");
    const puntosTxt = String(fd.get("puntos") ?? "").trim();
    const puntos = modo === "RESTAR" ? parsearNumero(puntosTxt, "puntos") : null;
    const simular = fd.get("op") !== "aplicar";
    const supabase = await crearClienteServidor();
    const { data, error } = await supabase.rpc("ajustar_utilidad", {
      p_ids: ids, p_modo: modo, p_puntos: puntos, p_motivo: String(fd.get("motivo") ?? "").trim(), p_simular: simular,
    });
    if (error) return { error: error.message, t: Date.now() };
    if (!simular) { revalidatePath("/admin/utilidad"); revalidatePath("/movimientos", "layout"); revalidatePath("/finanzas", "layout"); }
    return { ...(data as ResultadoAjuste), t: Date.now() };
  } catch (e) {
    // redirect() de exigirPermiso (sesión vencida, permiso retirado) no es un error de la acción
    unstable_rethrow(e);
    return { error: (e as Error).message, t: Date.now() };
  }
}
