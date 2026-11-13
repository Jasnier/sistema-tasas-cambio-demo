/**
 * Lecturas de las páginas. Supabase no lanza cuando una consulta falla: devuelve `{ data: null, error }`.
 * Con `const { data } = await …` un fallo (tiempo agotado, permiso, filtro inválido) se pintaba como
 * "0,00" o "sin datos", y en pantallas de dinero eso se toma por cierto. Estas funciones lanzan el error:
 * lo recoge app/(app)/error.tsx, que avisa y ofrece reintentar.
 */
type ConError = { error?: { message?: string; code?: string } | null };

function lanzar(error: NonNullable<ConError["error"]>): never {
  console.error("[datos] consulta fallida:", error.code ?? "", error.message ?? error);
  throw new Error("No se pudieron cargar los datos: " + (error.message ?? "error de la consulta"));
}

/** Una consulta: `const { data } = sinError(await supabase.from(…).select(…))`. */
export function sinError<T>(r: T): T {
  const e = (r as ConError | null)?.error;
  if (e) lanzar(e);
  return r;
}

/** Varias a la vez: `const [a, b] = sinErrores(await Promise.all([…]))`. */
export function sinErrores<T extends readonly unknown[]>(rs: T): T {
  for (const r of rs) sinError(r);
  return rs;
}
