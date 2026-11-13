import { connection } from "next/server";

/** Fechas: la operación es en Colombia (UTC−5, sin horario de verano). */
export const ZONA = "America/Bogota";

/** "2026-11-10T08:30" (input datetime-local, hora de Bogotá) → ISO con zona. */
export function desdeInputBogota(valor: string): string {
  if (!valor) throw new Error("Falta la fecha");
  const conSegundos = valor.length === 16 ? valor + ":00" : valor;
  return `${conSegundos}-05:00`;
}

/** ISO/timestamptz → "2026-11-10T08:30" para un input datetime-local en hora de Bogotá. */
export function aInputBogota(iso: string | null): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "";
  const d = new Date(Date.parse(iso) - 5 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
}

export function mostrarFecha(iso: string | null): string {
  if (!iso) return "";
  if (iso === "infinity") return "sin fin";
  if (iso === "-infinity") return "desde siempre";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString("es-CO", { timeZone: ZONA, dateStyle: "short", timeStyle: "short" });
}

/** Postgres tstzrange como texto: '["2026-11-10 13:00:00+00","infinity"]' → extremos. */
export function leerRango(r: string | null): { desde: string | null; hasta: string | null } {
  if (!r) return { desde: null, hasta: null };
  const m = r.match(/^[[(]"?([^",]*)"?,"?([^"\])]*)"?[\])]$/);
  if (!m) return { desde: null, hasta: null };
  return { desde: m[1] || null, hasta: m[2] || null };
}

/**
 * ¿La vigencia [desde, hasta] cubre el instante `ahora`? Los históricos migrados empiezan en "-infinity"
 * y los abiertos terminan en "infinity": Date.parse no los entiende (da NaN) y salían como no vigentes.
 */
export function vigenteEn(desde: string | null, hasta: string | null, ahora: number): boolean {
  if (!desde || !hasta) return false;
  const ini = desde === "-infinity" ? -Infinity : Date.parse(desde);
  const fin = hasta === "infinity" ? Infinity : Date.parse(hasta);
  return ini <= ahora && fin >= ahora;
}

/** Rango cerrado '[desde, hasta]' para enviar a Postgres. */
export function rango(desdeIso: string, hastaIso: string): string {
  return `[${desdeIso},${hastaIso}]`;
}

/**
 * Hora actual, para páginas del servidor. Antes de leerla avisa a Next.js que la página se arma en cada
 * petición (connection()); si no, Next intenta prerenderizarla y muestra "unstable value Date.now()".
 * Va fuera del cuerpo de los componentes por la regla de pureza de React.
 */
export async function ahoraMs(): Promise<number> {
  await connection();
  return Date.now();
}
