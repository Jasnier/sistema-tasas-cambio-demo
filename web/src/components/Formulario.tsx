"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import type { EstadoAccion } from "@/lib/acciones";

/**
 * Con <form action={fn}> React 19 vacía el formulario después de cada envío, también cuando la
 * acción devolvió un error. Así se conserva lo escrito; incluye el name/value del botón pulsado.
 */
export function enviarSinBorrar(e: React.FormEvent<HTMLFormElement>, enviar: (fd: FormData) => void) {
  const boton = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
  const fd = new FormData(e.currentTarget, boton);
  startTransition(() => enviar(fd));
}

type Props = {
  accion: (prev: EstadoAccion, fd: FormData) => Promise<EstadoAccion>;
  children: React.ReactNode;
  className?: string;
  /** Limpia los campos después de guardar con éxito (formularios de alta). */
  limpiar?: boolean;
  /** Pide confirmación antes de enviar. */
  confirmar?: string;
  /**
   * Muestra el resultado como notificación flotante (arriba a la derecha) en vez de al final del
   * formulario: para formularios largos, como una tabla con acciones por lote.
   */
  notificar?: boolean;
};

/** Formulario que ejecuta una Server Action y muestra su error o confirmación en línea. */
export function Formulario({ accion, children, className, limpiar, confirmar, notificar }: Props) {
  const [estado, enviar, enviando] = useActionState(accion, {});
  const ref = useRef<HTMLFormElement>(null);
  const [cerrado, setCerrado] = useState<number>();
  // Doble clic: mientras la acción corre no se acepta otro envío (dos clics seguidos creaban dos registros)
  const ocupado = useRef(false);
  useEffect(() => { if (!enviando) ocupado.current = false; }, [enviando, estado]);

  useEffect(() => {
    if (limpiar && estado.ok) ref.current?.reset();
  }, [estado, limpiar]);

  // Un resultado parcial ("Omitidos: …") es un aviso: no se va solo, como los errores
  const tono = estado.error ? "peligro" : estado.ok && /Omitid/.test(estado.ok) ? "aviso" : "exito";
  useEffect(() => {
    if (!notificar || !estado.ok || tono !== "exito") return;
    const t = setTimeout(() => setCerrado(estado.t), 8000);
    return () => clearTimeout(t);
  }, [estado, notificar, tono]);
  const mensaje = estado.error || estado.ok;

  return (
    <form
      ref={ref}
      onSubmit={(e) => {
        // Se envía a mano (no con action=) para que React no borre lo escrito cuando hay un error
        e.preventDefault();
        if (ocupado.current || enviando) return;
        if (confirmar && !window.confirm(confirmar)) return;
        ocupado.current = true;
        enviarSinBorrar(e, enviar);
      }}
      className={className}
      aria-busy={enviando}
    >
      {children}
      {notificar ? (
        mensaje && cerrado !== estado.t && (
          <div role={tono === "exito" ? "status" : "alert"}
            className={`fixed right-4 top-4 z-50 flex max-w-md items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${{
              peligro: "border-peligro/30 bg-peligro-suave text-peligro",
              aviso: "border-aviso/30 bg-aviso-suave text-aviso",
              exito: "border-exito/30 bg-exito-suave text-exito",
            }[tono]}`}>
            <span aria-hidden className="font-bold">{tono === "exito" ? "✓" : "!"}</span>
            <p className="flex-1 whitespace-pre-line">{mensaje.replace(/\. Omitidos: /, ".\nOmitidos: ")}</p>
            <button type="button" onClick={() => setCerrado(estado.t)} aria-label="Cerrar aviso" className="-mr-1 rounded px-1 opacity-70 hover:opacity-100">✕</button>
          </div>
        )
      ) : (<>
        {estado.error && <p role="alert" className="basis-full rounded-md bg-peligro-suave px-2 py-1 text-sm text-peligro">{estado.error}</p>}
        {estado.ok && !estado.error && <p role="status" className="basis-full rounded-md bg-exito-suave px-2 py-1 text-sm text-exito">{estado.ok}</p>}
      </>)}
    </form>
  );
}
