"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Ícono ⓘ junto al título de la pantalla: muestra qué es y cómo funciona (pedido de Jasnier, 2026-11-11: los
 * textos largos bajo el título no iban con la estética). Se abre al pasar el mouse, al enfocarlo con el teclado
 * o al tocarlo en el celular; se cierra al salir, con Escape o tocando fuera. El texto siempre está en la página
 * (oculto a la vista), así lo leen los lectores de pantalla y las pruebas.
 */
export function Ayuda({ children, etiqueta = "¿Qué es esta pantalla?" }: { children: React.ReactNode; etiqueta?: string }) {
  const [abierta, setAbierta] = useState(false);
  const id = useId();
  const caja = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!abierta) return;
    const fuera = (e: PointerEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierta(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierta(false); };
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("pointerdown", fuera); document.removeEventListener("keydown", tecla); };
  }, [abierta]);

  return (
    <span ref={caja} className="relative inline-flex print:hidden"
      onMouseEnter={() => setAbierta(true)} onMouseLeave={() => setAbierta(false)}>
      <button type="button" aria-label={etiqueta} aria-expanded={abierta} aria-describedby={id}
        onClick={() => setAbierta((v) => !v)} onFocus={() => setAbierta(true)} onBlur={() => setAbierta(false)}
        className={`inline-flex size-6 items-center justify-center rounded-full text-sm font-normal transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primario ${abierta ? "bg-primario-suave text-primario" : "text-tenue hover:bg-superficie-2 hover:text-primario"}`}>
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="size-[18px]">
          <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.25v3.25a.75.75 0 0 0 1.5 0V9.75A.75.75 0 0 0 10 9H9Z" clipRule="evenodd" />
        </svg>
      </button>
      <span id={id} role="tooltip"
        className={`absolute left-0 top-full z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-borde bg-superficie p-3 text-left text-sm font-normal leading-relaxed text-texto shadow-lg transition-opacity duration-150 ${abierta ? "visible opacity-100" : "invisible opacity-0"}`}>
        {children}
      </span>
    </span>
  );
}
