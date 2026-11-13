"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { enviarSinBorrar } from "@/components/Formulario";
import { boton, botonSuave, campo, etiqueta } from "@/components/estilos";
import { Insignia, dinero } from "@/components/ui";
import { ajustar, type ResultadoAjuste } from "./actions";

export type FilaUtilidad = {
  id: string; codigo: string; fecha: string; cliente: string; par: string; modalidad: string; monto: number; tasa: number;
  tasa_adq: number; utilidad: number; marca: string | null; periodo: string | null;
};
const tasa = (n?: number) => (n == null ? "" : Number(n).toLocaleString("es-CO", { maximumFractionDigits: 6 }));

export function TablaUtilidad({ filas }: { filas: FilaUtilidad[] }) {
  const [estado, enviar, enviando] = useActionState<ResultadoAjuste, FormData>(ajustar, {});
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [modo, setModo] = useState("QUITAR");
  const res = new Map((estado.resultados ?? []).map((r) => [r.id, r]));
  const elegibles = filas.filter((f) => !f.marca);
  const nSel = filas.filter((f) => sel.has(f.id)).length;
  const todos = elegibles.length > 0 && elegibles.every((f) => sel.has(f.id));
  const alternar = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const op = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
        if (op === "aplicar" && !window.confirm(`¿Aplicar el ajuste a ${nSel} movimiento(s)? Queda marcado y auditado.`)) return;
        enviarSinBorrar(e, enviar);
      }}
      aria-busy={enviando} className="space-y-3"
    >
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-borde bg-superficie-2 p-3">
        <fieldset className={etiqueta}>
          <legend className="mb-1">Ajuste</legend>
          <div className="flex gap-3 text-sm font-normal text-texto">
            <label className="flex items-center gap-1.5"><input type="radio" name="modo" value="QUITAR" checked={modo === "QUITAR"} onChange={() => setModo("QUITAR")} /> Quitar toda la utilidad</label>
            <label className="flex items-center gap-1.5"><input type="radio" name="modo" value="RESTAR" checked={modo === "RESTAR"} onChange={() => setModo("RESTAR")} /> Restar puntos</label>
          </div>
        </fieldset>
        {modo === "RESTAR" && (
          <label className={etiqueta}>Puntos a restar<input name="puntos" required inputMode="decimal" placeholder="5" className={`${campo} w-24 text-right`} /></label>
        )}
        <label className={etiqueta}>Motivo<input name="motivo" required minLength={3} placeholder="Cliente preferencial, error de tasa…" className={`${campo} w-64`} /></label>
        <button name="op" value="simular" className={botonSuave} disabled={enviando || !nSel}>Vista previa</button>
        <button name="op" value="aplicar" className={boton} disabled={enviando || !nSel}>{enviando ? "Procesando…" : `Aplicar a ${nSel}`}</button>
      </div>

      {estado.error && <p role="alert" className="rounded-md bg-peligro-suave px-3 py-2 text-sm text-peligro">{estado.error}</p>}
      {estado.resultados && (
        <p role="status" className="rounded-md bg-info-suave px-3 py-2 text-sm text-info">
          {estado.simulado ? "Vista previa (no se guardó nada): " : "Aplicado: "}
          <strong>{estado.ajustados}</strong> movimiento(s). Utilidad {dinero(estado.utilidad_antes)} → <strong>{dinero(estado.utilidad_despues)}</strong>
          {" "}(diferencia {dinero(estado.diferencia)}).
          {estado.omitidos?.length ? <> Omitidos: {estado.omitidos.map((o) => `${o.codigo} (${o.motivo})`).join("; ")}.</> : null}
        </p>
      )}

      <div className="-mx-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-borde text-left">
            <th className="w-8 px-4 py-2"><input type="checkbox" aria-label="Seleccionar todos" checked={todos} className="size-4"
              onChange={() => setSel(todos ? new Set() : new Set(elegibles.map((f) => f.id)))} /></th>
            <th className="px-2 py-2">Código</th><th className="px-2 py-2">Fecha</th><th className="px-2 py-2">Cliente</th><th className="px-2 py-2">Par</th>
            <th className="px-2 py-2 text-right">Tasa cliente</th><th className="px-2 py-2 text-right">Tasa adq.</th><th className="px-2 py-2 text-right">Utilidad</th>
            <th className="px-2 py-2">{estado.resultados ? (estado.simulado ? "Quedaría" : "Quedó") : "Marca"}</th>
          </tr></thead>
          <tbody>
            {filas.map((f) => {
              const r = res.get(f.id);
              return (
                <tr key={f.id} className="border-b border-borde/70">
                  <td className="px-4 py-2"><input type="checkbox" name="ids" value={f.id} disabled={!!f.marca} checked={sel.has(f.id)} onChange={() => alternar(f.id)}
                    aria-label={`Seleccionar ${f.codigo}`} className="size-4" /></td>
                  <td className="px-2 py-2"><Link href={`/movimientos/${f.id}`} className="font-mono text-xs font-semibold text-primario hover:underline">{f.codigo}</Link></td>
                  <td className="px-2 py-2 whitespace-nowrap tabular-nums">{f.fecha}</td>
                  <td className="px-2 py-2">{f.cliente}</td>
                  <td className="px-2 py-2 text-xs">{f.par} · {f.modalidad === "TRANSFERENCIA" ? "transf." : "efectivo"}<span className="block text-tenue">{dinero(f.monto)}</span></td>
                  <td className="px-2 py-2 text-right tabular-nums">{tasa(f.tasa)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{tasa(f.tasa_adq)}</td>
                  <td className={`px-2 py-2 text-right font-medium tabular-nums ${f.utilidad < 0 ? "text-peligro" : ""}`}>{dinero(f.utilidad)}</td>
                  <td className="px-2 py-2 text-xs">
                    {r ? <span className="tabular-nums">{tasa(r.tasa_adq_despues)} · <strong>{dinero(r.utilidad_despues)}</strong></span>
                      : f.marca ? <Insignia tono="aviso">{f.marca}</Insignia> : <span className="text-tenue">—</span>}
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
