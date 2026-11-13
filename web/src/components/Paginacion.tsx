import Link from "next/link";
import { botonSuave } from "./estilos";
import { POR_PAGINA, enlacePagina, type Busqueda } from "@/lib/paginacion";

/**
 * Barra de páginas: "101–200 de 2.345 · ‹ Anterior · Página 2 de 24 · Siguiente ›".
 * No se muestra si todo cabe en una página. Server Component (los enlaces son de servidor).
 */
export function Paginacion({ ruta, sp, total, pagina, porPagina = POR_PAGINA, parametro = "pag", className = "", explicita = false }: {
  ruta: string; sp: Busqueda; total: number; pagina: number; porPagina?: number; parametro?: string; className?: string;
  /** La pantalla abre en la última página cuando no hay "pag": los enlaces escriben siempre el número. */
  explicita?: boolean;
}) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (paginas <= 1) return null;
  const actual = Math.min(pagina, paginas);
  const ir = (n: number) => enlacePagina(ruta, sp, n, parametro, explicita);
  const n = (x: number) => x.toLocaleString("es-CO");
  return (
    <nav aria-label="Páginas" className={`flex flex-wrap items-center justify-between gap-2 text-sm ${className}`}>
      <span className="text-tenue tabular-nums">
        {n((actual - 1) * porPagina + 1)}–{n(Math.min(actual * porPagina, total))} de {n(total)}
      </span>
      <span className="flex items-center gap-1">
        {actual > 1 && <>
          <Link href={ir(1)} className={botonSuave} aria-label="Primera página">«</Link>
          <Link href={ir(actual - 1)} className={botonSuave}>‹ Anterior</Link>
        </>}
        <span className="px-2 tabular-nums">Página {n(actual)} de {n(paginas)}</span>
        {actual < paginas && <>
          <Link href={ir(actual + 1)} className={botonSuave}>Siguiente ›</Link>
          <Link href={ir(paginas)} className={botonSuave} aria-label="Última página">»</Link>
        </>}
      </span>
    </nav>
  );
}
