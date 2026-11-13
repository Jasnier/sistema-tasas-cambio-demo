import Link from "next/link";
import { botonSuave, campo, chip } from "@/components/estilos";
import { ahoraMs } from "@/lib/fechas";
import { obtenerSesion } from "@/lib/sesion";
import { sinError, sinErrores } from "@/lib/supabase/datos";
import { crearClienteServidor } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Cifra, Encabezado, Insignia } from "@/components/ui";
import { Paginacion } from "@/components/Paginacion";
import { POR_PAGINA, leerPagina, rango } from "@/lib/paginacion";
import { traerTodo } from "@/lib/paginar";
import { FormularioComprobante } from "./FormularioComprobante";
import { SelectorMes, leerMes, mesesConDatos as listaMeses, parametroMes } from "./mes";

type Comprobante = {
  id: string; codigo: string; banco_id: string; fecha: string; id_tx: string; remitente: string | null;
  observacion: string | null; tipo: "ENTRADA" | "SALIDA"; valor: number; estado: string; anulado_motivo: string | null;
  clase: "COMPROBANTE" | "SALDO_INICIAL" | "BINANCE"; tasa_binance: number | null; usdt: number | null; codigo_brs: string | null;
  contraparte_id: string | null; cliente: { nombre: string } | null;
};

/**
 * A quien carga solo le interesa si su comprobante ya se apropió o no. "Pendiente" agrupa lo que sigue en
 * la bandeja (pendiente, tomado por alguien o con error); "Apropiado" es lo aplicado. Los anulados no se listan.
 */
const ESTADOS: Record<string, { etiqueta: string; valores: string[] }> = {
  pendiente: { etiqueta: "Pendientes", valores: ["PENDIENTE", "EN_PROCESO", "ERROR"] },
  apropiado: { etiqueta: "Apropiados", valores: ["APLICADO"] },
};
const dinero = (n: number) => Number(n).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uno = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
const fechaValida = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
type Dia = { banco_id: string; fecha: string; entradas: number | null; salidas: number | null; saldo_cierre: number };

export default async function PaginaBrasil({ searchParams }: PageProps<"/brasil">) {
  const sesion = await obtenerSesion();
  const puedeCargar = sesion.permisos.has("BRASIL_CARGAR");
  if (!puedeCargar && !sesion.permisos.has("BRASIL_APROPIAR") && !sesion.permisos.has("APROBAR_MOVIMIENTO")) {
    redirect("/?sin_permiso=BRASIL_CARGAR");
  }

  const sp = await searchParams;
  const banco = uno(sp.banco);
  const desde = fechaValida(uno(sp.desde));
  const hasta = fechaValida(uno(sp.hasta));
  const tipo = ["ENTRADA", "SALIDA"].includes(uno(sp.tipo)) ? uno(sp.tipo) : "";
  const estado = ESTADOS[uno(sp.estado)] ? uno(sp.estado) : "";
  const q = uno(sp.q).replace(/[,()*%\\]/g, " ").trim().slice(0, 60);
  const hoy = new Date((await ahoraMs()) - 5 * 3600 * 1000).toISOString().slice(0, 10); // Bogotá
  // Como los libros mensuales de Sheets: por defecto se ve el mes en curso; "todos" quita la separación
  const m = leerMes(sp.mes, hoy);
  const { todos: todosLosMeses, mes, inicio: inicioMes, fin: finMes } = m;

  const supabase = await crearClienteServidor();
  // Los mismos filtros para la página que se ve y para los totales (que suman todo lo filtrado)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filtrar = (consulta: any) => {
    if (banco) consulta = consulta.eq("banco_id", banco);
    if (!todosLosMeses) consulta = consulta.gte("fecha", inicioMes).lte("fecha", finMes);
    if (desde) consulta = consulta.gte("fecha", desde);
    if (hasta) consulta = consulta.lte("fecha", hasta);
    if (tipo) consulta = consulta.eq("tipo", tipo);
    consulta = estado ? consulta.in("estado", ESTADOS[estado].valores) : consulta.neq("estado", "ANULADO");
    if (q) consulta = consulta.or(`id_tx.ilike.%${q}%,remitente.ilike.%${q}%,codigo.ilike.%${q}%`);
    return consulta;
  };

  // Como la hoja de Paula: del primer registro al último, con el saldo bajando fila a fila. Sin "?pag=" se abre
  // la última página, donde están los más recientes.
  const { count } = sinError(await filtrar(supabase.from("comprobante_brasil").select("id", { count: "exact", head: true })));
  const total = count ?? 0;
  const ultimaPagina = Math.max(1, Math.ceil(total / POR_PAGINA));
  const pagina = typeof sp.pag === "string" ? Math.min(leerPagina(sp), ultimaPagina) : ultimaPagina;
  const [{ data, error }, { data: bancosData }, { data: dias }, { data: corrido }] = sinErrores(await Promise.all([
    filtrar(supabase.from("comprobante_brasil")
      .select("id, codigo, banco_id, fecha, id_tx, remitente, observacion, tipo, valor, estado, anulado_motivo, clase, tasa_binance, usdt, codigo_brs, contraparte_id, cliente:contraparte_id(nombre)"))
      .order("fecha").order("creado_en").order("id", { ascending: false }).range(...rango(pagina)),
    supabase.from("banco_brasil").select("id, nombre").eq("activo", true).order("orden"),
    // Saldo por banco y día (sin anulados): de aquí salen el saldo inicial del mes y los meses con datos
    traerTodo<Dia>((d, h) => {
      let c = supabase.from("resumen_brasil_dia").select("banco_id, fecha, entradas, salidas, saldo_cierre");
      if (banco) c = c.eq("banco_id", banco);
      return c.order("banco_id").order("fecha").range(d, h);
    }),
    // Saldo después de cada registro (solo con un banco elegido): todos los del periodo, sin anulados ni los demás filtros
    banco ? traerTodo<{ id: string; tipo: string; valor: number }>((d, h) => {
      let c = supabase.from("comprobante_brasil").select("id, tipo, valor").neq("estado", "ANULADO").eq("banco_id", banco);
      if (!todosLosMeses) c = c.gte("fecha", inicioMes).lte("fecha", finMes);
      return c.order("fecha").order("creado_en").order("id", { ascending: false }).range(d, h);
    }) : Promise.resolve({ data: [] as { id: string; tipo: string; valor: number }[] }),
  ]));
  // Libro del mes: saldo inicial = último cierre de cada banco antes del día 1; el cierre suma el mes
  const ultimoAntes = new Map<string, number>();
  for (const x of dias) if (x.fecha < inicioMes) ultimoAntes.set(x.banco_id, Number(x.saldo_cierre));
  const saldoInicialMes = [...ultimoAntes.values()].reduce((a, v) => a + v, 0);
  const delMes = dias.filter((x) => x.fecha >= inicioMes && x.fecha <= finMes);
  const entradasMes = delMes.reduce((a, x) => a + Number(x.entradas ?? 0), 0);
  const salidasMes = delMes.reduce((a, x) => a + Number(x.salidas ?? 0), 0);
  const saldoCierreMes = saldoInicialMes + entradasMes - salidasMes;
  const mesesConDatos = listaMeses(dias.map((x) => x.fecha), m);
  // Como la columna de saldo de la hoja de Paula: arranca en el saldo inicial del mes y suma o resta cada registro
  const saldoTras = new Map<string, number>();
  let acumulado = todosLosMeses ? 0 : saldoInicialMes;
  for (const r of corrido) {
    acumulado += r.tipo === "ENTRADA" ? Number(r.valor) : -Number(r.valor);
    saldoTras.set(r.id, Math.round(acumulado * 100) / 100);
  }
  const filas = (data ?? []) as Comprobante[];
  const bancos = (bancosData ?? []) as { id: string; nombre: string }[];
  const nombreBanco = Object.fromEntries(bancos.map((b) => [b.id, b.nombre]));
  const filtrosActivos = [desde, hasta, tipo, estado, q].filter(Boolean).length;
  const mesParam = parametroMes(m);
  const enlaceBanco = (id: string) => {
    const p = new URLSearchParams(Object.entries({ mes: mesParam, banco: id, desde, hasta, tipo, estado, q }).filter(([, v]) => v));
    return `/brasil${p.size ? "?" + p : ""}`;
  };
  // Cambiar de mes conserva el banco y quita los demás filtros (las fechas serían de otro mes)
  const enlaceMes = (m: string) => {
    const p = new URLSearchParams(Object.entries({ mes: m === hoy.slice(0, 7) ? "" : m, banco }).filter(([, v]) => v));
    return `/brasil${p.size ? "?" + p : ""}`;
  };

  return (
    <div className="space-y-6">
      <Encabezado
        titulo="Brasil · comprobantes"
        descripcion="Comprobantes recibidos en las cuentas de Brasil. El ID de transacción no se puede repetir en un mismo banco."
        acciones={puedeCargar && <FormularioComprobante bancos={bancos} bancoInicial={banco || undefined} hoy={hoy} />}
      />

      <section aria-label="Mes" className="space-y-3">
        <SelectorMes m={m} meses={mesesConDatos} enlace={enlaceMes} />
        {!todosLosMeses && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Cifra etiqueta="Saldo inicial del mes" valor={dinero(saldoInicialMes)} detalle="Cierre del mes anterior (se calcula solo)" />
            <Cifra etiqueta="Entradas del mes" valor={dinero(entradasMes)} tono="exito" />
            <Cifra etiqueta="Salidas del mes" valor={dinero(salidasMes)} tono="peligro" detalle="Incluye ventas a Binance" />
            <Cifra etiqueta={mes < hoy.slice(0, 7) ? "Saldo al cierre del mes" : "Saldo actual"} valor={dinero(saldoCierreMes)}
              tono={saldoCierreMes < 0 ? "peligro" : "primario"} detalle={banco ? nombreBanco[banco] ?? banco : "Todos los bancos"} />
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-borde bg-superficie p-4 shadow-sm">
        {/* Los filtros van ocultos; se abren con el botón. Si hay alguno aplicado, se ven abiertos. */}
        <input type="checkbox" id="ver-filtros" className="peer sr-only" defaultChecked={filtrosActivos > 0} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <nav className="flex flex-wrap gap-2 text-sm" aria-label="Bancos">
            {[{ id: "", nombre: "Todos" }, ...bancos].map((b) => (
              <Link key={b.id || "todos"} href={enlaceBanco(b.id)}
                className={chip(banco === b.id)}>
                {b.nombre}
              </Link>
            ))}
          </nav>
          <label htmlFor="ver-filtros" className={`${botonSuave} cursor-pointer select-none`} role="button" aria-controls="filtros-brasil">
            <span aria-hidden>⚲</span> Filtros{filtrosActivos > 0 && <span className="rounded-full bg-primario px-1.5 text-xs text-primario-texto">{filtrosActivos}</span>}
          </label>
        </div>

        <form id="filtros-brasil" className="hidden flex-wrap items-end gap-2 rounded-lg border border-borde bg-superficie-2/50 p-3 text-sm peer-checked:flex" role="search">
          {banco && <input type="hidden" name="banco" value={banco} />}
          {mesParam && <input type="hidden" name="mes" value={mesParam} />}
          <label className="flex flex-col">Desde<input type="date" name="desde" defaultValue={desde} className={campo}
            min={todosLosMeses ? undefined : inicioMes} max={todosLosMeses ? undefined : finMes} /></label>
          <label className="flex flex-col">Hasta<input type="date" name="hasta" defaultValue={hasta} className={campo}
            min={todosLosMeses ? undefined : inicioMes} max={todosLosMeses ? undefined : finMes} /></label>
          <label className="flex flex-col">Tipo
            <select name="tipo" defaultValue={tipo} className={campo}>
              <option value="">Todos</option><option value="ENTRADA">Entradas</option><option value="SALIDA">Salidas</option>
            </select>
          </label>
          <label className="flex flex-col">Estado
            <select name="estado" defaultValue={estado} className={campo}>
              <option value="">Todos</option>
              {Object.entries(ESTADOS).map(([k, e]) => <option key={k} value={k}>{e.etiqueta}</option>)}
            </select>
          </label>
          <label className="flex flex-col">Buscar<input name="q" defaultValue={q} placeholder="ID, remitente o código" className={`${campo} w-48`} /></label>
          <button className={botonSuave}>Filtrar</button>
          {(desde || hasta || tipo || estado || q) && <Link href={todosLosMeses ? `/brasil?mes=todos${banco ? `&banco=${banco}` : ""}` : enlaceMes(mes)} className="text-xs underline">Quitar filtros</Link>}
        </form>

        {error && <p role="alert" className="text-sm text-peligro">No se pudo cargar la lista: {error.message}</p>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-borde text-left">
                <th className="px-2 py-2">Código</th>{!banco && <th className="px-2 py-2">Banco</th>}
                <th className="px-2 py-2">Fecha</th><th className="px-2 py-2">ID transacción</th><th className="px-2 py-2">Remitente</th>
                <th className="px-2 py-2" title="Cliente que le asignó el operador al apropiarlo">Cliente</th>
                <th className="px-2 py-2 text-right">Entrada</th><th className="px-2 py-2 text-right">Salida</th>
                {banco && <th className="px-2 py-2 text-right" title="Saldo del banco después de cada registro">Saldo</th>}
                <th className="px-2 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className={`border-b border-borde/70 align-top ${f.estado === "ANULADO" ? "text-tenue line-through decoration-tenue/40" : ""}`}>
                  <td className="px-2 py-1 font-mono text-xs whitespace-nowrap">{f.codigo}</td>
                  {!banco && <td className="px-2 py-1 whitespace-nowrap">{nombreBanco[f.banco_id] ?? f.banco_id}</td>}
                  <td className="px-2 py-1 whitespace-nowrap">{f.fecha}</td>
                  <td className="px-2 py-1 font-mono text-xs">{f.id_tx}{f.codigo_brs && <span className="block text-exito">{f.codigo_brs}</span>}</td>
                  <td className="px-2 py-1">
                    {f.clase === "SALDO_INICIAL" && <span className="mr-1"><Insignia tono="info">saldo inicial</Insignia></span>}
                    {f.clase === "BINANCE" && <span className="mr-1"><Insignia tono="aviso">Binance · tasa {f.tasa_binance} · {Number(f.usdt).toLocaleString("es-CO", { maximumFractionDigits: 2 })} USDT</Insignia></span>}
                    {f.remitente}{f.observacion && <span className="block text-xs text-tenue">{f.observacion}</span>}
                  </td>
                  <td className="px-2 py-1">
                    {f.estado === "APLICADO" && f.contraparte_id
                      ? <>{f.cliente?.nombre ?? f.contraparte_id}<span className="block text-xs text-tenue">{f.contraparte_id}</span></>
                      : <span className="text-tenue">—</span>}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{f.tipo === "ENTRADA" ? dinero(f.valor) : ""}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{f.tipo === "SALIDA" ? dinero(f.valor) : ""}</td>
                  {banco && (
                    <td className={`px-2 py-1 text-right font-medium tabular-nums ${(saldoTras.get(f.id) ?? 0) < 0 ? "text-peligro" : ""}`}>
                      {saldoTras.has(f.id) ? dinero(saldoTras.get(f.id)!) : ""}
                    </td>
                  )}
                  <td className="px-2 py-1 whitespace-nowrap">
                    {f.estado === "APLICADO" ? <Insignia tono="exito">Apropiado</Insignia> : <Insignia tono="aviso">Pendiente</Insignia>}
                  </td>
                </tr>
              ))}
              {filas.length === 0 && <tr><td colSpan={10} className="px-2 py-4 text-tenue">Sin comprobantes con estos filtros.</td></tr>}
            </tbody>
          </table>
        </div>
        <Paginacion ruta="/brasil" sp={sp} total={total} pagina={pagina} explicita />
      </section>
    </div>
  );
}
