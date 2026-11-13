import type { NextRequest } from "next/server";
import { obtenerSesion } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { avisoTope } from "@/lib/paginar";
import { fechaHora } from "../../movimientos/datos";
import { estadoDeCuenta, leerFiltroCuenta } from "../datos";

/** STW-39: el estado de cuenta en CSV para Excel en español (";" y coma decimal, con BOM). */
export async function GET(req: NextRequest) {
  const sesion = await obtenerSesion();
  if (!sesion.permisos.has("VER_REPORTES")) return new Response("No tienes permiso para ver reportes.", { status: 403 });
  const f = leerFiltroCuenta(req.nextUrl.searchParams);
  if (!f.ct || !f.moneda) return new Response("Falta el cliente o la moneda.", { status: 400 });
  const supabase = await crearClienteServidor();
  const c = await estadoDeCuenta(supabase, f);
  if (c.truncado) return new Response(avisoTope(), { status: 413 });
  const n = (v: number | null | undefined) => (v == null ? "" : Number(v).toFixed(2).replace(".", ","));
  const filas: string[][] = [
    [`Estado de cuenta ${f.ct}`, f.moneda, f.modalidad, f.desde || "inicio", f.hasta || "hoy"],
    [],
    ["Fecha", "Código", "Libro", "Tipo", "Id transacción", "Tercero", "Moneda origen", "Monto origen", "Tasa", "Entrada", "Salida", "Saldo", "Período", "De otro libro"],
    ["", "", "", "", "", "", "", "", "", "", "", n(c.saldoInicial), "Saldo inicial", ""],
    // Los movimientos de otro libro llegan sin id de transacción ni tercero (migración 2000)
    ...c.lineas.map((l) => [fechaHora(l.fecha_operacion), l.codigo, l.libro?.nombre ?? "", l.tipo, l.id_transaccion ?? "", l.tercero ?? "",
      l.moneda_origen, n(l.monto_origen), String(l.tasa_aplicada).replace(".", ","), n(l.entrada), n(l.salida), n(l.saldo_post), l.periodo_id ?? "",
      l.es_propio ? "" : "SI"]),
    ["", "", "", "", "", "", "", "", "Totales", n(c.entradas), n(c.salidas), n(c.saldoFinal), "", ""],
  ];
  const celda = (v: string) => {
    const s = /^[=+\-@\t\r]/.test(v) && !/^-?\d+(,\d+)?$/.test(v) ? "'" + v : v;
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + filas.map((r) => r.map(celda).join(";")).join("\r\n");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="estado-cuenta-${f.ct}-${f.moneda}-${f.modalidad}.csv"`,
      "cache-control": "no-store",
    },
  });
}
