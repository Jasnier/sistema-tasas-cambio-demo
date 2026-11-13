import Link from "next/link";
import { redirect } from "next/navigation";
import { botonSuave, campo, chip } from "@/components/estilos";
import { ahoraMs } from "@/lib/fechas";
import { traerTodo } from "@/lib/paginar";
import { obtenerSesion } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { Cifra, Encabezado } from "@/components/ui";
import { SelectorMes, leerMes, mesesConDatos, nombreMes, parametroMes } from "../mes";

/**
 * STW-17: equivalente a las hojas RESUMEN y BINANCE de Brasil Paula.
 * - Saldos (resumen.js): por día y banco, el saldo al cierre del día (último total del día).
 * - Binance (resumenBinance.js): ventas a Binance; USDT = total BRL / tasa; KPIs y total USDT por banco.
 * Como en Sheets (un libro por mes con sus resúmenes), se ven por mes; el saldo sigue de un mes al otro.
 */
type Dia = { banco_id: string; fecha: string; entradas: number | null; salidas: number | null; saldo_cierre: number };
type Venta = { codigo: string; banco_id: string; fecha: string; valor: number; tasa_binance: number; usdt: number };

const brl = (n: number | null | undefined) => (n == null ? "" : Number(n).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const usdt = (n: number) => Number(n).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uno = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const fechaValida = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
const dma = (iso: string) => iso.split("-").reverse().join("/");

export default async function PaginaResumenBrasil({ searchParams }: PageProps<"/brasil/resumen">) {
  const sesion = await obtenerSesion();
  if (!["BRASIL_CARGAR", "BRASIL_APROPIAR", "APROBAR_MOVIMIENTO"].some((p) => sesion.permisos.has(p))) redirect("/?sin_permiso=BRASIL_CARGAR");

  const sp = await searchParams;
  const vista = uno(sp.v) === "binance" ? "binance" : "saldos";
  const hoy = new Date((await ahoraMs()) - 5 * 3600 * 1000).toISOString().slice(0, 10); // Bogotá
  const m = leerMes(sp.mes, hoy);
  const desde = fechaValida(uno(sp.desde));
  const hasta = fechaValida(uno(sp.hasta));
  const supabase = await crearClienteServidor();

  // Saldo por banco y día de todo el historial: el saldo inicial del mes es el último cierre anterior
  const [{ data: bancosData }, { data: dias, error: errorDias }] = await Promise.all([
    supabase.from("banco_brasil").select("id, nombre").eq("activo", true).order("orden"),
    traerTodo<Dia>((d, h) => supabase.from("resumen_brasil_dia").select("banco_id, fecha, entradas, salidas, saldo_cierre")
      .order("fecha").order("banco_id").range(d, h)),
  ]);
  const bancos = (bancosData ?? []) as { id: string; nombre: string }[];
  const enRango = (fecha: string) => (m.todos || (fecha >= m.inicio && fecha <= m.fin)) && (!desde || fecha >= desde) && (!hasta || fecha <= hasta);

  const enlace = (cambios: Record<string, string>) => {
    const base = { v: vista === "binance" ? "binance" : "", mes: parametroMes(m), desde, hasta, ...cambios };
    const p = new URLSearchParams(Object.entries(base).filter(([, x]) => x));
    return `/brasil/resumen${p.size ? "?" + p : ""}`;
  };
  // Cambiar de mes quita el rango de fechas (sería de otro mes)
  const enlaceMes = (x: string) => enlace({ mes: x === m.actual ? "" : x, desde: "", hasta: "" });
  const pestaña = (v: string, etiqueta: string) => <Link href={enlace({ v: v === "binance" ? "binance" : "" })} className={chip(vista === v)}>{etiqueta}</Link>;
  const filtros = (
    <form className="flex flex-wrap items-end gap-2 text-sm">
      {vista === "binance" && <input type="hidden" name="v" value="binance" />}
      {parametroMes(m) && <input type="hidden" name="mes" value={parametroMes(m)} />}
      <label className="flex flex-col">Desde<input type="date" name="desde" defaultValue={desde} className={campo}
        min={m.todos ? undefined : m.inicio} max={m.todos ? undefined : m.fin} /></label>
      <label className="flex flex-col">Hasta<input type="date" name="hasta" defaultValue={hasta} className={campo}
        min={m.todos ? undefined : m.inicio} max={m.todos ? undefined : m.fin} /></label>
      <button className={botonSuave}>Ver</button>
      {(desde || hasta) && <Link href={enlace({ desde: "", hasta: "" })} className="text-xs underline">Quitar fechas</Link>}
    </form>
  );
  const periodo = m.todos ? "todo el historial" : nombreMes(m.mes);

  let cuerpo: React.ReactNode;
  if (vista === "saldos") {
    const porFecha = new Map<string, Map<string, Dia>>();
    for (const d of dias.filter((x) => enRango(x.fecha)).reverse()) {   // del más reciente al más antiguo
      if (!porFecha.has(d.fecha)) porFecha.set(d.fecha, new Map());
      porFecha.get(d.fecha)!.set(d.banco_id, d);
    }
    // Primera fila del libro del mes: el saldo con que arranca cada banco
    const inicial = new Map<string, number>();
    if (!m.todos) for (const d of dias) if (d.fecha < m.inicio) inicial.set(d.banco_id, Number(d.saldo_cierre));
    cuerpo = (
      <>
        {errorDias && <p role="alert" className="text-sm text-peligro">{errorDias.message}</p>}
        <p className="text-sm text-tenue">Saldo al cierre de cada día por banco (BRL), {periodo}: saldo inicial + entradas − salidas, ventas a Binance incluidas,
          sin anulados. Si un banco no tuvo movimientos ese día, la celda queda vacía (como en la hoja RESUMEN).</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-borde text-left">
              <th className="px-2 py-2">Fecha</th>
              {bancos.map((b) => <th key={b.id} className="px-2 py-2 text-right whitespace-nowrap">{b.nombre}</th>)}
            </tr></thead>
            <tbody>
              {[...porFecha.entries()].map(([fecha, fila]) => (
                <tr key={fecha} className="border-b border-borde/70">
                  <td className="px-2 py-1 whitespace-nowrap">{dma(fecha)}</td>
                  {bancos.map((b) => {
                    const d = fila.get(b.id);
                    return (
                      <td key={b.id} className="px-2 py-1 text-right tabular-nums"
                        title={d ? `Entradas ${brl(d.entradas ?? 0)} · Salidas ${brl(d.salidas ?? 0)}` : undefined}>
                        {d ? brl(d.saldo_cierre) : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {porFecha.size === 0 && <tr><td colSpan={bancos.length + 1} className="px-2 py-4 text-tenue">Sin movimientos en {periodo}.</td></tr>}
              {!m.todos && !desde && (
                <tr className="bg-superficie-2/60 font-medium" title="Cierre del mes anterior: se calcula solo, no hay que registrarlo">
                  <td className="px-2 py-1.5 whitespace-nowrap">Saldo inicial del mes</td>
                  {bancos.map((b) => <td key={b.id} className="px-2 py-1.5 text-right tabular-nums">{inicial.has(b.id) ? brl(inicial.get(b.id)) : ""}</td>)}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </>
    );
  } else {
    const { data: ventasData, error } = await traerTodo<Venta>((d, h) => {
      let q = supabase.from("comprobante_brasil").select("codigo, banco_id, fecha, valor, tasa_binance, usdt").eq("clase", "BINANCE").neq("estado", "ANULADO");
      if (!m.todos) q = q.gte("fecha", m.inicio).lte("fecha", m.fin);
      if (desde) q = q.gte("fecha", desde);
      if (hasta) q = q.lte("fecha", hasta);
      return q.order("fecha", { ascending: false }).order("codigo").range(d, h);
    });
    const ventas = ventasData;
    const totalUsdt = ventas.reduce((s, v) => s + Number(v.usdt), 0);
    const totalBrl = ventas.reduce((s, v) => s + Number(v.valor), 0);
    const promedio = ventas.length ? ventas.reduce((s, v) => s + Number(v.tasa_binance), 0) / ventas.length : 0; // promedio simple, como la hoja
    const porBanco = new Map(bancos.map((b) => [b.id, 0]));
    for (const v of ventas) porBanco.set(v.banco_id, (porBanco.get(v.banco_id) ?? 0) + Number(v.usdt));
    const kpis: [string, string][] = [
      ["Total USDT", usdt(totalUsdt)], ["Total BRL", brl(totalBrl)], ["Operaciones", String(ventas.length)],
      ["Promedio tasa", promedio ? promedio.toLocaleString("es-CO", { maximumFractionDigits: 4 }) : "0"], ["Bancos", String(bancos.length)],
    ];
    const nombre = Object.fromEntries(bancos.map((b) => [b.id, b.nombre]));
    cuerpo = (
      <>
        {error && <p role="alert" className="text-sm text-peligro">{error.message}</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {kpis.map(([k, v], i) => <Cifra key={k} etiqueta={k} valor={v} tono={i === 0 ? "primario" : "neutro"} detalle={i === 0 ? periodo : undefined} />)}
        </div>
        <p className="text-xs text-tenue">«Promedio tasa» es el promedio simple de las tasas, igual que la hoja BINANCE (no ponderado por monto).</p>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <div className="overflow-x-auto rounded-lg border border-borde bg-superficie p-2 shadow-xs">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-borde text-left"><th className="px-2 py-2">Banco</th><th className="px-2 py-2 text-right">Total USDT</th></tr></thead>
            <tbody>{[...porBanco.entries()].map(([id, t]) => (
              <tr key={id} className="border-b border-borde/70"><td className="px-2 py-1">{nombre[id] ?? id}</td><td className="px-2 py-1 text-right tabular-nums">{usdt(t)}</td></tr>
            ))}</tbody>
          </table>
          </div>
          <div className="overflow-x-auto rounded-lg border border-borde bg-superficie p-2 shadow-xs">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-borde text-left">
              <th className="px-2 py-2">Fecha</th><th className="px-2 py-2">Banco</th><th className="px-2 py-2 text-right">Total BRL</th>
              <th className="px-2 py-2 text-right">Tasa</th><th className="px-2 py-2 text-right">USDT</th><th className="px-2 py-2">Código</th>
            </tr></thead>
            <tbody>
              {ventas.map((v) => (
                <tr key={v.codigo} className="border-b border-borde/70">
                  <td className="px-2 py-1 whitespace-nowrap">{dma(v.fecha)}</td><td className="px-2 py-1">{nombre[v.banco_id] ?? v.banco_id}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{brl(v.valor)}</td><td className="px-2 py-1 text-right tabular-nums">{v.tasa_binance}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{usdt(v.usdt)}</td><td className="px-2 py-1 font-mono text-xs">{v.codigo}</td>
                </tr>
              ))}
              {ventas.length === 0 && <tr><td colSpan={6} className="px-2 py-4 text-tenue">Sin ventas a Binance en {periodo}.</td></tr>}
            </tbody>
          </table>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="space-y-4">
      <Encabezado titulo="Brasil · resumen" descripcion="Resumen de cada mes, como en Sheets: saldos por día y ventas a Binance." />
      <SelectorMes m={m} meses={mesesConDatos(dias.map((d) => d.fecha), m)} enlace={enlaceMes} />
      <nav className="flex gap-2 text-sm">{pestaña("saldos", "Saldos por día")}{pestaña("binance", "Binance")}</nav>
      {filtros}
      {cuerpo}
    </div>
  );
}
