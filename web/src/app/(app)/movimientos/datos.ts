import type { SupabaseClient } from "@supabase/supabase-js";

/** Filtros de la bandeja (STW-23). Los usa la página y la exportación, para que exporten lo mismo que se ve. */
export type Filtros = {
  libro: string; estado: string; contraparte: string; moneda: string; modalidad: string;
  tipo: string; q: string; desde: string; hasta: string;
  /** Libro de un operador: lo de su libro y lo de los libros de cliente grande que atiende */
  operador: string;
};

const CAMPOS: (keyof Filtros)[] = ["operador", "libro", "estado", "contraparte", "moneda", "modalidad", "tipo", "q", "desde", "hasta"];
export const ESTADOS = ["BORRADOR", "ENVIADO_OPERADOR", "VERIFICADO", "APROBADO", "RECHAZADO", "ANULADO"];

export function leerFiltros(sp: Record<string, string | string[] | undefined> | URLSearchParams): Filtros {
  const get = (k: string) => {
    const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k];
    return typeof v === "string" ? v.trim() : "";
  };
  const f = Object.fromEntries(CAMPOS.map((k) => [k, get(k)])) as Filtros;
  if (f.estado && f.estado !== "ACTIVOS" && !ESTADOS.includes(f.estado)) f.estado = "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.desde)) f.desde = "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.hasta)) f.hasta = "";
  if (!/^[0-9a-f-]{36}$/i.test(f.libro)) f.libro = "";
  if (!/^[0-9a-f-]{36}$/i.test(f.operador)) f.operador = "";
  if (!["ENTRADA", "SALIDA"].includes(f.tipo)) f.tipo = "";
  if (!["TRANSFERENCIA", "EFECTIVO"].includes(f.modalidad)) f.modalidad = "";
  // La moneda entra a un filtro .or(): solo letras, números, espacio y guiones (nada que añada condiciones)
  if (!/^[\p{L}\p{N} _-]{1,30}$/u.test(f.moneda)) f.moneda = "";
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(f.contraparte)) f.contraparte = "";
  // Lo que va dentro de un filtro .or() de PostgREST no puede llevar comas, paréntesis ni comodines
  f.q = f.q.replace(/[,()%*\\]/g, " ").slice(0, 60).trim();
  return f;
}

export function aQuery(f: Partial<Filtros>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? "?" + s : "";
}

export const COLUMNAS =
  "id, codigo, libro_id, id_transaccion, tipo, fecha_operacion, modalidad, contraparte_id, tercero, moneda_origen, moneda_destino, " +
  "monto_origen, descuento_tasa, observaciones, estado, duplicado_confirmado, verificado_en, creado_en, recibido_en_id, empresa_id, " +
  "tasa_aplicada, monto_destino, saldo_post, aprobado_en, aprobacion_error, rechazado_motivo, periodo_id, " +
  "contraparte(nombre), libro:libro!movimiento_libro_id_fkey(prefijo, nombre, tipo)";

export type FilaMov = {
  id: string; codigo: string; libro_id: string; id_transaccion: string; tipo: "ENTRADA" | "SALIDA"; fecha_operacion: string;
  modalidad: string; contraparte_id: string; tercero: string | null; moneda_origen: string; moneda_destino: string;
  monto_origen: number; descuento_tasa: boolean; observaciones: string | null; estado: string; duplicado_confirmado: boolean;
  verificado_en: string | null; creado_en: string; recibido_en_id: string | null; empresa_id: string | null;
  tasa_aplicada: number | null; monto_destino: number | null; saldo_post: number | null; aprobado_en: string | null;
  aprobacion_error: string | null; rechazado_motivo: string | null; periodo_id: string | null;
  contraparte: { nombre: string } | null; libro: { prefijo: string; nombre: string; tipo: string } | null;
};

/**
 * Consulta de la bandeja con los filtros. Con `limite` trae una página (desde la fila `desde`) y el total (`count`); sin `limite`
 * queda lista para paginar con .range() (exportación: Supabase corta en max_rows = 1000, ver lib/paginar).
 * El orden termina en `codigo` (único), así las páginas no repiten ni saltan filas.
 */
export function consultaMovimientos(supabase: SupabaseClient, f: Filtros, limite?: number, desde = 0,
  /** Administración: libros de cliente grande cuyos BORRADORES no ve (el cliente lo registró pero el operador aún no lo envía) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ocultarBorradoresDe: string[] = []): any {
  // Con filtro de operador el libro se une con !inner para poder filtrar por él (id o su operador)
  const columnas = f.operador ? COLUMNAS.replace("movimiento_libro_id_fkey(", "movimiento_libro_id_fkey!inner(") : COLUMNAS;
  let q = supabase.from("movimiento").select(columnas, limite ? { count: "exact" } : undefined)
    .order("fecha_operacion", { ascending: false }).order("codigo", { ascending: false });
  if (limite) q = q.range(desde, desde + limite - 1);
  if (f.libro) q = q.eq("libro_id", f.libro);
  if (f.operador) q = q.or(`id.eq.${f.operador},operador_id.eq.${f.operador}`, { referencedTable: "libro" });
  if (ocultarBorradoresDe.length) q = q.or(`estado.neq.BORRADOR,libro_id.not.in.(${ocultarBorradoresDe.join(",")})`);
  if (f.estado === "ACTIVOS" || !f.estado) q = q.neq("estado", "ANULADO");
  else q = q.eq("estado", f.estado);
  if (f.contraparte) q = q.eq("contraparte_id", f.contraparte);
  if (f.moneda) q = q.or(`moneda_origen.eq.${f.moneda},moneda_destino.eq.${f.moneda}`);
  if (f.modalidad) q = q.eq("modalidad", f.modalidad);
  if (f.tipo) q = q.eq("tipo", f.tipo);
  if (f.q) q = q.or(`codigo.ilike.*${f.q}*,id_transaccion.ilike.*${f.q}*,tercero.ilike.*${f.q}*,observaciones.ilike.*${f.q}*`);
  if (f.desde) q = q.gte("fecha_operacion", `${f.desde}T00:00:00-05:00`);
  if (f.hasta) q = q.lte("fecha_operacion", `${f.hasta}T23:59:59.999-05:00`);
  return q;
}

/** Libros de cliente grande (para ocultarle a la administración lo que el operador todavía no ha enviado). */
export async function librosClienteGrande(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from("libro").select("id").eq("tipo", "cliente_grande");
  // Si falla no se puede seguir "sin ocultar nada": la administración vería (y exportaría) borradores ajenos
  if (error) throw new Error("No se pudieron cargar los libros: " + error.message);
  return (data ?? []).map((l) => l.id as string);
}

/** Catálogos activos para el formulario y los filtros. */
export async function catalogos(supabase: SupabaseClient) {
  const [libros, monedas, recibidos, empresas, contrapartes] = await Promise.all([
    supabase.from("libro").select("id, codigo, prefijo, nombre, tipo, contraparte_id").in("tipo", ["operador", "cliente_grande"]).eq("activo", true)
      .order("tipo", { ascending: false }).order("nombre"),
    supabase.from("moneda").select("nombre").eq("activo", true).order("orden"),
    supabase.from("recibido_en").select("id, nombre").eq("activo", true).order("orden"),
    supabase.from("empresa").select("id, nombre").eq("activo", true).order("orden"),
    supabase.from("contraparte").select("id, nombre, tipo").eq("activo", true).order("nombre"),
  ]);
  return {
    libros: (libros.data ?? []) as Libro[],
    monedas: (monedas.data ?? []).map((m) => m.nombre as string),
    recibidos: (recibidos.data ?? []) as Item[],
    empresas: (empresas.data ?? []) as Item[],
    contrapartes: (contrapartes.data ?? []) as (Item & { tipo: string })[],
  };
}

export type Libro = { id: string; codigo: string; prefijo: string; nombre: string; tipo: string; contraparte_id: string | null };
export type Item = { id: string; nombre: string };

/** Pares parecidos (STW-25) de los movimientos mostrados: id → códigos de los otros. */
export async function parecidos(supabase: SupabaseClient, ids: string[]): Promise<Map<string, string[]>> {
  const mapa = new Map<string, string[]>();
  // Lotes de 80 (límite de largo de la URL), todos a la vez: con 1000 filas eran 13 viajes uno tras otro
  const lotes: string[][] = [];
  for (let i = 0; i < ids.length; i += 80) lotes.push(ids.slice(i, i + 80));
  const respuestas = await Promise.all(lotes.map((lote) => supabase.from("movimiento_parecido").select("id, otro_codigo").in("id", lote)));
  for (const { data } of respuestas) for (const r of data ?? []) mapa.set(r.id, [...(mapa.get(r.id) ?? []), r.otro_codigo]);
  return mapa;
}

/** Tasa como la muestra el Motor: hasta 6 decimales, sin ceros de más ("1.080", "0,000918"). */
export function tasa(n: number | string | null | undefined): string {
  if (n == null) return "";
  return Number(n).toLocaleString("es-CO", { maximumFractionDigits: 6 });
}

/** Fecha y hora de Bogotá para mostrar en tablas: "05/11/2026 09:30". */
export function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Partes de Bogotá para inputs date/time. */
export function partesBogota(iso: string): { fecha: string; hora: string } {
  const d = new Date(Date.parse(iso) - 5 * 3600 * 1000).toISOString();
  return { fecha: d.slice(0, 10), hora: d.slice(11, 16) };
}
