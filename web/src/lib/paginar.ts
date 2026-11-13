/**
 * Supabase (PostgREST) devuelve como máximo `max_rows` filas por consulta (1000 en local y en la nube) y corta el
 * resto SIN avisar, aunque se pida .limit(5000). Para reportes, exportaciones y sumas hay que pedir por páginas.
 *
 * `pedir(desde, hasta)` debe armar la consulta cada vez con un ORDEN DETERMINISTA (terminar en una columna única),
 * o las páginas pueden repetir o saltarse filas. Se sigue pidiendo hasta que llega una página vacía, así funciona
 * con cualquier `max_rows`. Si se pasa de `tope`, devuelve `truncado: true` para que la pantalla lo diga.
 */
export const PAGINA = 1000;
export const TOPE_FILAS = 100_000;

type Respuesta<T> = { data: T[] | null; error: { message: string } | null };

export async function traerTodo<T>(
  pedir: (desde: number, hasta: number) => PromiseLike<Respuesta<T>>,
  tope: number = TOPE_FILAS,
): Promise<{ data: T[]; error: { message: string } | null; truncado: boolean }> {
  const filas: T[] = [];
  for (;;) {
    const { data, error } = await pedir(filas.length, filas.length + PAGINA - 1);
    if (error) return { data: filas, error, truncado: false };
    const lote = data ?? [];
    if (!lote.length) return { data: filas, error: null, truncado: false };
    filas.push(...lote);
    if (filas.length > tope) return { data: filas.slice(0, tope), error: null, truncado: true };
  }
}

/** Mensaje para mostrar cuando un reporte se cortó en el tope. */
export const avisoTope = (tope: number = TOPE_FILAS) =>
  `Hay más de ${tope.toLocaleString("es-CO")} filas con estos filtros: se muestran las primeras. Acota las fechas o los filtros.`;
