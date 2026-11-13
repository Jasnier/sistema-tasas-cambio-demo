import Link from "next/link";
import { Formulario } from "@/components/Formulario";
import { boton, botonPeligro, campo, etiqueta, chip } from "@/components/estilos";
import { Cifra, Encabezado, Tarjeta, Vacio, dinero } from "@/components/ui";
import { ahoraMs } from "@/lib/fechas";
import { traerTodo } from "@/lib/paginar";
import { exigirPermiso } from "@/lib/sesion";
import { sinErrores } from "@/lib/supabase/datos";
import { crearClienteServidor } from "@/lib/supabase/server";
import { partesBogota } from "../../movimientos/datos";
import { anularNegociacion, crearNegociacion } from "./actions";
import { Paginacion } from "@/components/Paginacion";
import { cortar, leerPagina } from "@/lib/paginacion";

type Neg = { id: string; fecha: string; periodo: string; cliente: string; contraparte_id: string | null; moneda: string; valor: number;
  peso: number | null; utilidad: number | null; responsable: string | null; observacion: string | null; estado: string; anulado_motivo: string | null };

/** STW-56: negociaciones (hoja NEGOCIACIONES del libro OTROS). Formulario simple, sin migración (P-28). */
export default async function PaginaNegociaciones({ searchParams }: PageProps<"/finanzas/negociaciones">) {
  await exigirPermiso("FINANZAS");
  const sp = await searchParams;
  const pagina = leerPagina(sp);   // la tabla se pinta por páginas; los totales suman todo
  const hoy = partesBogota(new Date((await ahoraMs())).toISOString()).fecha;
  const periodo = typeof sp.periodo === "string" && /^\d{4}-\d{2}$/.test(sp.periodo) ? sp.periodo : hoy.slice(0, 7);
  const supabase = await crearClienteServidor();
  // Por páginas (Supabase corta en max_rows = 1000): la utilidad del mes y la lista de períodos.
  const [{ data: negs }, monR, ctR, { data: conPeriodo }] = sinErrores(await Promise.all([
    traerTodo<Neg>((d, h) => supabase.from("negociacion").select("*").eq("periodo", periodo)
      .order("fecha", { ascending: false }).order("id", { ascending: false }).range(d, h)),
    supabase.from("moneda").select("nombre").eq("activo", true).order("orden"),
    supabase.from("contraparte").select("id, nombre").eq("activo", true).order("nombre"),
    traerTodo<{ periodo: string }>((d, h) => supabase.from("negociacion").select("periodo").order("id").range(d, h)),
  ]));
  const activas = negs.filter((n) => n.estado === "ACTIVO");
  const periodos = [...new Set([periodo, hoy.slice(0, 7), ...conPeriodo.map((p) => p.periodo)])].sort().reverse();
  const utilidad = activas.reduce((a, n) => a + Number(n.utilidad ?? 0), 0);

  return (
    <div className="space-y-5">
      <Encabezado titulo="Negociaciones" descripcion="Negociaciones especiales con clientes, que maneja la administración. Cada una queda en el mes de su fecha." />
      <Tarjeta titulo="Registrar negociación">
        <Formulario accion={crearNegociacion} limpiar className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className={etiqueta}>Fecha<input type="date" name="fecha" required defaultValue={hoy} max={hoy} className={campo} /></label>
          <label className={etiqueta}>Cliente<input name="cliente" required list="clientes-neg" className={campo} /></label>
          <label className={etiqueta}>Código CT (opcional)
            <select name="contraparte_id" defaultValue="" className={campo}><option value="">—</option>{(ctR.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.id} · {c.nombre}</option>)}</select>
          </label>
          <label className={etiqueta}>Moneda
            <select name="moneda" required defaultValue={(monR.data ?? []).some((m) => m.nombre === "USD") ? "USD" : undefined} className={campo}>
              {(monR.data ?? []).map((m) => <option key={m.nombre}>{m.nombre}</option>)}
            </select>
          </label>
          <label className={etiqueta}>Valor<input name="valor" required inputMode="decimal" className={`${campo} text-right`} /></label>
          <label className={etiqueta}>Peso / tasa<input name="peso" inputMode="decimal" className={`${campo} text-right`} /></label>
          <label className={etiqueta}>Utilidad<input name="utilidad" inputMode="decimal" className={`${campo} text-right`} /></label>
          <label className={etiqueta}>Responsable<input name="responsable" className={campo} /></label>
          <label className={`${etiqueta} sm:col-span-2 lg:col-span-3`}>Observación<input name="observacion" className={campo} /></label>
          <div className="flex items-end"><button className={boton}>Registrar</button></div>
          <datalist id="clientes-neg">{(ctR.data ?? []).map((c) => <option key={c.id} value={c.nombre} />)}</datalist>
        </Formulario>
      </Tarjeta>
      <nav aria-label="Períodos" className="flex flex-wrap gap-1.5">
        {periodos.slice(0, 12).map((p) => (
          <Link key={p} href={`/finanzas/negociaciones?periodo=${p}`}
            className={chip(p === periodo)}>{p}</Link>
        ))}
      </nav>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Cifra etiqueta={`Negociaciones ${periodo}`} valor={activas.length} />
        <Cifra etiqueta="Utilidad registrada" valor={dinero(utilidad)} tono="exito" />
      </div>
      <Tarjeta>
        {negs.length === 0 ? <Vacio>No hay negociaciones en {periodo}.</Vacio> : (<>
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-borde text-left">
                <th className="px-4 py-2">Código</th><th className="px-2 py-2">Fecha</th><th className="px-2 py-2">Cliente</th><th className="px-2 py-2 text-right">Valor</th>
                <th className="px-2 py-2 text-right">Peso</th><th className="px-2 py-2 text-right">Utilidad</th><th className="px-2 py-2">Responsable</th><th className="px-2 py-2"></th>
              </tr></thead>
              <tbody>
                {cortar(negs, pagina).map((n) => (
                  <tr key={n.id} className={`border-b border-borde/70 align-top ${n.estado === "ANULADO" ? "text-tenue line-through" : ""}`}>
                    <td className="px-4 py-2 font-mono text-xs font-semibold">{n.id}</td>
                    <td className="px-2 py-2 tabular-nums">{n.fecha}</td>
                    <td className="px-2 py-2">{n.cliente}{n.contraparte_id && <span className="block text-xs text-tenue">{n.contraparte_id}</span>}{n.observacion && <span className="block text-xs text-tenue">{n.observacion}</span>}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{dinero(n.valor)} <span className="text-xs text-tenue">{n.moneda}</span></td>
                    <td className="px-2 py-2 text-right tabular-nums">{n.peso == null ? "" : Number(n.peso).toLocaleString("es-CO", { maximumFractionDigits: 6 })}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{n.utilidad == null ? "" : dinero(n.utilidad)}</td>
                    <td className="px-2 py-2 text-xs">{n.responsable}</td>
                    <td className="px-2 py-2 no-underline">
                      {n.estado === "ACTIVO" ? (
                        <details><summary className="cursor-pointer text-xs text-peligro">Anular</summary>
                          <Formulario accion={anularNegociacion} className="mt-2 flex items-end gap-2" confirmar={`¿Anular ${n.id}?`}>
                            <input type="hidden" name="id" value={n.id} />
                            <input name="motivo" required minLength={3} placeholder="Motivo" aria-label={`Motivo para anular ${n.id}`} className={`${campo} w-40`} />
                            <button className={botonPeligro}>Anular</button>
                          </Formulario>
                        </details>
                      ) : <span className="text-xs">anulada: {n.anulado_motivo}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginacion ruta="/finanzas/negociaciones" sp={sp} total={negs.length} pagina={pagina} className="mt-3" />
        </>)}
      </Tarjeta>
    </div>
  );
}
