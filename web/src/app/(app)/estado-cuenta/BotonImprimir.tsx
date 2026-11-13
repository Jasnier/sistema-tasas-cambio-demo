"use client";

import { boton } from "@/components/estilos";

/** "Guardar como PDF" del navegador: la hoja de impresión oculta el menú y los filtros. */
export function BotonImprimir() {
  return <button type="button" onClick={() => window.print()} className={boton}>Imprimir / PDF</button>;
}
