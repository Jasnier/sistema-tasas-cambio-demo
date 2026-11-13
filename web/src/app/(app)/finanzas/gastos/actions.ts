"use server";

import { ejecutar, numero, revisar, texto, type EstadoAccion } from "@/lib/acciones";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

const RUTA = "/finanzas/gastos";

/** STW-55: registrar un gasto. El código G- y el período los pone la base. */
export async function crearGasto(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar(RUTA, async () => {
    await exigirPermiso("FINANZAS");
    const fecha = texto(fd, "fecha");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error("La fecha es obligatoria.");
    const valor = numero(fd, "valor");
    if (valor <= 0) throw new Error("El valor debe ser mayor que cero.");
    const supabase = await crearClienteServidor();
    const g = revisar(await supabase.from("gasto").insert({
      fecha, tipo: texto(fd, "tipo"), proveedor: texto(fd, "proveedor") || null, descripcion: texto(fd, "descripcion") || null,
      valor, empresa_id: texto(fd, "empresa_id") || null, tipo_abono: texto(fd, "tipo_abono") || null, oficina: texto(fd, "oficina") || null,
    }).select("id, periodo").single()) as { id: string; periodo: string };
    return `${g.id} registrado en ${g.periodo}.`;
  });
}

/** Un gasto no se edita ni se borra: se anula con motivo y se registra de nuevo. */
export async function anularGasto(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar(RUTA, async () => {
    await exigirPermiso("FINANZAS");
    const motivo = texto(fd, "motivo");
    if (motivo.length < 3) throw new Error("Escriba el motivo de la anulación.");
    const supabase = await crearClienteServidor();
    const r = await supabase.from("gasto").update({ estado: "ANULADO", anulado_motivo: motivo }).eq("id", texto(fd, "id")).select("id");
    if (r.error) throw r.error;
    if (!r.data?.length) throw new Error("No se pudo anular (¿ya estaba anulado?).");
    return `${r.data[0].id} anulado.`;
  });
}
