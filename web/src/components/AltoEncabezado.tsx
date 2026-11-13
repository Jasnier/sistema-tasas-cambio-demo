"use client";

import { useEffect, useRef } from "react";

/**
 * Publica el alto del encabezado fijo en la variable CSS --alto-encabezado, para que otras barras
 * fijas (p. ej. la de Aprobación) se peguen justo debajo y no queden tapadas.
 */
export function AltoEncabezado() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const encabezado = ref.current?.closest("header");
    if (!encabezado) return;
    const raiz = document.documentElement;
    const poner = () => raiz.style.setProperty("--alto-encabezado", `${encabezado.offsetHeight}px`);
    poner();
    const observador = new ResizeObserver(poner);
    observador.observe(encabezado);
    return () => { observador.disconnect(); raiz.style.removeProperty("--alto-encabezado"); };
  }, []);
  return <span ref={ref} hidden />;
}
