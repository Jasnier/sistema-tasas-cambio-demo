"use server";

import { ejecutar, numero, revisar, texto, type EstadoAccion } from "@/lib/acciones";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

const RUTA = "/brasil";

/** Guarda un comprobante (solo la información: hoy no se cargan archivos ni fotos). */
export async function guardarComprobante(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  return ejecutar(RUTA, async () => {
    await exigirPermiso("BRASIL_CARGAR");
    const banco = texto(fd, "banco");
    const fecha = texto(fd, "fecha");
    const idTx = texto(fd, "id_tx");
    // El saldo inicial de cada mes no se carga: lo calcula el sistema con el cierre del mes anterior.
    // Una venta a Binance siempre es salida (hoja de Paula, col E/F).
    const clase = texto(fd, "clase") === "BINANCE" ? "BINANCE" : "COMPROBANTE";
    const tipo = clase === "BINANCE" ? "SALIDA" : texto(fd, "tipo");
    if (!banco) throw new Error("Elija el banco.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error("La fecha es obligatoria.");
    if (tipo !== "ENTRADA" && tipo !== "SALIDA") throw new Error("Elija entrada o salida.");
    if (clase === "COMPROBANTE" && tipo === "ENTRADA" && !idTx) throw new Error("El ID de transacción es obligatorio en las entradas.");
    const valor = numero(fd, "valor");
    if (valor <= 0) throw new Error("El valor debe ser mayor que cero.");
    const tasaBinance = clase === "BINANCE" ? numero(fd, "tasa_binance") : null;
    if (tasaBinance !== null && tasaBinance <= 0) throw new Error("La tasa de Binance debe ser mayor que cero.");

    const supabase = await crearClienteServidor();

    const r = await supabase.from("comprobante_brasil").insert({
      banco_id: banco, fecha, id_tx: idTx || null, tipo, valor, clase, tasa_binance: tasaBinance,
      remitente: texto(fd, "remitente") || null,
      observacion: texto(fd, "observacion") || null,
    }).select("codigo").single();
    if (r.error?.code === "23505" && /idtx/.test(r.error.message)) {
      throw new Error(`El ID de transacción "${idTx}" ya está cargado en este banco.`);
    }
    const creado = revisar(r);
    return `Comprobante ${creado.codigo} guardado.`;
  });
}
