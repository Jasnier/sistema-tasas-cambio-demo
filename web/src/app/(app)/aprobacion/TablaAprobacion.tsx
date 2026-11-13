"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { enviarSinBorrar } from "@/components/Formulario";
import { boton, botonSuave } from "@/components/estilos";
import { Insignia, dinero } from "@/components/ui";
import { aprobar, type EstadoAprobacion } from "./actions";

export type FilaAprobacion = {
  id: string; codigo: string; libro: string; fecha: string; cliente: string; contraparte_id: string; tipo: string;
  monto_origen: number; moneda_origen: string; moneda_destino: string; modalidad: string; descuento_tasa: boolean;
  aprobacion_error: string | null; parecido: string | null;
};

const tasa = (n?: number) => (n == null ? "" : Number(n).toLocaleString("es-CO", { maximumFractionDigits: 6 }));

/** Selección, vista previa y aprobación (STW-29). El resultado de cada movimiento se ve en la misma fila. */
export function TablaAprobacion({ filas }: { filas: FilaAprobacion[] }) {
  const [estado, enviar, enviando] = useActionState<EstadoAprobacion, FormData>(aprobar, {});
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set());
  const res = new Map((estado.resultados ?? []).map((r) => [r.id, r]));
  const aprobadosAhora = !estado.simulado ? new Set((estado.resultados ?? []).filter((r) => r.ok).map((r) => r.id)) : new Set<string>();
  const visibles = filas.filter((f) => !aprobadosAhora.has(f.id));

  const alternar = (id: string) => setMarcados((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const nSel = visibles.filter((f) => marcados.has(f.id)).length;   // lo ya aprobado deja de contar
  const todos = visibles.length > 0 && visibles.every((f) => marcados.has(f.id));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const op = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
        if (op === "aprobar" && !window.confirm(`¿Aprobar ${nSel} movimiento(s)? Se calcula la tasa y se afecta el saldo de cada cliente. No se puede deshacer desde aquí.`)) return;
        enviarSinBorrar(e, enviar);
      }}
      aria-busy={enviando}
      className="space-y-3"
    >
      <div className="sticky top-[3.75rem] z-10 flex flex-wrap items-center gap-2 rounded-lg border border-borde bg-superficie-2 p-2 shadow-sm lg:top-[calc(var(--alto-encabezado,0px)+0.5rem)]">
        <button name="op" value="simular" className={botonSuave} disabled={enviando || !nSel}>Vista previa</button>
        <button name="op" value="aprobar" className={boton} disabled={enviando || !nSel}>
          {enviando ? "Procesando…" : `Aprobar seleccionados (${nSel})`}
        </button>
        <span className="text-xs text-tenue">Se procesan en orden de fecha y hora de la operación. La vista previa no guarda nada.</span>
      </div>

      {estado.error && <p role="alert" className="rounded-md bg-peligro-suave px-3 py-2 text-sm text-peligro">{estado.error}</p>}
      {estado.resultados && (
        <p role="status" className={`rounded-md px-3 py-2 text-sm ${estado.con_error ? "bg-aviso-suave text-aviso" : "bg-exito-suave text-exito"}`}>
          {estado.simulado ? "Vista previa: " : ""}
          {estado.simulado ? "se aprobarían" : "Aprobados"} <strong>{estado.aprobados}</strong>
          {estado.con_error ? <> · con problema <strong>{estado.con_error}</strong> (siguen verificados, con el motivo)</> : null}.
          {!estado.simulado && estado.aprobados ? <> <Link href="/movimientos?estado=APROBADO" className="underline">Ver aprobados</Link></> : null}
        </p>
      )}

      <div className="-mx-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-borde text-left">
              <th className="w-8 px-4 py-2">
                <input type="checkbox" aria-label="Seleccionar todos" checked={todos} className="size-4 accent-[var(--primario)]"
                  onChange={() => setMarcados(todos ? new Set() : new Set(visibles.map((f) => f.id)))} />
              </th>
              <th className="px-2 py-2">Código</th><th className="px-2 py-2">Fecha operación</th><th className="px-2 py-2">Cliente</th>
              <th className="px-2 py-2 text-right">Monto</th><th className="px-2 py-2">Modalidad</th>
              <th className="px-2 py-2">{estado.simulado ? "Vista previa" : "Resultado"}</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => {
              const r = res.get(f.id);
              return (
                <tr key={f.id} className="border-b border-borde/70 align-top">
                  <td className="px-4 py-2">
                    <input type="checkbox" name="ids" value={f.id} checked={marcados.has(f.id)} onChange={() => alternar(f.id)}
                      aria-label={`Seleccionar ${f.codigo}`} className="size-4 accent-[var(--primario)]" />
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    <Link href={`/movimientos/${f.id}`} className="font-mono text-xs font-semibold text-primario hover:underline">{f.codigo}</Link>
                    <span className="block text-xs text-tenue">{f.libro}</span>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap tabular-nums">{f.fecha}</td>
                  <td className="px-2 py-2">{f.cliente}<span className="block text-xs text-tenue">{f.contraparte_id}</span></td>
                  <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">
                    <Insignia tono={f.tipo === "ENTRADA" ? "exito" : "peligro"}>{f.tipo === "ENTRADA" ? "+" : "−"}{dinero(f.monto_origen)} {f.moneda_origen}</Insignia>
                    <span className="block text-xs text-tenue">→ {f.moneda_destino}{f.descuento_tasa && " · ×0,95"}</span>
                  </td>
                  <td className="px-2 py-2 text-xs">{f.modalidad === "TRANSFERENCIA" ? "Transferencia" : "Efectivo"}</td>
                  <td className="px-2 py-2 text-xs">
                    {r ? (r.ok ? (
                      <div className="space-y-0.5 tabular-nums">
                        <p><span className="text-tenue">Tasa</span> <strong>{tasa(r.tasa)}</strong> · <strong>{dinero(r.monto_destino)}</strong> {r.moneda_destino}</p>
                        <p className="text-tenue">Saldo {dinero(r.saldo_anterior)} → <span className="text-texto">{dinero(r.saldo_post)}</span></p>
                        <p className="text-tenue">Utilidad {dinero(r.utilidad)}</p>
                      </div>
                    ) : <p className="text-peligro">✕ {r.error}</p>) : (
                      <div className="space-y-1">
                        {f.aprobacion_error && <p className="text-peligro" title="Último intento">Último intento: {f.aprobacion_error}</p>}
                        {f.parecido && <Insignia tono="aviso">⚠ parecido a {f.parecido}</Insignia>}
                        {!f.aprobacion_error && !f.parecido && <span className="text-tenue">—</span>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </form>
  );
}
