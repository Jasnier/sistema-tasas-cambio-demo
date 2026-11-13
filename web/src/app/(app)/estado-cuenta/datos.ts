import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/paginar";

/** STW-39: un bucket (cliente × moneda destino × modalidad) en un rango de fechas. */
export type FiltroCuenta = { ct: string; moneda: string; modalidad: string; desde: string; hasta: string };

export type LineaCuenta = {
  id: string; codigo: string; fecha_operacion: string; tipo: string; id_transaccion: string; tercero: string | null;
  moneda_origen: string; monto_origen: number; tasa_aplicada: number; entrada: number; salida: number;
  saldo_anterior: number; saldo_post: number; secuencia_bucket: number; periodo_id: string | null;
  libro: { nombre: string } | null;
  /** false = de otro libro (otro operador, o el operador del cliente grande): se muestra en tono claro y no se edita */
  es_propio: boolean;
};
type FilaRpc = Omit<LineaCuenta, "libro"> & { libro_nombre: string };

export function leerFiltroCuenta(sp: Record<string, string | string[] | undefined> | URLSearchParams): FiltroCuenta {
  const get = (k: string) => {
    const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k];
    return typeof v === "string" ? v.trim() : "";
  };
  const fecha = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  return {
    ct: /^CT-\d+$/.test(get("ct")) ? get("ct") : "",
    moneda: get("moneda").toUpperCase().slice(0, 30),
    modalidad: ["EFECTIVO", "TRANSFERENCIA"].includes(get("modalidad")) ? get("modalidad") : "TRANSFERENCIA",
    desde: fecha(get("desde")), hasta: fecha(get("hasta")),
  };
}

/**
 * Movimientos aprobados del bucket en orden de aprobación (el orden del saldo, P-9), de TODOS los libros
 * (migración 2000, función estado_cuenta): así el saldo cuadra fila por fila aunque el cliente esté en dos
 * operadores; los ajenos llegan con es_propio = false y sin id de transacción ni tercero. La base decide quién
 * puede ver el código (administración, el operador si es su cliente, el cliente grande el suyo).
 * El saldo inicial del rango es el saldo_anterior del primero; si no hay movimientos, el último antes de "desde".
 */
export async function estadoDeCuenta(supabase: SupabaseClient, f: FiltroCuenta) {
  const args = { p_ct: f.ct, p_moneda: f.moneda, p_modalidad: f.modalidad, p_desde: f.desde || null, p_hasta: f.hasta || null };
  // Por páginas: Supabase corta cada respuesta en max_rows (1000) y el saldo final saldría del movimiento 1000.
  const { data, error, truncado } = await traerTodo<FilaRpc>((desde, hasta) =>
    supabase.rpc("estado_cuenta", args).range(desde, hasta) as unknown as PromiseLike<{ data: FilaRpc[] | null; error: { message: string } | null }>);
  if (error) throw new Error(error.message);
  const lineas: LineaCuenta[] = data.map(({ libro_nombre, ...l }) => ({ ...l, libro: { nombre: libro_nombre } }));

  let saldoInicial = lineas.length ? Number(lineas[0].saldo_anterior) : 0;
  if (!lineas.length && f.desde) {
    const { data: previo, error: e2 } = await supabase.rpc("saldo_bucket_antes",
      { p_ct: f.ct, p_moneda: f.moneda, p_modalidad: f.modalidad, p_desde: f.desde });
    if (e2) throw new Error(e2.message);
    saldoInicial = Number(previo ?? 0);
  }
  const entradas = lineas.reduce((a, l) => a + Number(l.entrada), 0);
  const salidas = lineas.reduce((a, l) => a + Number(l.salida), 0);
  const saldoFinal = lineas.length ? Number(lineas[lineas.length - 1].saldo_post) : saldoInicial;
  const ajenos = lineas.filter((l) => !l.es_propio).length;
  return { lineas, saldoInicial, entradas, salidas, saldoFinal, truncado, ajenos };
}
