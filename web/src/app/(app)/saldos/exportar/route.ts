import type { NextRequest } from "next/server";
import { obtenerSesion } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { celdaCsv } from "@/lib/csv";
import { avisoTope, traerTodo } from "@/lib/paginar";

/** STW-38: resumen de saldos (cliente × moneda × modalidad) en CSV para Excel en español. */
export async function GET(req: NextRequest) {
  const sesion = await obtenerSesion();
  if (!sesion.permisos.has("VER_REPORTES")) return new Response("No tienes permiso para ver reportes.", { status: 403 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toUpperCase();
  const moneda = req.nextUrl.searchParams.get("moneda") ?? "";
  const supabase = await crearClienteServidor();
  type Fila = { contraparte_id: string; nombre: string; tipo: string; moneda: string; modalidad: string; saldo: number; ultima_secuencia: number };
  // Por páginas (Supabase corta en max_rows = 1000); el orden termina en la clave del bucket.
  const { data, error, truncado } = await traerTodo<Fila>((d, h) => {
    let c = supabase.from("saldo_cliente").select("contraparte_id, nombre, tipo, moneda, modalidad, saldo, ultima_secuencia");
    if (moneda) c = c.eq("moneda", moneda);
    return c.order("nombre").order("contraparte_id").order("moneda").order("modalidad").range(d, h);
  });
  if (error) return new Response("No se pudo exportar: " + error.message, { status: 500 });
  if (truncado) return new Response(avisoTope(), { status: 413 });
  const filas = data.filter((s) => !q || String(s.nombre).includes(q) || String(s.contraparte_id).includes(q));
  const csv = "﻿" + [["CT", "Cliente", "Tipo", "Moneda", "Modalidad", "Saldo", "Movimientos"],
    ...filas.map((s) => [s.contraparte_id, s.nombre, s.tipo, s.moneda, s.modalidad, Number(s.saldo).toFixed(2).replace(".", ","), String(s.ultima_secuencia)])]
    .map((r) => r.map((v) => celdaCsv(String(v))).join(";")).join("\r\n");
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="resumen-saldos.csv"', "cache-control": "no-store" },
  });
}
