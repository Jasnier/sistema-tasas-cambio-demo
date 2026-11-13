import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { parsearNumero } from "./numeros";

/** Resultado de una Server Action usada con <Formulario>. */
export type EstadoAccion = { error?: string; ok?: string; t?: number };

/**
 * Ejecuta el cuerpo de una acción y convierte cualquier error (de la app o de Postgres)
 * en un mensaje para el usuario, en vez de una pantalla de error.
 */
export async function ejecutar(ruta: string, cuerpo: () => Promise<string | void>): Promise<EstadoAccion> {
  try {
    const ok = await cuerpo();
    revalidatePath(ruta);
    return { ok: ok || "Guardado.", t: Date.now() };
  } catch (e) {
    // redirect() / notFound() de Next (p. ej. exigirPermiso, sesión vencida) no son errores de la acción:
    // si se atrapan, el usuario ve "NEXT_REDIRECT" en vez de ir a la página correcta
    unstable_rethrow(e);
    return { error: mensajeError(e), t: Date.now() };
  }
}

/** Lanza si Supabase devolvió error o no devolvió nada. */
export function revisar<T>(r: { data: T; error: { message: string; code?: string } | null }): NonNullable<T> {
  if (r.error) throw r.error;
  if (r.data == null) throw new Error("No se encontró el registro.");
  return r.data as NonNullable<T>;
}

/** Para acciones que no devuelven datos (update/delete sin select). */
export function revisarSinDatos(r: { error: { message: string; code?: string } | null }): void {
  if (r.error) throw r.error;
}

/**
 * Para update/delete que deben tocar una fila: se llama con `.select("id")`. Si la RLS o una condición
 * (p. ej. `.eq("estado", "MODIFICABLE")`) dejó el cambio en cero filas, Supabase NO devuelve error: sin esto
 * la acción respondería "hecho" sin haber cambiado nada.
 */
export function revisarCambio(r: { data: unknown[] | null; error: { message: string; code?: string } | null }, siNada: string): void {
  if (r.error) throw r.error;
  if (!r.data?.length) throw new Error(siNada);
}

function mensajeError(e: unknown): string {
  const err = e as { message?: string; code?: string };
  const msg = err?.message ?? String(e);
  if (err?.code === "42501" || /row-level security/i.test(msg)) return "No tienes permiso para hacer esto.";
  if (err?.code === "23505") return /id de transacción/.test(msg) ? msg : "Ya existe un registro con ese código.";
  if (err?.code === "23P01") return "Se cruza con otra vigencia ya publicada para el mismo par.";
  if (err?.code === "23503") return "Hace referencia a un dato que no existe (revisa monedas o cliente).";
  if (err?.code === "23514") return msg.startsWith("Vigencia") ? msg : "Algún valor no es válido: " + msg;
  return msg;
}

export function texto(fd: FormData, campo: string): string {
  return String(fd.get(campo) ?? "").trim();
}

/** Número del formulario. Rechaza lo ambiguo como "4.100" (ver parsearNumero). */
export function numero(fd: FormData, campo: string): number {
  return parsearNumero(texto(fd, campo), campo);
}
