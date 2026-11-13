"use client";

import { useActionState } from "react";
import { enviarSinBorrar } from "@/components/Formulario";
import { boton, botonSuave, campo, etiqueta } from "@/components/estilos";
import { corregir, type ResultadoCorreccion } from "./correcciones";
import { ResumenCorreccion } from "./ResultadoCorreccion";

type Props = {
  id: string; codigo: string; fecha: string; hora: string; modalidad: string; moneda_origen: string; moneda_destino: string;
  monto_origen: string; contraparte_id: string; monedas: string[]; contrapartes: { id: string; nombre: string }[]; clienteFijo: boolean;
};

/** STW-35: corregir un aprobado. Vista previa primero; al aplicar se recalculan los saldos en el momento. */
export function FormularioCorreccion(p: Props) {
  const [estado, enviar, enviando] = useActionState<ResultadoCorreccion, FormData>(corregir, {});
  // El valor actual siempre es una opción, aunque esté inactivo en el catálogo: si faltara, el navegador
  // elegiría la primera de la lista y la corrección cambiaría el cliente o la moneda sin que nadie lo pida.
  const monedasDe = (actual: string) => (actual && !p.monedas.includes(actual) ? [actual, ...p.monedas] : p.monedas);
  const clienteInactivo = p.contraparte_id && !p.contrapartes.some((c) => c.id === p.contraparte_id);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (enviando) return;
        const op = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
        if (op === "aplicar" && !window.confirm(`¿Aplicar la corrección a ${p.codigo}? Se recalculan tasa, monto y saldos.`)) return;
        enviarSinBorrar(e, enviar);
      }}
      aria-busy={enviando} className="space-y-3"
    >
      <input type="hidden" name="id" value={p.id} />
      {(["fecha", "hora", "modalidad", "moneda_origen", "moneda_destino", "monto_origen", "contraparte_id"] as const).map((k) => (
        <input key={k} type="hidden" name={`orig_${k}`} value={p[k]} />
      ))}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={etiqueta}>Fecha<input type="date" name="fecha" defaultValue={p.fecha} className={campo} /></label>
        <label className={etiqueta}>Hora<input type="time" name="hora" defaultValue={p.hora} className={campo} /></label>
        <label className={etiqueta}>Modalidad
          <select name="modalidad" defaultValue={p.modalidad} className={campo}><option>TRANSFERENCIA</option><option>EFECTIVO</option></select>
        </label>
        <label className={etiqueta}>Monto origen<input name="monto_origen" defaultValue={p.monto_origen} inputMode="decimal" className={`${campo} text-right`} /></label>
        <label className={etiqueta}>Moneda origen
          <select name="moneda_origen" defaultValue={p.moneda_origen} className={campo}>{monedasDe(p.moneda_origen).map((m) => <option key={m}>{m}</option>)}</select>
        </label>
        <label className={etiqueta}>Moneda destino
          <select name="moneda_destino" defaultValue={p.moneda_destino} className={campo}>{monedasDe(p.moneda_destino).map((m) => <option key={m}>{m}</option>)}</select>
        </label>
        <label className={`${etiqueta} sm:col-span-2`}>Cliente o aliado
          <select name="contraparte_id" defaultValue={p.contraparte_id} disabled={p.clienteFijo} className={campo}
            title={p.clienteFijo ? "Un cliente grande siempre registra a su propio código" : undefined}>
            {clienteInactivo && <option value={p.contraparte_id}>{p.contraparte_id} · inactivo</option>}
            {p.contrapartes.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {c.id}</option>)}
          </select>
        </label>
        <label className={`${etiqueta} sm:col-span-2`}>Motivo (obligatorio)<input name="motivo" required minLength={3} placeholder="Qué se corrige y por qué" className={campo} /></label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm sm:col-span-2" title="P-33">
          <input type="checkbox" name="confirmar_negativo" className="size-4" /> Confirmo aunque algún saldo quede negativo
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button name="op" value="simular" className={botonSuave} disabled={enviando}>Vista previa</button>
        <button name="op" value="aplicar" className={boton} disabled={enviando}>{enviando ? "Procesando…" : "Aplicar corrección"}</button>
      </div>
      <ResumenCorreccion estado={estado} />
    </form>
  );
}
