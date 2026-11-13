"use server";

import { revalidatePath } from "next/cache";
import { ejecutar, revisar, texto, type EstadoAccion } from "@/lib/acciones";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { dinero } from "@/components/ui";

/** STW-33: recalcular un saldo completo en orden de aprobación (solo superadmin; queda en auditoría). */
export async function recalcular(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar("/saldos", async () => {
    await exigirPermiso("RECALCULAR_BUCKET");
    const supabase = await crearClienteServidor();
    const r = revisar(await supabase.rpc("recalcular_bucket", {
      p_ct: texto(fd, "ct"), p_moneda: texto(fd, "moneda"), p_modalidad: texto(fd, "modalidad"),
    })) as { saldo: number; movimientos: number; actualizados: number; primer_negativo: string | null };
    revalidatePath("/movimientos", "layout");
    return `Recalculado: ${r.movimientos} movimientos, ${r.actualizados} ajustados, saldo ${dinero(r.saldo)}` +
      (r.primer_negativo ? `. Ojo: queda negativo desde ${r.primer_negativo}.` : ".");
  });
}
