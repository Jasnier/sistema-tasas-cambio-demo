"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { boton, botonPeligro, botonPeligroSolido, botonSuave, campo, etiqueta as estiloEtiqueta } from "@/components/estilos";
import { enviarSinBorrar } from "@/components/Formulario";
import type { EstadoAccion } from "@/lib/acciones";

/**
 * Botón que abre una ventana con un resumen y una caja de motivo (corregir una apropiación, solicitar su
 * liberación o rechazar una solicitud). Al confirmar con éxito se cierra y avisa arriba a la derecha; si hay
 * un error, se ve dentro de la ventana y lo escrito no se pierde.
 */
export function DialogoMotivo({ accion, campos, etiqueta, titulo, ayuda, resumen, confirmar, placeholder, peligro, enlace }: {
  accion: (prev: EstadoAccion, fd: FormData) => Promise<EstadoAccion>;
  campos: Record<string, string>;          // ocultos: id, solicitud, aceptar…
  etiqueta: string;                        // texto del botón que abre
  titulo: string;
  ayuda: string;
  resumen?: string[];                      // líneas con el detalle del comprobante
  confirmar: string;                       // texto del botón de confirmar
  placeholder?: string;
  peligro?: boolean;
  enlace?: boolean;                        // el botón que abre se ve como enlace (dentro de una lista)
}) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  const dialogo = useRef<HTMLDialogElement>(null);
  const formulario = useRef<HTMLFormElement>(null);
  const [desde, setDesde] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if ((estado.t ?? 0) === desde) return;   // sigue siendo el resultado que había al abrir
    if (estado.ok && !estado.error) {
      dialogo.current?.close();
      formulario.current?.reset();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mostrar el resultado al cerrar la ventana
      setAviso(estado.ok);
    }
  }, [estado, desde]);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 8000);
    return () => clearTimeout(t);
  }, [aviso]);

  // Se recuerda la marca del último resultado (la pone el servidor) en vez de la hora de este equipo:
  // con el reloj del PC adelantado, la ventana no se cerraba ni mostraba el error.
  const abrir = () => { setDesde(estado.t ?? 0); dialogo.current?.showModal(); };
  const error = (estado.t ?? 0) !== desde ? estado.error : undefined;

  return (
    <>
      <button type="button" onClick={abrir}
        className={enlace ? `text-xs underline ${peligro ? "text-peligro" : "text-primario"} hover:no-underline` : peligro ? botonPeligro : botonSuave}>
        {etiqueta}
      </button>
      <dialog ref={dialogo} aria-label={titulo}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-borde bg-superficie p-0 text-left text-texto shadow-2xl backdrop:bg-black/40">
        <form ref={formulario} onSubmit={(e) => { e.preventDefault(); enviarSinBorrar(e, enviar); }} className="space-y-4 p-5" aria-busy={enviando}>
          {Object.entries(campos).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <div>
            <h2 className="text-lg font-semibold">{titulo}</h2>
            <p className="text-sm text-tenue">{ayuda}</p>
          </div>
          {resumen && resumen.length > 0 && (
            <ul className="space-y-0.5 rounded-lg border border-borde bg-superficie-2/50 px-3 py-2 text-sm">
              {resumen.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
          <label className={estiloEtiqueta}>Motivo
            <textarea name="motivo" rows={3} required minLength={3} placeholder={placeholder} className={`${campo} resize-y`} />
          </label>
          {error && <p role="alert" className="rounded-md bg-peligro-suave px-3 py-2 text-sm text-peligro">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-borde pt-4">
            <button type="button" onClick={() => dialogo.current?.close()} className={botonSuave}>Cancelar</button>
            <button disabled={enviando}
              className={peligro ? botonPeligroSolido : boton}>
              {enviando ? "Guardando…" : confirmar}
            </button>
          </div>
        </form>
      </dialog>
      {aviso && (
        <div role="status" className="fixed right-4 top-4 z-50 flex max-w-md items-start gap-3 rounded-lg border border-exito/30 bg-exito-suave px-4 py-3 text-left text-sm text-exito shadow-lg">
          <span aria-hidden className="font-bold">✓</span><p className="flex-1">{aviso}</p>
          <button type="button" onClick={() => setAviso(null)} aria-label="Cerrar aviso" className="-mr-1 rounded px-1 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}
    </>
  );
}
