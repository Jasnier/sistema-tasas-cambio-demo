import type { NextRequest } from "next/server";
import { obtenerSesion } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { celdaCsv, hoyBogota } from "@/lib/csv";
import { avisoTope, traerTodo } from "@/lib/paginar";
import { consultaMovimientos, fechaHora, leerFiltros, librosClienteGrande, type FilaMov } from "../datos";

/**
 * STW-23: exporta lo que muestra la bandeja (mismos filtros) a CSV para Excel en español:
 * separador ";", coma decimal y BOM UTF-8 para que las tildes se vean bien al abrirlo con doble clic.
 */
export async function GET(req: NextRequest) {
  const sesion = await obtenerSesion();
  if (!sesion.permisos.has("VER_MOVIMIENTOS")) return new Response("No tienes permiso para ver movimientos.", { status: 403 });

  const f = leerFiltros(req.nextUrl.searchParams);
  const supabase = await crearClienteServidor();
  // Igual que la bandeja: la administración no ve lo que el cliente grande registró y el operador aún no envía
  const ocultar = sesion.permisos.has("APROBAR_MOVIMIENTO") ? await librosClienteGrande(supabase) : [];
  const { data, error, truncado } = await traerTodo<FilaMov>((desde, hasta) => consultaMovimientos(supabase, f, undefined, 0, ocultar).range(desde, hasta));
  if (error) return new Response("No se pudo exportar: " + error.message, { status: 500 });
  if (truncado) return new Response(avisoTope(), { status: 413 });

  const cab = ["Código", "Libro", "Fecha operación", "Id transacción", "Tipo", "Modalidad", "CT", "Cliente", "Tercero",
    "Moneda origen", "Moneda destino", "Monto origen", "Descuento ×0,95", "Estado", "Tasa aplicada", "Monto destino", "Saldo después",
    "Observaciones", "Registrado"];
  const filas = ((data ?? []) as FilaMov[]).map((m) => [
    m.codigo, m.libro?.nombre ?? "", fechaHora(m.fecha_operacion), m.id_transaccion, m.tipo, m.modalidad, m.contraparte_id,
    m.contraparte?.nombre ?? "", m.tercero ?? "", m.moneda_origen, m.moneda_destino,
    Number(m.monto_origen).toFixed(2).replace(".", ","), m.descuento_tasa ? "SI" : "", m.estado,
    m.tasa_aplicada == null ? "" : String(m.tasa_aplicada).replace(".", ","),
    m.monto_destino == null ? "" : Number(m.monto_destino).toFixed(2).replace(".", ","),
    m.saldo_post == null ? "" : Number(m.saldo_post).toFixed(2).replace(".", ","), m.observaciones ?? "", fechaHora(m.creado_en),
  ]);
  const csv = "﻿" + [cab, ...filas].map((r) => r.map(celdaCsv).join(";")).join("\r\n");
  const hoy = hoyBogota();   // en UTC, después de las 7 p. m. salía con la fecha de mañana
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="movimientos-${hoy}.csv"`,
      "cache-control": "no-store",
    },
  });
}
