"use server";

import { revalidatePath } from "next/cache";
import { ejecutar, revisar, revisarSinDatos, texto, type EstadoAccion } from "@/lib/acciones";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

const RUTA = "/brasil/bandeja";

/** P-18: marca EN_PROCESO a nombre del usuario; se libera solo a los 10 minutos. */
export async function tomar(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar(RUTA, async () => {
    await exigirPermiso("BRASIL_APROPIAR");
    const supabase = await crearClienteServidor();
    const c = revisar(await supabase.rpc("tomar_comprobante", { p_id: texto(fd, "id") })) as { codigo: string };
    return `${c.codigo} es suyo por 10 minutos: complete la apropiación abajo.`;
  });
}

export async function liberar(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar(RUTA, async () => {
    await exigirPermiso("BRASIL_APROPIAR");
    const supabase = await crearClienteServidor();
    revisarSinDatos(await supabase.rpc("liberar_comprobante", { p_id: texto(fd, "id") }));
    return "Liberado.";
  });
}

type Resultado = { codigo: string; movimiento: string; libro: string; parecido: boolean; cliente_grande: boolean };

/**
 * Apropia (STW-18, decisión "solo envío a web"): en una sola operación crea el movimiento BRS- en
 * BORRADOR en el libro destino y deja el comprobante APLICADO. Ya no se envía a los libros de Sheets.
 */
export async function apropiar(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar(RUTA, async () => {
    await exigirPermiso("BRASIL_APROPIAR");
    const hora = texto(fd, "hora");
    if (!/^\d{2}:\d{2}$/.test(hora)) throw new Error("La hora de la operación es obligatoria.");
    const supabase = await crearClienteServidor();
    const r = revisar(await supabase.rpc("apropiar_comprobante", {
      p_id: texto(fd, "id"), p_libro: texto(fd, "libro"), p_hora: hora, p_modalidad: texto(fd, "modalidad"),
      p_moneda_destino: texto(fd, "moneda_destino"), p_recibido_en: texto(fd, "recibido_en") || null,
      p_empresa: texto(fd, "empresa") || null, p_contraparte: texto(fd, "contraparte"),
    })) as Resultado;
    const siguiente = r.cliente_grande ? "su operador lo envía a verificación" : "queda en borrador para que el operador lo verifique";
    return `${r.codigo} apropiado: ${r.movimiento} en ${r.libro} (${siguiente}).${r.parecido ? " Ojo: hay otro movimiento parecido ese día (mismo cliente y monto)." : ""}`;
  });
}

/**
 * Corregir una apropiación (migración 2600): quien la hizo (o la administración) anula el BRS- con motivo y el
 * comprobante vuelve a su nombre para apropiarlo al libro correcto.
 */
export async function corregir(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar(RUTA, async () => {
    await exigirPermiso("BRASIL_APROPIAR");
    const supabase = await crearClienteServidor();
    const c = revisar(await supabase.rpc("corregir_apropiacion", { p_id: texto(fd, "id"), p_motivo: texto(fd, "motivo") })) as { codigo: string };
    return `${c.codigo}: el movimiento anterior quedó anulado y el comprobante es suyo por 10 minutos. Apropíelo al libro correcto arriba.`;
  });
}

/** Pedirle a quien lo apropió que lo libere (le llega en su Inicio y en la bandeja). */
export async function solicitarLiberacion(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar(RUTA, async () => {
    await exigirPermiso("BRASIL_APROPIAR");
    const supabase = await crearClienteServidor();
    revisarSinDatos(await supabase.rpc("solicitar_liberacion", { p_id: texto(fd, "id"), p_motivo: texto(fd, "motivo") }));
    return "Solicitud enviada: le avisaremos aquí cuando la respondan.";
  });
}

/** Aceptar o rechazar una solicitud de liberación (rechazar pide motivo). */
export async function responderLiberacion(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar(RUTA, async () => {
    await exigirPermiso("BRASIL_APROPIAR");
    const aceptar = texto(fd, "aceptar") === "1";
    const supabase = await crearClienteServidor();
    revisarSinDatos(await supabase.rpc("responder_liberacion", {
      p_solicitud: texto(fd, "solicitud"), p_aceptar: aceptar, p_respuesta: texto(fd, "motivo") || null,
    }));
    revalidatePath("/");
    return aceptar ? "Liberado: el comprobante pasó a quien lo pidió y el movimiento anterior quedó anulado." : "Solicitud rechazada.";
  });
}
