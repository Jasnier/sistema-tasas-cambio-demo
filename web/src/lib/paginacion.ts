/**
 * Paginación de tablas (la misma en todas las pantallas). El número de página va en la URL
 * (?pag=2; si una pantalla tiene dos tablas, la segunda usa otro parámetro), así se puede
 * compartir el enlace y el botón Atrás del navegador funciona.
 */
export type Busqueda = Record<string, string | string[] | undefined>;

export const POR_PAGINA = 100;

export function leerPagina(sp: Busqueda, parametro = "pag"): number {
  const v = sp[parametro];
  const n = Number.parseInt(typeof v === "string" ? v : "1", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100000) : 1;
}

/** Filas desde/hasta (inclusive) para .range() de Supabase. */
export function rango(pagina: number, porPagina = POR_PAGINA): [number, number] {
  const desde = (pagina - 1) * porPagina;
  return [desde, desde + porPagina - 1];
}

/**
 * Enlace a otra página conservando los demás filtros de la URL (también los de selección múltiple, que llegan
 * como lista). `explicita`: escribe siempre el número, también "pag=1"; lo necesitan las pantallas que sin
 * "pag" abren en la ÚLTIMA página (Brasil, portal), o la primera quedaría inalcanzable.
 */
export function enlacePagina(ruta: string, sp: Busqueda, n: number, parametro = "pag", explicita = false): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === parametro) continue;
    for (const x of Array.isArray(v) ? v : [v]) if (typeof x === "string" && x) q.append(k, x);
  }
  if (n > 1 || explicita) q.set(parametro, String(n));
  const s = q.toString();
  return s ? `${ruta}?${s}` : ruta;
}

/** Para listas que ya están en memoria (porque los totales necesitan todas las filas): solo se pinta una página. */
export function cortar<T>(filas: T[], pagina: number, porPagina = POR_PAGINA): T[] {
  return filas.slice((pagina - 1) * porPagina, pagina * porPagina);
}
