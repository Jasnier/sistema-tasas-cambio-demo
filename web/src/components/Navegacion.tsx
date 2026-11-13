"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { GRUPOS, GRUPOS_PLEGADOS, MINIMO_PARA_PLEGAR, type EntradaMenu, type GrupoMenu } from "@/lib/menu";
import { Icono, IconoRuta, Marca } from "./Iconos";
import { SelectorTema } from "./SelectorTema";

/** Barra lateral agrupada (STW-63). En pantallas chicas se abre como panel con el botón "Menú". */
export function Navegacion({ entradas, nombre, roles, salir }: {
  entradas: EntradaMenu[];
  nombre: string;
  roles: string[];
  salir: React.ReactNode;
}) {
  const ruta = usePathname();
  const panel = useRef<HTMLDetailsElement>(null);
  // Al navegar en el celular se cierra el panel
  useEffect(() => { panel.current?.removeAttribute("open"); }, [ruta]);

  // La entrada activa es la de ruta más larga que coincide (/movimientos/nuevo no marca /movimientos)
  const entradaActiva = entradas
    .filter((e) => !e.sprint && (e.href === "/" ? ruta === "/" : ruta === e.href || ruta.startsWith(e.href + "/")))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const activa = entradaActiva?.href;

  // Grupos plegables solo para quien tiene muchas opciones (la administración). Lo que cada quien abre
  // o cierra se recuerda en el navegador; el grupo de la página actual siempre se ve.
  const plegable = entradas.length >= MINIMO_PARA_PLEGAR;
  const [abiertos, setAbiertos] = useState<Partial<Record<GrupoMenu, boolean>>>({});
  useEffect(() => {
    try {
      const guardado = JSON.parse(localStorage.getItem("menu-grupos") ?? "{}");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- leer la preferencia guardada al montar
      if (guardado && typeof guardado === "object") setAbiertos(guardado);
    } catch { /* sin almacenamiento */ }
  }, []);
  const estaAbierto = (g: GrupoMenu) =>
    !plegable || g === "General" || g === entradaActiva?.grupo || (abiertos[g] ?? !GRUPOS_PLEGADOS.includes(g));
  const alternar = (g: GrupoMenu) => {
    const nuevo = { ...abiertos, [g]: !estaAbierto(g) };
    setAbiertos(nuevo);
    try { localStorage.setItem("menu-grupos", JSON.stringify(nuevo)); } catch { /* sin almacenamiento */ }
  };

  const lista = (
    <nav aria-label="Principal" className={`flex flex-col px-3 py-4 text-sm ${plegable ? "gap-2" : "gap-5"}`}>
      {GRUPOS.map((g) => {
        const items = entradas.filter((e) => e.grupo === g);
        if (!items.length) return null;
        const abierto = estaAbierto(g);
        const fijo = g === entradaActiva?.grupo;   // el grupo de la página actual no se cierra
        const titulo = "px-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.09em] text-lateral-texto/75";
        return (
          <div key={g}>
            {g !== "General" && (plegable ? (
              <button type="button" onClick={() => alternar(g)} disabled={fijo} aria-expanded={abierto}
                className={`${titulo} flex w-full items-center justify-between rounded-md py-1.5 enabled:hover:bg-lateral-activo/60 enabled:hover:text-lateral-fuerte`}
                title={fijo ? "Aquí está la página que tiene abierta" : abierto ? "Plegar" : "Desplegar"}>
                <span>{g}{!abierto && <span className="ml-1.5 font-normal normal-case tracking-normal opacity-80">({items.length})</span>}</span>
                <Icono nombre="flecha" className={`size-3.5 transition-transform duration-150 ${abierto ? "rotate-90" : ""} ${fijo ? "opacity-0" : ""}`} />
              </button>
            ) : <p className={`mb-1 ${titulo}`}>{g}</p>)}
            {abierto && <ul className={`space-y-0.5 ${plegable && g !== "General" ? "mb-2" : ""}`}>
              {items.map((e) => (
                <li key={e.href}>
                  {e.sprint ? (
                    <span className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-lateral-texto/45" title={`Llega en el Sprint ${e.sprint}`}>
                      <IconoRuta href={e.href} className="size-[1.15rem]" />
                      <span className="min-w-0 flex-1 truncate">{e.etiqueta}</span><span className="rounded bg-lateral-activo px-1.5 text-[0.75rem]">S{e.sprint}</span>
                    </span>
                  ) : (
                    <Link href={e.href} aria-current={activa === e.href ? "page" : undefined}
                      className={`group/item relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150 ${activa === e.href
                        ? "bg-lateral-activo font-semibold text-primario"
                        : "text-lateral-texto hover:bg-lateral-activo/55 hover:text-lateral-fuerte"}`}>
                      {activa === e.href && <span aria-hidden className="absolute inset-y-1.5 -left-3 w-1 rounded-r-full bg-primario" />}
                      <IconoRuta href={e.href} className={`size-[1.15rem] transition-opacity ${activa === e.href ? "" : "opacity-75 group-hover/item:opacity-100"}`} />
                      <span className="min-w-0 flex-1 truncate">{e.etiqueta}</span>
                    </Link>
                  )}
                </li>
              ))}
            </ul>}
          </div>
        );
      })}
    </nav>
  );

  const usuario = (
    <div className="border-t border-lateral-borde px-3 py-3 text-xs text-lateral-texto">
      <div className="mb-2.5 flex items-center gap-2 px-1">
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-primario-suave text-xs font-semibold text-primario ring-1 ring-primario/20">
          {nombre.replace(/\(.*\)/, "").trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("")}
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium text-lateral-fuerte">{nombre.replace(/\s*\(.*\)$/, "")}</p>
          <p className="truncate opacity-75">{roles.join(", ") || "sin rol"}</p>
        </div>
      </div>
      <SelectorTema className="mb-2" />
      {salir}
    </div>
  );

  const marca = (
    <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight text-lateral-fuerte">
      <Marca />
      <span className="leading-tight">Sistema de Tasas<span className="block text-xs font-normal tracking-normal text-lateral-texto">Cambios y saldos</span></span>
    </Link>
  );

  return (
    <>
      {/* Escritorio */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-lateral-borde bg-lateral lg:flex print:!hidden">
        <div className="border-b border-lateral-borde px-4 py-3.5">{marca}</div>
        <div className="flex-1 overflow-y-auto">{lista}</div>
        {usuario}
      </aside>
      {/* Celular y tableta */}
      <details ref={panel} className="group sticky top-0 z-20 border-b border-lateral-borde bg-lateral lg:hidden print:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
          {marca}
          <span className="rounded-md border border-lateral-borde px-2.5 py-1 text-xs font-medium text-lateral-texto group-open:border-primario/30 group-open:bg-lateral-activo group-open:text-primario">Menú</span>
        </summary>
        <div className="max-h-[75dvh] overflow-y-auto border-t border-lateral-borde">{lista}{usuario}</div>
      </details>
    </>
  );
}
