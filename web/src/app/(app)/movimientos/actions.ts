"use server";

import { revalidatePath } from "next/cache";
import { ejecutar, numero, revisar, texto, type EstadoAccion } from "@/lib/acciones";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

const RUTA = "/movimientos";

/** Bandeja, detalle e Inicio muestran el mismo movimiento: se refresca todo el árbol. */
function refrescar() {
  revalidatePath(RUTA, "layout");
  revalidatePath("/");
}

/** Estado del formulario de movimiento: además del mensaje, el aviso de posible duplicado (STW-25). */
export type EstadoMovimiento = EstadoAccion & { duplicados?: string; codigo?: string; id?: string };

function datos(fd: FormData) {
  return {
    libro_id: texto(fd, "libro_id"),
    id_transaccion: texto(fd, "id_transaccion"),
    tipo: texto(fd, "tipo"),
    fecha: texto(fd, "fecha"),
    hora: texto(fd, "hora"),
    modalidad: texto(fd, "modalidad"),
    contraparte_id: texto(fd, "contraparte_id"),
    moneda_origen: texto(fd, "moneda_origen"),
    moneda_destino: texto(fd, "moneda_destino"),
    // parsearNumero rechaza lo ambiguo ("4.100"); se manda como texto para no perder decimales
    monto_origen: String(numero(fd, "monto_origen")),
    recibido_en_id: texto(fd, "recibido_en_id"),
    empresa_id: texto(fd, "empresa_id"),
    tercero: texto(fd, "tercero"),
    observaciones: texto(fd, "observaciones"),
    descuento_tasa: fd.get("descuento_tasa") === "on",
  };
}

/** Si la base avisó de un posible duplicado, se devuelve la lista para que la persona confirme. */
async function conAvisoDeDuplicado(cuerpo: () => Promise<string>, rutaExtra?: string): Promise<EstadoMovimiento> {
  let duplicados: string | undefined;
  const r = await ejecutar(rutaExtra ?? RUTA, async () => {
    try {
      return await cuerpo();
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? "";
      if (msg.startsWith("POSIBLE_DUPLICADO:")) {
        duplicados = msg.slice("POSIBLE_DUPLICADO:".length).trim();
        throw new Error("Se parece a un movimiento ya registrado. Revíselo y confirme si es otro distinto.");
      }
      throw e;
    }
  });
  return { ...r, duplicados };
}

/** STW-22: registrar. El código lo pone la base con el consecutivo del libro. */
export async function crearMovimiento(_p: EstadoMovimiento, fd: FormData): Promise<EstadoMovimiento> {
  let creado: { id: string; codigo: string } | undefined;
  const r = await conAvisoDeDuplicado(async () => {
    await exigirPermiso("REGISTRAR_MOVIMIENTO");
    const supabase = await crearClienteServidor();
    creado = revisar(await supabase.rpc("crear_movimiento", {
      p: datos(fd), p_confirmar_duplicado: fd.get("confirmar_duplicado") === "on",
    })) as { id: string; codigo: string };
    refrescar();
    return `${creado.codigo} registrado como borrador.`;
  });
  return { ...r, codigo: creado?.codigo, id: creado?.id };
}

/** Corregir un borrador (T-3: verificado o enviado no lo cambia el operador). */
export async function editarMovimiento(_p: EstadoMovimiento, fd: FormData): Promise<EstadoMovimiento> {
  const id = texto(fd, "id");
  return conAvisoDeDuplicado(async () => {
    await exigirPermiso("REGISTRAR_MOVIMIENTO");
    const supabase = await crearClienteServidor();
    const m = revisar(await supabase.rpc("editar_movimiento", {
      p_id: id, p: datos(fd), p_confirmar_duplicado: fd.get("confirmar_duplicado") === "on",
    })) as { codigo: string };
    refrescar();
    return `${m.codigo} actualizado.`;
  }, `${RUTA}/${id}`);
}

type ResultadoLote = { hechos: string[]; omitidos: { codigo: string; motivo: string }[] };

function resumen(accion: string, r: ResultadoLote): string {
  const partes = [];
  if (r.hechos.length) partes.push(`${accion}: ${r.hechos.length} (${r.hechos.slice(0, 8).join(", ")}${r.hechos.length > 8 ? "…" : ""})`);
  if (r.omitidos.length) partes.push(`Omitidos: ${r.omitidos.map((o) => `${o.codigo} ${o.motivo}`).slice(0, 6).join("; ")}${r.omitidos.length > 6 ? "…" : ""}`);
  return partes.join(". ") || "Nada que hacer.";
}

/** STW-24 + T-12: verificar o desbloquear lo seleccionado en la bandeja (botón con name="op"). */
export async function accionLote(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar(RUTA, async () => {
    const op = texto(fd, "op");
    await exigirPermiso(op === "rechazar" ? "RECHAZAR_MOVIMIENTO" : op.startsWith("masivo") ? "EDITAR_MOVIMIENTOS_MASIVO"
      : op === "enviar" ? "REGISTRAR_MOVIMIENTO" : "VERIFICAR_MOVIMIENTO");
    const ids = fd.getAll("ids").map(String).filter((s) => /^[0-9a-f-]{36}$/i.test(s));
    if (!ids.length) throw new Error("Seleccione al menos un movimiento.");
    const supabase = await crearClienteServidor();
    refrescar();
    if (op === "verificar") {
      const r = revisar(await supabase.rpc("verificar_movimientos", { p_ids: ids })) as ResultadoLote;
      if (!r.hechos.length) throw new Error(resumen("Verificados", r));
      return resumen("Verificados", r);
    }
    if (op === "desbloquear") {
      const r = revisar(await supabase.rpc("desbloquear_movimientos", { p_ids: ids, p_motivo: texto(fd, "motivo_desbloquear") })) as ResultadoLote;
      if (!r.hechos.length) throw new Error(resumen("Desbloqueados", r));
      return resumen("Desbloqueados", r);
    }
    if (op === "enviar") {
      // STW-42: el operador envía a verificación lo que su cliente grande registró en su libro
      const r = revisar(await supabase.rpc("enviar_registros_cliente", { p_ids: ids })) as ResultadoLote;
      revalidatePath("/portal");
      if (!r.hechos.length) throw new Error(resumen("Enviados", r));
      return resumen("Enviados a verificación", r);
    }
    if (op === "masivo_simular" || op === "masivo_aplicar") {
      // STW-62: modalidad o moneda destino de varios aprobados a la vez, con recálculo de saldos
      const campo = texto(fd, "masivo_campo");
      const valor = texto(fd, "masivo_valor");
      if (!["modalidad", "moneda_destino"].includes(campo) || !valor) throw new Error("Elija qué cambiar y el valor nuevo.");
      const simular = op === "masivo_simular";
      const { data, error } = await supabase.rpc("corregir_masivo", {
        p_ids: ids, p_cambios: { [campo]: valor }, p_motivo: texto(fd, "motivo_masivo"),
        p_confirmar_negativo: fd.get("confirmar_negativo") === "on", p_simular: simular,
      });
      if (error) throw new Error(error.message.replace(/^SALDO_NEGATIVO:\s*/, "Atención: "));
      const r = data as { corregidos: number; negativos: { contraparte_id: string; moneda: string; primer_negativo: string }[];
        resultados: { codigo: string; antes: { monto_destino: number }; despues: { monto_destino: number } }[] };
      if (!simular) { revalidatePath("/saldos"); revalidatePath("/estado-cuenta"); }
      const neg = r.negativos.length ? ` Ojo: queda negativo ${r.negativos.map((n) => `${n.contraparte_id} ${n.moneda} desde ${n.primer_negativo}`).join(", ")}.` : "";
      return `${simular ? "Vista previa (no se guardó): se corregirían" : "Corregidos"} ${r.corregidos}: ` +
        r.resultados.slice(0, 6).map((x) => `${x.codigo} ${Number(x.antes.monto_destino).toLocaleString("es-CO")} → ${Number(x.despues.monto_destino).toLocaleString("es-CO")}`).join("; ") + "." + neg;
    }
    if (op === "rechazar") {
      const r = revisar(await supabase.rpc("rechazar_movimientos", { p_ids: ids, p_motivo: texto(fd, "motivo_rechazar") })) as ResultadoLote;
      if (!r.hechos.length) throw new Error(resumen("Rechazados", r));
      return resumen("Rechazados", r);
    }
    throw new Error("Acción no válida.");
  });
}

/**
 * STW-36: anular (no borra). Si estaba aprobado, la base recalcula ya los saldos posteriores del
 * cliente; si alguno queda negativo, pide marcar la confirmación (P-33).
 */
export async function anularMovimiento(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, "id");
  return ejecutar(`${RUTA}/${id}`, async () => {
    await exigirPermiso("ANULAR_MOVIMIENTO");
    const supabase = await crearClienteServidor();
    const { data, error } = await supabase.rpc("anular_movimiento", {
      p_id: id, p_motivo: texto(fd, "motivo"), p_confirmar_negativo: fd.get("confirmar_negativo") === "on",
    });
    if (error) throw new Error(error.message.replace(/^SALDO_NEGATIVO:\s*/, "Atención: "));
    refrescar();
    revalidatePath("/saldos");
    const r = data as { codigo: string; recalculo: { saldo: number; actualizados: number } | null };
    return r.recalculo
      ? `${r.codigo} anulado. Saldo del cliente recalculado (${r.recalculo.actualizados} movimiento(s) posteriores ajustados).`
      : `${r.codigo} anulado.`;
  });
}

/** Descartar un borrador: queda ANULADO con motivo (nada se borra). */
export async function anularBorrador(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const id = texto(fd, "id");
  return ejecutar(`${RUTA}/${id}`, async () => {
    await exigirPermiso("REGISTRAR_MOVIMIENTO");
    const supabase = await crearClienteServidor();
    const m = revisar(await supabase.rpc("anular_borrador", { p_id: id, p_motivo: texto(fd, "motivo") })) as { codigo: string };
    refrescar();
    return `${m.codigo} anulado.`;
  });
}
