"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { boton, botonSuave, campo, etiqueta } from "@/components/estilos";
import { enviarSinBorrar } from "@/components/Formulario";
import { guardarComprobante } from "./actions";

type Banco = { id: string; nombre: string };

/**
 * "+ Nuevo registro": abre una ventana con el formulario de carga de Brasil (solo la información, sin
 * archivos). Al guardar, la ventana queda abierta y limpia para el siguiente, conservando el banco
 * (Paula suele cargar varios seguidos); se cierra con "Cerrar" o Esc. La tabla se actualiza detrás.
 * El saldo inicial de cada mes no se registra: el sistema lo calcula con el cierre del mes anterior.
 */
export function FormularioComprobante({ bancos, bancoInicial, hoy }: { bancos: Banco[]; bancoInicial?: string; hoy: string }) {
  const [estado, guardar, guardando] = useActionState(guardarComprobante, {});
  const [clase, setClase] = useState("COMPROBANTE");
  const dialogo = useRef<HTMLDialogElement>(null);
  const ref = useRef<HTMLFormElement>(null);
  // El mensaje solo se muestra si es de un envío hecho con la ventana abierta esta vez
  const [desde, setDesde] = useState(0);

  useEffect(() => {
    if (estado.ok) {
      const sel = ref.current?.querySelector<HTMLSelectElement>("select[name=banco]");
      const banco = sel?.value;
      ref.current?.reset();
      if (sel && banco) sel.value = banco;
      ref.current?.querySelector<HTMLInputElement>("input[name=id_tx], input[name=valor]")?.focus();
    }
  }, [estado]);

  const abrir = () => {
    setDesde(estado.t ?? 0);   // marca del servidor, no la hora de este equipo
    dialogo.current?.showModal();
    setTimeout(() => ref.current?.querySelector<HTMLElement>("select[name=banco]")?.focus(), 0);
  };
  const mostrarMensaje = (estado.t ?? 0) !== desde;

  return (
    <>
      <button type="button" onClick={abrir} className={boton}>+ Nuevo registro</button>
      <dialog ref={dialogo} aria-labelledby="titulo-nuevo-registro"
        className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-xl border border-borde bg-superficie p-0 text-texto shadow-2xl backdrop:bg-black/40">
        <form ref={ref} onSubmit={(e) => { e.preventDefault(); enviarSinBorrar(e, guardar); }} aria-busy={guardando} className="space-y-4 p-5">
          <div>
            <h2 id="titulo-nuevo-registro" className="text-lg font-semibold">Nuevo registro</h2>
            <p className="text-sm text-tenue">Comprobante recibido o venta a Binance. El ID de transacción no se puede repetir en un mismo banco.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={etiqueta}>Banco
              <select name="banco" required defaultValue={bancoInicial ?? ""} className={campo}>
                <option value="" disabled>Elija…</option>
                {bancos.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
              </select>
            </label>
            <label className={etiqueta}>Registro
              <select name="clase" value={clase} onChange={(e) => setClase(e.target.value)} className={campo}>
                <option value="COMPROBANTE">Comprobante</option>
                <option value="BINANCE">Venta a Binance</option>
              </select>
            </label>
            <label className={etiqueta}>Fecha<input type="date" name="fecha" required defaultValue={hoy} max={hoy} className={campo} /></label>
            {clase === "COMPROBANTE" ? (
              <label className={etiqueta}>Tipo
                <select name="tipo" className={campo}><option value="ENTRADA">Entrada</option><option value="SALIDA">Salida</option></select>
              </label>
            ) : (
              <label className={etiqueta}>Tasa (BRL por USDT)<input name="tasa_binance" required inputMode="decimal" className={campo} /></label>
            )}
            {clase === "COMPROBANTE" && (
              <label className={etiqueta}>ID transacción<input name="id_tx" className={campo} placeholder="obligatorio en entradas" /></label>
            )}
            <label className={etiqueta}>{clase === "BINANCE" ? "Total vendido (BRL)" : "Valor (BRL)"}
              <input name="valor" required inputMode="decimal" className={`${campo} text-right tabular-nums`} />
            </label>
            <label className={`${etiqueta} ${clase === "BINANCE" ? "" : "sm:col-span-2"}`}>{clase === "COMPROBANTE" ? "Remitente" : "Detalle"}
              <input name="remitente" className={campo} />
            </label>
            <label className={`${etiqueta} sm:col-span-2`}>Observación<input name="observacion" className={campo} /></label>
          </div>

          {mostrarMensaje && estado.error && <p role="alert" className="rounded-md bg-peligro-suave px-3 py-2 text-sm text-peligro">{estado.error}</p>}
          {mostrarMensaje && estado.ok && !estado.error && (
            <p role="status" className="rounded-md bg-exito-suave px-3 py-2 text-sm text-exito">{estado.ok} Puede cargar el siguiente.</p>
          )}

          <div className="flex justify-end gap-2 border-t border-borde pt-4">
            <button type="button" onClick={() => dialogo.current?.close()} className={botonSuave}>Cerrar</button>
            <button className={boton} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
