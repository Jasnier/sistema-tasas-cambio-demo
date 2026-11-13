import Link from "next/link";
import { boton, campo, etiqueta } from "@/components/estilos";
import { Aviso, Cifra, Encabezado, Tarjeta, Vacio, dinero } from "@/components/ui";
import { ahoraMs } from "@/lib/fechas";
import { avisoTope, traerTodo } from "@/lib/paginar";
import { exigirPermiso } from "@/lib/sesion";
import { sinErrores } from "@/lib/supabase/datos";
import { crearClienteServidor } from "@/lib/supabase/server";
import { partesBogota } from "../../movimientos/datos";

/**
 * STW-58: estado de resultados por período año-mes (P-27) o por año: utilidad bruta (movimientos aprobados del período)
 * − gastos agrupados por tipo = utilidad neta y margen. Sin depender de otro reporte ni del nombre del mes (doc 08).
 */
export default async function PaginaEstadoResultados({ searchParams }: PageProps<"/finanzas/estado-resultados">) {
  await exigirPermiso("FINANZAS");
  const sp = await searchParams;
  const hoy = partesBogota(new Date((await ahoraMs())).toISOString()).fecha;
  const p = typeof sp.periodo === "string" && /^\d{4}(-\d{2})?$/.test(sp.periodo) ? sp.periodo : hoy.slice(0, 7);
  const esAnio = p.length === 4;
  const supabase = await crearClienteServidor();

  // Por páginas: Supabase corta en max_rows (1000) y las sumas del año saldrían incompletas. Orden por la clave única.
  type FilaUt = { periodo_id: string; utilidad: number; operaciones: number };
  type FilaGa = { periodo: string; tipo: string; valor: number };
  const [{ data: ut, truncado: tu }, { data: ga, truncado: tg }, perR] = sinErrores(await Promise.all([
    traerTodo<FilaUt>((d, h) => {
      let q = supabase.from("resumen_operativo").select("periodo_id, utilidad, operaciones");
      q = esAnio ? q.like("periodo_id", `${p}-%`) : q.eq("periodo_id", p);
      return q.order("periodo_id").order("contraparte_id").order("moneda_origen").range(d, h);
    }),
    traerTodo<FilaGa>((d, h) => {
      let q = supabase.from("gasto").select("periodo, tipo, valor").eq("estado", "ACTIVO");
      q = esAnio ? q.like("periodo", `${p}-%`) : q.eq("periodo", p);
      return q.order("id").range(d, h);
    }),
    supabase.from("periodo").select("id").order("id", { ascending: false }),
  ]));
  const truncado = tu || tg;

  const bruta = (ut ?? []).reduce((a, r) => a + Number(r.utilidad), 0);
  const operaciones = (ut ?? []).reduce((a, r) => a + Number(r.operaciones), 0);
  const porTipo = new Map<string, number>();
  for (const g of ga ?? []) porTipo.set(g.tipo as string, (porTipo.get(g.tipo as string) ?? 0) + Number(g.valor));
  const gastos = [...porTipo.values()].reduce((a, v) => a + v, 0);
  const neta = bruta - gastos;
  const margen = bruta ? neta / bruta : null;
  const periodos = [...new Set([hoy.slice(0, 7), ...(perR.data ?? []).map((x) => x.id as string)])].sort().reverse();
  const anios = [...new Set(periodos.map((x) => x.slice(0, 4)))];

  return (
    <div className="space-y-5">
      <Encabezado titulo="Estado de resultados" descripcion="Utilidad de los movimientos aprobados del mes (o del año), menos los gastos del mismo período agrupados por tipo." />
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className={etiqueta}>Período
          <select name="periodo" defaultValue={p} className={campo}>
            <optgroup label="Mes">{periodos.map((x) => <option key={x} value={x}>{x}</option>)}</optgroup>
            <optgroup label="Año completo">{anios.map((x) => <option key={x} value={x}>{x}</option>)}</optgroup>
          </select>
        </label>
        <button className={boton}>Ver</button>
      </form>

      {truncado && <Aviso tono="peligro">{avisoTope()} Las cifras no están completas.</Aviso>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Cifra etiqueta="Utilidad bruta" valor={dinero(bruta)} tono="exito" detalle={`${operaciones} operación(es)`} />
        <Cifra etiqueta="Gastos" valor={dinero(gastos)} tono="peligro" detalle={`${porTipo.size} tipo(s)`} />
        <Cifra etiqueta="Utilidad neta" valor={dinero(neta)} tono={neta < 0 ? "peligro" : "primario"} />
        <Cifra etiqueta="Margen" valor={margen == null ? "—" : `${(margen * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} %`} />
      </div>

      <Tarjeta titulo={`Estado de resultados ${p}`}>
        {bruta === 0 && gastos === 0 ? <Vacio>No hay utilidad ni gastos en {p}.</Vacio> : (
          <div className="overflow-x-auto"><table className="w-full max-w-xl text-sm">
            <tbody>
              <tr className="border-b border-borde font-semibold"><td className="py-2">Utilidad bruta</td><td className="py-2 text-right tabular-nums">{dinero(bruta)}</td></tr>
              {[...porTipo].sort((a, b) => b[1] - a[1]).map(([t, v]) => (
                <tr key={t} className="border-b border-borde/60 text-tenue"><td className="py-1.5 pl-4">− {t}</td><td className="py-1.5 text-right tabular-nums">{dinero(v)}</td></tr>
              ))}
              <tr className="border-b border-borde"><td className="py-2">Total gastos</td><td className="py-2 text-right tabular-nums text-peligro">−{dinero(gastos)}</td></tr>
              <tr className="text-base font-semibold"><td className="py-2">Utilidad neta</td><td className={`py-2 text-right tabular-nums ${neta < 0 ? "text-peligro" : ""}`}>{dinero(neta)}</td></tr>
              <tr className="text-tenue"><td className="py-1">Margen</td><td className="py-1 text-right tabular-nums">{margen == null ? "—" : `${(margen * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })} %`}</td></tr>
            </tbody>
          </table></div>
        )}
        <p className="mt-4 text-xs text-tenue">Detalle en <Link href={`/finanzas/resumen-operativo${esAnio ? "" : `?periodo=${p}`}`} className="text-primario hover:underline">Resumen operativo</Link> y <Link href={`/finanzas/gastos${esAnio ? "" : `?periodo=${p}`}`} className="text-primario hover:underline">Gastos</Link>.</p>
      </Tarjeta>
    </div>
  );
}
