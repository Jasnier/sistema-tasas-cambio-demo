"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { enviarSinBorrar } from "@/components/Formulario";
import { boton, campo, etiqueta } from "@/components/estilos";
import { crearMovimiento, editarMovimiento, type EstadoMovimiento } from "./actions";
import type { Item, Libro } from "./datos";

export type ValoresMovimiento = {
  id?: string; libro_id: string; id_transaccion: string; tipo: string; fecha: string; hora: string; modalidad: string;
  contraparte_id: string; moneda_origen: string; moneda_destino: string; monto_origen: string; recibido_en_id: string;
  empresa_id: string; tercero: string; observaciones: string; descuento_tasa: boolean;
};

type Props = {
  libros: Libro[];
  monedas: string[];
  recibidos: Item[];
  empresas: Item[];
  contrapartes: (Item & { tipo: string })[];
  puedeDescuento: boolean;
  valores: ValoresMovimiento;
  hoy: string;
};

/** STW-22: registro (o corrección de un borrador) con validación en la base y aviso de duplicados (STW-25). */
export function FormularioMovimiento({ libros, monedas, recibidos, empresas, contrapartes, puedeDescuento, valores, hoy }: Props) {
  const editando = Boolean(valores.id);
  const [estado, enviar, enviando] = useActionState<EstadoMovimiento, FormData>(editando ? editarMovimiento : crearMovimiento, {});
  const [libroId, setLibroId] = useState(valores.libro_id || libros[0]?.id || "");
  const [tipo, setTipo] = useState(valores.tipo || "ENTRADA");
  const [monto, setMonto] = useState(valores.monto_origen);
  const [origen, setOrigen] = useState(valores.moneda_origen || monedas[0] || "");
  const [destino, setDestino] = useState(valores.moneda_destino || (monedas.includes("COP") ? "COP" : monedas[0] || ""));
  const ref = useRef<HTMLFormElement>(null);
  const libro = libros.find((l) => l.id === libroId);
  const fijo = libro?.tipo === "cliente_grande" ? contrapartes.find((c) => c.id === libro.contraparte_id) : undefined;

  // Alta: tras guardar se limpia para registrar el siguiente (se conservan libro, fecha y monedas)
  useEffect(() => {
    if (!editando && estado.ok && !estado.error && ref.current) {
      for (const n of ["id_transaccion", "monto_origen", "tercero", "observaciones", "hora"]) {
        const el = ref.current.elements.namedItem(n) as HTMLInputElement | null;
        if (el) el.value = "";
      }
      const conf = ref.current.elements.namedItem("confirmar_duplicado") as HTMLInputElement | null;
      if (conf) conf.checked = false;
      setMonto("");
      (ref.current.elements.namedItem("id_transaccion") as HTMLInputElement | null)?.focus();
    }
  }, [estado, editando]);

  const montoVista = vistaMonto(monto);
  // Al editar: si la moneda o el cliente del movimiento se desactivó en el catálogo, sigue siendo una opción.
  // Sin esto el navegador elegía la primera de la lista y el movimiento cambiaba de moneda o de cliente sin pedirlo.
  const opcionesMoneda = (actual: string) => (actual && !monedas.includes(actual) ? [actual, ...monedas] : monedas);
  const clienteInactivo = valores.contraparte_id && !contrapartes.some((c) => c.id === valores.contraparte_id) ? valores.contraparte_id : "";

  return (
    <form ref={ref} onSubmit={(e) => { e.preventDefault(); if (enviando) return; enviarSinBorrar(e, enviar); }} aria-busy={enviando} className="space-y-5">
      {valores.id && <input type="hidden" name="id" value={valores.id} />}

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="sr-only">Origen</legend>
        <label className={`${etiqueta} sm:col-span-2`}>Libro
          {editando || libros.length === 1 ? (
            <>
              <input type="hidden" name="libro_id" value={libroId} />
              <span className={`${campo} bg-superficie-2`}>{libro ? `${libro.prefijo} · ${libro.nombre}` : "—"}</span>
            </>
          ) : (
            <select name="libro_id" value={libroId} onChange={(e) => setLibroId(e.target.value)} required className={campo}>
              {libros.map((l) => <option key={l.id} value={l.id}>{l.prefijo} · {l.nombre}{l.tipo === "cliente_grande" ? " (cliente grande)" : ""}</option>)}
            </select>
          )}
        </label>
        <div className={`${etiqueta} sm:col-span-2`}>
          <span id="tipo-etq">Tipo</span>
          <div role="radiogroup" aria-labelledby="tipo-etq" className="grid grid-cols-2 rounded-md border border-borde-fuerte bg-superficie-2 p-0.5 text-sm">
            {(["ENTRADA", "SALIDA"] as const).map((t) => (
              <label key={t} className={`cursor-pointer rounded px-3 py-1 text-center font-medium transition-colors ${tipo === t
                ? (t === "ENTRADA" ? "bg-exito text-sobre shadow-sm" : "bg-peligro text-sobre shadow-sm") : "text-tenue hover:text-texto"}`}>
                <input type="radio" name="tipo" value={t} checked={tipo === t} onChange={() => setTipo(t)} className="sr-only" />
                {t === "ENTRADA" ? "Entrada" : "Salida"}
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-2 text-sm font-semibold">Operación</legend>
        <label className={etiqueta}>Fecha
          <input type="date" name="fecha" required defaultValue={valores.fecha || hoy} max={hoy} className={campo} />
        </label>
        <label className={etiqueta}>Hora
          <input type="time" name="hora" required defaultValue={valores.hora} className={campo} />
        </label>
        <label className={`${etiqueta} sm:col-span-2`}>Id de transacción (comprobante)
          <input name="id_transaccion" required maxLength={100} defaultValue={valores.id_transaccion} autoComplete="off"
            placeholder="Número del comprobante" className={`${campo} font-mono`} />
        </label>
        <label className={`${etiqueta} sm:col-span-2`}>Cliente o aliado
          {fijo ? (
            <span className={`${campo} bg-superficie-2`} title="Un cliente grande siempre registra a su propio código">{fijo.nombre} · {fijo.id}</span>
          ) : libro?.tipo === "cliente_grande" ? (
            // Libro de cliente grande sin código CT: no se elige a mano (la base también lo rechaza)
            <span className={`${campo} bg-superficie-2 text-peligro`}>Este libro no tiene código CT asignado (Configuración → Clientes grandes)</span>
          ) : (
            <select name="contraparte_id" required defaultValue={valores.contraparte_id} className={campo}>
              <option value="" disabled>Elija…</option>
              {clienteInactivo && <option value={clienteInactivo}>{clienteInactivo} · inactivo</option>}
              {contrapartes.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {c.id} · {c.tipo.toLowerCase()}</option>)}
            </select>
          )}
        </label>
        <label className={etiqueta}>Modalidad
          <select name="modalidad" defaultValue={valores.modalidad || "TRANSFERENCIA"} className={campo}>
            <option>TRANSFERENCIA</option><option>EFECTIVO</option>
          </select>
        </label>
        <label className={etiqueta}>Tercero / titular
          <input name="tercero" defaultValue={valores.tercero} className={campo} />
        </label>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-2 text-sm font-semibold">Monto</legend>
        <label className={etiqueta}>Moneda origen
          <select name="moneda_origen" value={origen} onChange={(e) => setOrigen(e.target.value)} className={campo}>
            {opcionesMoneda(origen).map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className={etiqueta}>Monto origen
          <input name="monto_origen" required inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)}
            placeholder="1250000,50" className={`${campo} text-right tabular-nums`} aria-describedby="monto-ayuda" />
          <span id="monto-ayuda" className="font-normal">Sin puntos de miles o con coma decimal: 4100 o 4,1</span>
        </label>
        <label className={etiqueta}>Moneda destino
          <select name="moneda_destino" value={destino} onChange={(e) => setDestino(e.target.value)} className={campo}>
            {opcionesMoneda(destino).map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <div className="flex items-end">
          <p className={`w-full rounded-md px-3 py-2 text-sm ${tipo === "ENTRADA" ? "bg-exito-suave text-exito" : "bg-peligro-suave text-peligro"}`} aria-live="polite">
            {montoVista ? <><strong className="tabular-nums">{tipo === "SALIDA" ? "−" : "+"}{montoVista}</strong> {origen} → {destino}</> : "Escriba el monto"}
          </p>
        </div>
        <label className={etiqueta}>Recibido en
          <select name="recibido_en_id" defaultValue={valores.recibido_en_id} className={campo}>
            <option value="">—</option>{recibidos.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        </label>
        <label className={etiqueta}>Empresa
          <select name="empresa_id" defaultValue={valores.empresa_id} className={campo}>
            <option value="">—</option>{empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </label>
        {puedeDescuento && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm sm:col-span-2" title="P-3: penalización que solo aplica la administración">
            <input type="checkbox" name="descuento_tasa" defaultChecked={valores.descuento_tasa} className="size-4 accent-[var(--primario)]" />
            Aplicar descuento ×0,95 a la tasa
          </label>
        )}
      </fieldset>

      <label className={etiqueta}>Observaciones
        <textarea name="observaciones" rows={2} defaultValue={valores.observaciones} className={campo} />
      </label>

      {estado.duplicados && (
        <div role="alert" className="space-y-2 rounded-lg border border-aviso/40 bg-aviso-suave p-3 text-sm text-aviso">
          <p><strong>Posible duplicado.</strong> Ya hay un movimiento del mismo cliente, moneda, tipo y monto ese día: {estado.duplicados}.</p>
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" name="confirmar_duplicado" className="size-4" /> Lo revisé: es otro movimiento y quiero registrarlo
          </label>
        </div>
      )}
      {estado.error && !estado.duplicados && <p role="alert" className="rounded-md bg-peligro-suave px-3 py-2 text-sm text-peligro">{estado.error}</p>}
      {estado.ok && !estado.error && (
        <p role="status" className="rounded-md bg-exito-suave px-3 py-2 text-sm text-exito">
          {estado.ok} {estado.id && <Link href={`/movimientos/${estado.id}`} className="font-medium underline">Ver {estado.codigo}</Link>}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button className={boton} disabled={enviando}>
          {enviando ? "Guardando…" : editando ? "Guardar cambios" : estado.duplicados ? "Registrar de todos modos" : "Registrar movimiento"}
        </button>
        <span className="text-xs text-tenue">
          {libro?.tipo === "cliente_grande"
            ? "Queda registrado: lo puede corregir hasta que su operador lo envíe a verificación."
            : "Queda como borrador: lo puede corregir hasta que la administración lo verifique."}
        </span>
      </div>
    </form>
  );
}

function vistaMonto(texto: string): string {
  const t = texto.replace(/\s/g, "");
  if (!t) return "";
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) && n > 0 ? n.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
}
