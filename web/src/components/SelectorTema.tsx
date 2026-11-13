"use client";

import { useEffect, useState } from "react";
import { Icono } from "./Iconos";

type Tema = "claro" | "oscuro" | "sistema";
const OPCIONES: { valor: Tema; etiqueta: string; icono: "sol" | "luna" | "pantalla" }[] = [
  { valor: "claro", etiqueta: "Claro", icono: "sol" },
  { valor: "oscuro", etiqueta: "Oscuro", icono: "luna" },
  { valor: "sistema", etiqueta: "Sistema", icono: "pantalla" },
];

/** Aplica el tema al documento: "sistema" sigue la preferencia del sistema operativo. */
function aplicar(t: Tema) {
  const oscuro = t === "oscuro" || (t === "sistema" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.tema = oscuro ? "oscuro" : "claro";
}

/** Claro / Oscuro / Sistema. La elección se guarda en el navegador (es una preferencia de cada persona). */
export function SelectorTema({ className = "" }: { className?: string }) {
  const [tema, setTema] = useState<Tema>("sistema");

  useEffect(() => {
    let guardado: Tema = "sistema";
    try { const v = localStorage.getItem("tema"); if (v === "claro" || v === "oscuro") guardado = v; } catch { /* sin almacenamiento */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- leer la preferencia guardada al montar
    setTema(guardado);
  }, []);

  // En "Sistema" el tema cambia solo si el usuario cambia el de su sistema operativo
  useEffect(() => {
    if (tema !== "sistema") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const cambio = () => aplicar("sistema");
    mq.addEventListener("change", cambio);
    return () => mq.removeEventListener("change", cambio);
  }, [tema]);

  const elegir = (t: Tema) => {
    setTema(t);
    try { if (t === "sistema") localStorage.removeItem("tema"); else localStorage.setItem("tema", t); } catch { /* sin almacenamiento */ }
    aplicar(t);
  };

  return (
    <div role="radiogroup" aria-label="Tema" className={`grid grid-cols-3 gap-0.5 rounded-lg border border-lateral-borde bg-fondo/60 p-0.5 text-xs ${className}`}>
      {OPCIONES.map((o) => (
        <button key={o.valor} type="button" role="radio" aria-checked={tema === o.valor} onClick={() => elegir(o.valor)}
          className={`flex items-center justify-center gap-1 rounded-md px-1 py-1 transition-colors duration-150 ${tema === o.valor
            ? "bg-superficie font-medium text-primario shadow-sm ring-1 ring-borde" : "text-lateral-texto hover:text-lateral-fuerte"}`}>
          <Icono nombre={o.icono} className="size-3.5" />{o.etiqueta}
        </button>
      ))}
    </div>
  );
}
