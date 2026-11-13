"use client";

import { useEffect, useRef, useState } from "react";

/**
 * "3 seleccionados · Quitar selección" al inicio de la barra de acciones de la tabla. La barra solo se ve cuando hay
 * algo marcado (CSS: group-has-[.fila-sel:checked]); este contador escucha las casillas del mismo formulario.
 */
export function ContadorSeleccion() {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(0);

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const contar = () => setN(form.querySelectorAll("input.fila-sel:checked").length);
    // Se cuenta en el siguiente ciclo: "Seleccionar todos" marca las filas después de este evento, y el
    // formulario se limpia (reset) después de guardar
    const luego = () => setTimeout(contar, 0);
    form.addEventListener("change", luego);
    form.addEventListener("reset", luego);
    luego();
    return () => { form.removeEventListener("change", luego); form.removeEventListener("reset", luego); };
  }, []);

  const quitar = () => {
    const form = ref.current?.closest("form");
    form?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((c) => { c.checked = false; });
    setN(0);
  };

  return (
    <span ref={ref} className="flex items-center gap-2 self-center pr-1 text-sm">
      <strong className="tabular-nums">{n}</strong> {n === 1 ? "seleccionado" : "seleccionados"}
      <button type="button" onClick={quitar} className="text-xs text-primario underline hover:no-underline">Quitar selección</button>
    </span>
  );
}
