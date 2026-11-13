"use server";

import { revalidatePath } from "next/cache";
import { ejecutar, revisar, revisarSinDatos, texto, type EstadoAccion } from "@/lib/acciones";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { dinero } from "@/components/ui";

/** STW-37: cerrar un período terminado. Lo que se apruebe después con fecha de ese mes va al siguiente abierto. */
export async function cerrar(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar("/admin/periodos", async () => {
    await exigirPermiso("CERRAR_PERIODO");
    const supabase = await crearClienteServidor();
    const r = revisar(await supabase.rpc("cerrar_periodo", { p_id: texto(fd, "id") })) as
      { periodo: string; utilidad_total: number; movimientos: number; pendientes_al_siguiente: number };
    revalidatePath("/finanzas", "layout");
    return `${r.periodo} cerrado: ${r.movimientos} movimientos, utilidad ${dinero(r.utilidad_total)}.` +
      (r.pendientes_al_siguiente ? ` ${r.pendientes_al_siguiente} sin aprobar con fecha de ese mes irán al siguiente período abierto.` : "");
  });
}

/** Reabrir: solo superadmin, con motivo (queda en auditoría). */
export async function reabrir(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar("/admin/periodos", async () => {
    await exigirPermiso("CERRAR_PERIODO");
    const supabase = await crearClienteServidor();
    revisarSinDatos(await supabase.rpc("reabrir_periodo", { p_id: texto(fd, "id"), p_motivo: texto(fd, "motivo") }));
    return `${texto(fd, "id")} reabierto.`;
  });
}
