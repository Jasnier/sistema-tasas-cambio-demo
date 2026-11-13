import Link from "next/link";
import { boton, botonSuave, campo, etiqueta } from "@/components/estilos";
import { Aviso, Cifra, Encabezado, Tarjeta, Vacio, dinero } from "@/components/ui";
import { avisoTope, traerTodo } from "@/lib/paginar";
import { exigirPermiso } from "@/lib/sesion";
import { sinErrores } from "@/lib/supabase/datos";
import { crearClienteServidor } from "@/lib/supabase/server";
import { Paginacion } from "@/components/Paginacion";
import { cortar, leerPagina } from "@/lib/paginacion";

type Fila = { periodo_id: string; contraparte_id: string; nombre: string; moneda_origen: string; operaciones: number; volumen: number;
  puntos_promedio: number; utilidad: number;
  // Lo mismo, solo con las operaciones de utilidad positiva (migración 2700)
  operaciones_pos: number; volumen_pos: number | null; puntos_promedio_pos: number | null; utilidad_pos: number | null };

const lista = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);

/**
 * STW-57: resumen operativo (dashboard.js del libro OTROS) sobre los movimientos aprobados, por período
 * (P-29) × cliente × moneda: volumen, puntos promedio, utilidad y operaciones. Mismos filtros que hoy.
 */
export default async function PaginaResumenOperativo({ searchParams }: PageProps<"/finanzas/resumen-operativo">) {
  await exigirPermiso("FINANZAS");
  const sp = await searchParams;
  const pagina = leerPagina(sp);   // la tabla se pinta por páginas; los totales suman todo
  const periodo = typeof sp.periodo === "string" ? sp.periodo : "";
  const excluirClientes = lista(sp.excluir_ct);
  const excluirMonedas = lista(sp.excluir_moneda);
  const ocultarCero = sp.ocultar_cero === "1";
  const supabase = await crearClienteServidor();

  // El período se filtra en la base y se pide por páginas (Supabase corta en max_rows = 1000 y la suma saldría mal).
  // El orden termina en (período, cliente, moneda), la clave de la vista, para que las páginas no se crucen.
  const [{ data, truncado }, perR] = sinErrores(await Promise.all([
    traerTodo<Fila>((desde, hasta) => {
      let q = supabase.from("resumen_operativo").select("*");
      if (periodo) q = q.eq("periodo_id", periodo);
      return q.order("periodo_id", { ascending: false }).order("utilidad", { ascending: false })
        .order("contraparte_id").order("moneda_origen").range(desde, hasta);
    }),
    supabase.from("periodo").select("id, estado").order("id", { ascending: false }),
  ]));
  const todas = data;
  const clientes = [...new Map(todas.map((f) => [f.contraparte_id, f.nombre])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const monedas = [...new Set(todas.map((f) => f.moneda_origen))].sort();
  // Como dashboard.js: "ocultar utilidad 0 o negativa" descarta cada OPERACIÓN antes de agrupar (no el grupo sumado)
  const filas = todas
    .map((f) => (ocultarCero
      ? { ...f, operaciones: f.operaciones_pos, volumen: Number(f.volumen_pos ?? 0), puntos_promedio: Number(f.puntos_promedio_pos ?? 0), utilidad: Number(f.utilidad_pos ?? 0) }
      : f))
    .filter((f) => !excluirClientes.includes(f.contraparte_id) && !excluirMonedas.includes(f.moneda_origen) && (!ocultarCero || f.operaciones > 0));

  const utilidad = filas.reduce((a, f) => a + Number(f.utilidad), 0);
  const operaciones = filas.reduce((a, f) => a + f.operaciones, 0);
  // Como dashboard.js: el promedio de puntos del encabezado es el promedio simple de las filas de la tabla
  const puntos = filas.length ? filas.reduce((a, f) => a + Number(f.puntos_promedio), 0) / filas.length : 0;
  const porMoneda = new Map<string, number>();
  for (const f of filas) porMoneda.set(f.moneda_origen, (porMoneda.get(f.moneda_origen) ?? 0) + Number(f.volumen));

  return (
    <div className="space-y-5">
      <Encabezado titulo="Resumen operativo"
        descripcion="Utilidad por mes, cliente y moneda, solo de movimientos aprobados. Los puntos son, en promedio, la diferencia entre la tasa a la que compra la casa y la tasa del cliente." />
      <form method="get" className="grid gap-3 rounded-xl border border-borde bg-superficie p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <label className={etiqueta}>Período
          <select name="periodo" defaultValue={periodo} className={campo}>
            <option value="">Todos</option>{(perR.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.id}{p.estado === "CERRADO" ? " (cerrado)" : ""}</option>)}
          </select>
        </label>
        <label className={etiqueta}>Excluir clientes
          <select name="excluir_ct" multiple defaultValue={excluirClientes} className={`${campo} h-24`}>
            {clientes.map(([id, n]) => <option key={id} value={id}>{n} · {id}</option>)}
          </select>
        </label>
        <label className={etiqueta}>Excluir monedas
          <select name="excluir_moneda" multiple defaultValue={excluirMonedas} className={`${campo} h-24`}>
            {monedas.map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <div className="flex flex-col justify-between gap-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="ocultar_cero" value="1" defaultChecked={ocultarCero} className="size-4" /> Ocultar utilidad 0 o negativa</label>
          <div className="flex gap-2"><button className={boton}>Aplicar</button><Link href="/finanzas/resumen-operativo" className={botonSuave}>Limpiar</Link></div>
        </div>
      </form>

      {truncado && <Aviso tono="peligro">{avisoTope()} Los totales no están completos.</Aviso>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Cifra etiqueta="Utilidad" valor={dinero(utilidad)} tono={utilidad < 0 ? "peligro" : "exito"} detalle={periodo || "todos los períodos"} />
        <Cifra etiqueta="Operaciones" valor={operaciones.toLocaleString("es-CO")} />
        <Cifra etiqueta="Puntos promedio" valor={puntos.toLocaleString("es-CO", { maximumFractionDigits: 4 })} tono="primario" />
        <Cifra etiqueta="Volumen" valor={[...porMoneda].map(([m, v]) => `${dinero(v)} ${m}`).slice(0, 2).join(" · ") || "—"} detalle={porMoneda.size > 2 ? `y ${porMoneda.size - 2} moneda(s) más` : undefined} />
      </div>

      <Tarjeta>
        {filas.length === 0 ? <Vacio>No hay movimientos aprobados con esos filtros.</Vacio> : (<>
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-borde text-left">
                <th className="px-4 py-2">Período</th><th className="px-2 py-2">Cliente</th><th className="px-2 py-2">Moneda</th>
                <th className="px-2 py-2 text-right">Volumen</th><th className="px-2 py-2 text-right">Puntos prom.</th>
                <th className="px-2 py-2 text-right">Utilidad</th><th className="px-2 py-2 text-right">Operaciones</th>
              </tr></thead>
              <tbody>
                {cortar(filas, pagina).map((f) => (
                  <tr key={`${f.periodo_id}|${f.contraparte_id}|${f.moneda_origen}`} className="border-b border-borde/70">
                    <td className="px-4 py-2 tabular-nums">{f.periodo_id ?? "—"}</td>
                    <td className="px-2 py-2">{f.nombre}<span className="block text-xs text-tenue">{f.contraparte_id}</span></td>
                    <td className="px-2 py-2">{f.moneda_origen}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{dinero(f.volumen)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{Number(f.puntos_promedio).toLocaleString("es-CO", { maximumFractionDigits: 4 })}</td>
                    <td className={`px-2 py-2 text-right font-medium tabular-nums ${Number(f.utilidad) < 0 ? "text-peligro" : ""}`}>{dinero(f.utilidad)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{f.operaciones}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="px-4 py-2" colSpan={5}>Total</td>
                  <td className="px-2 py-2 text-right tabular-nums">{dinero(utilidad)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{operaciones}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <Paginacion ruta="/finanzas/resumen-operativo" sp={sp} total={filas.length} pagina={pagina} className="mt-3" />
        </>)}
      </Tarjeta>
    </div>
  );
}
