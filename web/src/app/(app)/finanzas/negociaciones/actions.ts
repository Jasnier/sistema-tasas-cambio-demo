"use server";

import { ejecutar, numero, revisar, texto, type EstadoAccion } from "@/lib/acciones";
import { parsearNumero } from "@/lib/numeros";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

const RUTA = "/finanzas/negociaciones";
const opcional = (fd: FormData, k: string) => (texto(fd, k) ? parsearNumero(texto(fd, k), k) : null);

/** STW-56: registrar una negociación (NEG- propio, período por fecha). */
export async function crearNegociacion(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar(RUTA, async () => {
    await exigirPermiso("FINANZAS");
    const fecha = texto(fd, "fecha");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error("La fecha es obligatoria.");
    const supabase = await crearClienteServidor();
    const n = revisar(await supabase.from("negociacion").insert({
      fecha, cliente: texto(fd, "cliente"), contraparte_id: texto(fd, "contraparte_id") || null, moneda: texto(fd, "moneda"),
      valor: numero(fd, "valor"), peso: opcional(fd, "peso"), utilidad: opcional(fd, "utilidad"),
      responsable: texto(fd, "responsable") || null, observacion: texto(fd, "observacion") || null,
    }).select("id, periodo").single()) as { id: string; periodo: string };
    return `${n.id} registrada en ${n.periodo}.`;
  });
}

export async function anularNegociacion(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar(RUTA, async () => {
    await exigirPermiso("FINANZAS");
    const motivo = texto(fd, "motivo");
    if (motivo.length < 3) throw new Error("Escriba el motivo de la anulación.");
    const supabase = await crearClienteServidor();
    const r = await supabase.from("negociacion").update({ estado: "ANULADO", anulado_motivo: motivo }).eq("id", texto(fd, "id")).select("id");
    if (r.error) throw r.error;
    if (!r.data?.length) throw new Error("No se pudo anular.");
    return `${r.data[0].id} anulada.`;
  });
}
