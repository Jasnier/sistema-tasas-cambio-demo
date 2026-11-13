"use client";

import { useRef, useState } from "react";
import { boton, botonPeligro, botonPeligroSolido, botonSuave, campo } from "@/components/estilos";

type Seleccionado = { codigo: string; cliente: string; monto: string; estado: string };

/**
 * Botón de la barra de selección que pide el motivo en una ventana (desbloquear o rechazar).
 * Muestra un resumen de lo marcado; "Confirmar" envía el formulario de la tabla con op y motivo.
 * Cada casilla de la tabla lleva su resumen en data-* (ver page.tsx).
 */
export function AccionConMotivo({ op, etiqueta, titulo, ayuda, peligro }: {
  op: "desbloquear" | "rechazar"; etiqueta: string; titulo: string; ayuda: string; peligro?: boolean;
}) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const motivo = useRef<HTMLTextAreaElement>(null);
  const [lista, setLista] = useState<Seleccionado[]>([]);

  const abrir = (e: React.MouseEvent<HTMLButtonElement>) => {
    const form = e.currentTarget.form;
    const marcados = [...(form?.querySelectorAll<HTMLInputElement>('input[name="ids"]:checked') ?? [])];
    setLista(marcados.map((c) => ({
      codigo: c.dataset.codigo ?? "", cliente: c.dataset.cliente ?? "", monto: c.dataset.monto ?? "", estado: c.dataset.estado ?? "",
    })));
    if (motivo.current) motivo.current.value = "";
    dialogo.current?.showModal();
    setTimeout(() => motivo.current?.focus(), 0);
  };
  const cerrar = () => dialogo.current?.close();
  // Rojo sólido para confirmar un rechazo (el botón de la barra es el rojo suave)
  const confirmarClase = peligro ? botonPeligroSolido : boton;

  return (
    <>
      <button type="button" onClick={abrir} className={peligro ? botonPeligro : botonSuave}>{etiqueta}</button>
      <dialog ref={dialogo} aria-labelledby={`titulo-${op}`} onClose={() => motivo.current?.setCustomValidity("")}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-borde bg-superficie p-0 text-texto shadow-2xl backdrop:bg-black/40">
        <div className="space-y-4 p-5">
          <div>
            <h2 id={`titulo-${op}`} className="text-lg font-semibold">{titulo}</h2>
            <p className="text-sm text-tenue">{ayuda}</p>
          </div>

          {lista.length === 0 ? (
            <p className="rounded-md bg-aviso-suave px-3 py-2 text-sm text-aviso">Primero marque en la tabla los movimientos.</p>
          ) : (
            <div className="rounded-lg border border-borde">
              <p className="border-b border-borde bg-superficie-2 px-3 py-1.5 text-xs font-semibold text-tenue">
                {lista.length} movimiento{lista.length === 1 ? "" : "s"} seleccionado{lista.length === 1 ? "" : "s"}
              </p>
              <ul className="max-h-56 divide-y divide-borde/70 overflow-y-auto text-sm">
                {lista.map((m) => (
                  <li key={m.codigo} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                    <span className="min-w-0">
                      <span className="font-mono text-xs font-semibold">{m.codigo}</span>
                      <span className="ml-2 truncate">{m.cliente}</span>
                      <span className="ml-2 text-xs text-tenue">{m.estado}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">{m.monto}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {lista.length > 0 && (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Motivo
              {/* Sin "required": la caja queda en el formulario y no debe frenar los otros botones de la tabla */}
              <textarea ref={motivo} name={`motivo_${op}`} rows={3} onInput={(e) => e.currentTarget.setCustomValidity("")}
                placeholder={op === "rechazar" ? "Ej.: el comprobante no se lee, envíelo de nuevo" : "Ej.: el monto quedó mal escrito"}
                className={`${campo} resize-y`} />
            </label>
          )}

          <div className="flex justify-end gap-2 border-t border-borde pt-4">
            <button type="button" onClick={cerrar} className={botonSuave}>Cancelar</button>
            {lista.length > 0 && (
              <button name="op" value={op} className={confirmarClase}
                onClick={(e) => {
                  const caja = motivo.current;
                  if (!caja) return;
                  if (caja.value.trim().length < 3) {
                    e.preventDefault();
                    caja.setCustomValidity("Escriba el motivo (mínimo 3 letras).");
                    caja.reportValidity();
                    return;
                  }
                  setTimeout(cerrar, 0);   // se envía el formulario y se cierra la ventana
                }}>
                Confirmar {op === "rechazar" ? "rechazo" : "desbloqueo"}
              </button>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
