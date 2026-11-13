import Link from "next/link";
import { Formulario } from "@/components/Formulario";
import { boton, botonPeligro, campo, etiqueta, chip } from "@/components/estilos";
import { Cifra, Encabezado, Insignia, Tarjeta, Vacio, dinero } from "@/components/ui";
import { ahoraMs } from "@/lib/fechas";
import { traerTodo } from "@/lib/paginar";
import { exigirPermiso } from "@/lib/sesion";
import { sinErrores } from "@/lib/supabase/datos";
import { crearClienteServidor } from "@/lib/supabase/server";
import { partesBogota } from "../../movimientos/datos";
import { anularGasto, crearGasto } from "./actions";
import { Paginacion } from "@/components/Paginacion";
import { cortar, leerPagina } from "@/lib/paginacion";

type Gasto = {
  id: string; fecha: string; periodo: string; tipo: string; proveedor: string | null; descripcion: string | null; valor: number;
  empresa_id: string | null; tipo_abono: string | null; oficina: string | null; estado: string; anulado_motivo: string | null;
};

/** STW-55: gastos (reemplaza la hoja GASTOS del libro OTROS). Se consultan por período año-mes (P-27). */
export default async function PaginaGastos({ searchParams }: PageProps<"/finanzas/gastos">) {
  await exigirPermiso("FINANZAS");
  const sp = await searchParams;
  const pagina = leerPagina(sp);   // la tabla se pinta por páginas; los totales suman todo
  const hoy = partesBogota(new Date((await ahoraMs())).toISOString()).fecha;
  const periodo = typeof sp.periodo === "string" && /^\d{4}-\d{2}$/.test(sp.periodo) ? sp.periodo : hoy.slice(0, 7);
  const verAnulados = sp.anulados === "1";
  const supabase = await crearClienteServidor();

  // Por páginas (Supabase corta en max_rows = 1000): el total del mes, las sugerencias y la lista de períodos.
  type Previo = { tipo: string; tipo_abono: string | null; oficina: string | null };
  const [{ data: gastos }, { data: previos }, empresasR, { data: conPeriodo }] = sinErrores(await Promise.all([
    traerTodo<Gasto>((d, h) => {
      let q = supabase.from("gasto").select("*").eq("periodo", periodo);
      if (!verAnulados) q = q.eq("estado", "ACTIVO");
      return q.order("fecha", { ascending: false }).order("id", { ascending: false }).range(d, h);
    }),
    traerTodo<Previo>((d, h) => supabase.from("gasto").select("tipo, tipo_abono, oficina").order("id").range(d, h)),
    supabase.from("empresa").select("id, nombre").eq("activo", true).order("orden"),
    traerTodo<{ periodo: string }>((d, h) => supabase.from("gasto").select("periodo").order("id").range(d, h)),
  ]));
  const unicos = (k: "tipo" | "tipo_abono" | "oficina") => [...new Set(previos.map((p) => p[k]).filter(Boolean) as string[])].sort();
  const periodos = [...new Set([periodo, hoy.slice(0, 7), ...conPeriodo.map((p) => p.periodo)])].sort().reverse();
  const empresas = (empresasR.data ?? []) as { id: string; nombre: string }[];

  const activos = gastos.filter((g) => g.estado === "ACTIVO");
  const total = activos.reduce((a, g) => a + Number(g.valor), 0);
  const porTipo = new Map<string, number>();
  for (const g of activos) porTipo.set(g.tipo, (porTipo.get(g.tipo) ?? 0) + Number(g.valor));

  return (
    <div className="space-y-5">
      <Encabezado titulo="Gastos" descripcion="Registro de gastos. Cada gasto queda en el mes de su fecha; no se edita ni se borra: si hay un error, se anula con motivo." />

      <Tarjeta titulo="Registrar gasto">
        <Formulario accion={crearGasto} limpiar className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className={etiqueta}>Fecha<input type="date" name="fecha" required defaultValue={hoy} max={hoy} className={campo} /></label>
          <label className={etiqueta}>Tipo
            <input name="tipo" required list="tipos-gasto" placeholder="ARRIENDO, NÓMINA…" className={campo} />
          </label>
          <label className={etiqueta}>Valor
            <input name="valor" required inputMode="decimal" placeholder="1500000" className={`${campo} text-right tabular-nums`} />
          </label>
          <label className={etiqueta}>Proveedor<input name="proveedor" className={campo} /></label>
          <label className={`${etiqueta} sm:col-span-2`}>Descripción<input name="descripcion" className={campo} /></label>
          <label className={etiqueta}>Empresa
            <select name="empresa_id" defaultValue="" className={campo}><option value="">—</option>{empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select>
          </label>
          <label className={etiqueta}>Tipo de abono<input name="tipo_abono" list="abonos-gasto" placeholder="EFECTIVO, TRANSFERENCIA…" className={campo} /></label>
          <label className={etiqueta}>Oficina<input name="oficina" list="oficinas-gasto" className={campo} /></label>
          <div className="flex items-end sm:col-span-2 lg:col-span-3"><button className={boton}>Registrar gasto</button></div>
          <datalist id="tipos-gasto">{unicos("tipo").map((t) => <option key={t} value={t} />)}</datalist>
          <datalist id="abonos-gasto">{unicos("tipo_abono").map((t) => <option key={t} value={t} />)}</datalist>
          <datalist id="oficinas-gasto">{unicos("oficina").map((t) => <option key={t} value={t} />)}</datalist>
        </Formulario>
      </Tarjeta>

      <nav aria-label="Períodos" className="flex flex-wrap items-center gap-1.5">
        {periodos.slice(0, 12).map((p) => (
          <Link key={p} href={`/finanzas/gastos?periodo=${p}${verAnulados ? "&anulados=1" : ""}`}
            className={chip(p === periodo)}>{p}</Link>
        ))}
        <Link href={`/finanzas/gastos?periodo=${periodo}${verAnulados ? "" : "&anulados=1"}`} className="ml-2 text-xs text-primario hover:underline">
          {verAnulados ? "Ocultar anulados" : "Ver anulados"}
        </Link>
      </nav>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Cifra etiqueta={`Total ${periodo}`} valor={dinero(total)} tono="peligro" detalle={`${activos.length} gasto(s)`} />
        {[...porTipo].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, v]) => (
          <Cifra key={t} etiqueta={t} valor={dinero(v)} detalle={total ? `${Math.round((v / total) * 100)} % del total` : undefined} />
        ))}
      </div>

      <Tarjeta titulo={`Gastos de ${periodo}`}>
        {gastos.length === 0 ? <Vacio>No hay gastos registrados en {periodo}.</Vacio> : (<>
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-borde text-left">
                <th className="px-4 py-2">Código</th><th className="px-2 py-2">Fecha</th><th className="px-2 py-2">Tipo</th><th className="px-2 py-2">Proveedor / descripción</th>
                <th className="px-2 py-2 text-right">Valor</th><th className="px-2 py-2">Abono · oficina</th><th className="px-2 py-2"></th>
              </tr></thead>
              <tbody>
                {cortar(gastos, pagina).map((g) => (
                  <tr key={g.id} className={`border-b border-borde/70 align-top ${g.estado === "ANULADO" ? "text-tenue line-through decoration-tenue/40" : ""}`}>
                    <td className="px-4 py-2 font-mono text-xs font-semibold">{g.id}</td>
                    <td className="px-2 py-2 whitespace-nowrap tabular-nums">{g.fecha}</td>
                    <td className="px-2 py-2"><Insignia>{g.tipo}</Insignia></td>
                    <td className="px-2 py-2">{g.proveedor}{g.descripcion && <span className="block text-xs text-tenue">{g.descripcion}</span>}</td>
                    <td className="px-2 py-2 text-right font-medium tabular-nums">{dinero(g.valor)}</td>
                    <td className="px-2 py-2 text-xs">{[g.tipo_abono, g.oficina].filter(Boolean).join(" · ")}</td>
                    <td className="px-2 py-2 no-underline">
                      {g.estado === "ACTIVO" ? (
                        <details>
                          <summary className="cursor-pointer text-xs text-peligro">Anular</summary>
                          <Formulario accion={anularGasto} className="mt-2 flex items-end gap-2" confirmar={`¿Anular ${g.id}?`}>
                            <input type="hidden" name="id" value={g.id} />
                            <input name="motivo" required minLength={3} placeholder="Motivo" aria-label={`Motivo para anular ${g.id}`} className={`${campo} w-40`} />
                            <button className={botonPeligro}>Anular</button>
                          </Formulario>
                        </details>
                      ) : <span className="text-xs" title={g.anulado_motivo ?? ""}>anulado: {g.anulado_motivo}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginacion ruta="/finanzas/gastos" sp={sp} total={gastos.length} pagina={pagina} className="mt-3" />
        </>)}
      </Tarjeta>

      {porTipo.size > 0 && (
        <Tarjeta titulo={`Por tipo (${periodo})`}>
          <ul className="space-y-2 text-sm">
            {[...porTipo].sort((a, b) => b[1] - a[1]).map(([t, v]) => (
              <li key={t}>
                <div className="flex justify-between"><span>{t}</span><span className="tabular-nums">{dinero(v)}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-superficie-2"><div className="h-1.5 rounded-full bg-primario" style={{ width: `${(v / total) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}
    </div>
  );
}
