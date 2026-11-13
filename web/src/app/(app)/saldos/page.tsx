import Link from "next/link";
import { Formulario } from "@/components/Formulario";
import { boton, botonSuave, campo, etiqueta } from "@/components/estilos";
import { Aviso, Encabezado, Insignia, Tarjeta, Vacio, dinero } from "@/components/ui";
import { avisoTope, traerTodo } from "@/lib/paginar";
import { Paginacion } from "@/components/Paginacion";
import { cortar, leerPagina } from "@/lib/paginacion";
import { exigirPermiso } from "@/lib/sesion";
import { sinError, sinErrores } from "@/lib/supabase/datos";
import { crearClienteServidor } from "@/lib/supabase/server";
import { fechaHora } from "../movimientos/datos";
import { recalcular } from "./actions";

type Saldo = { contraparte_id: string; nombre: string; tipo: string; moneda: string; modalidad: string; saldo: number; ultima_secuencia: number; actualizado_en: string };
type Comparacion = { contraparte_id: string; nombre: string; moneda: string; modalidad: string; saldo_bucket: number; suma_movimientos: number;
  movimientos: number; ultimo_saldo: number | null; diferencia: number; descuadrado: boolean };

const VISTAS = [
  { v: "resumen", etiqueta: "Resumen por cliente" },
  { v: "detalle", etiqueta: "Detalle" },
  { v: "comparacion", etiqueta: "Comparación", permiso: "APROBAR_MOVIMIENTO" },
  { v: "sheets", etiqueta: "Conciliación con Sheets", permiso: "APROBAR_MOVIMIENTO" },
];
const mod = (m: string) => (m === "TRANSFERENCIA" ? "Transf." : "Efectivo");

/**
 * STW-30 / 38 / 40 / 33: saldos. Resumen = RESUMEN2 del Motor (cliente × moneda × modalidad, por código CT);
 * Detalle = cada saldo; Comparación = saldo guardado vs suma de movimientos (comparacionSaldos.js).
 */
export default async function PaginaSaldos({ searchParams }: PageProps<"/saldos">) {
  const sesion = await exigirPermiso("VER_REPORTES");
  const sp = await searchParams;
  // Los totales suman todo; en pantalla se pinta una página de la tabla
  const pagina = leerPagina(sp);
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const moneda = typeof sp.moneda === "string" ? sp.moneda : "";
  const visibles = VISTAS.filter((x) => !x.permiso || sesion.permisos.has(x.permiso));
  const vista = visibles.find((x) => x.v === sp.v)?.v ?? "resumen";
  const puedeRecalcular = sesion.permisos.has("RECALCULAR_BUCKET");
  const supabase = await crearClienteServidor();
  const texto = q.toUpperCase();
  const pasa = (s: { nombre: string; contraparte_id: string; moneda: string }) =>
    (!texto || s.nombre.includes(texto) || s.contraparte_id.includes(texto)) && (!moneda || s.moneda === moneda);

  // STW-50: corridas de conciliación contra Sheets (scripts/conciliar-saldos.mjs)
  // Supabase corta cada consulta en max_rows (1000): las listas que se suman o se comparan se piden por páginas,
  // con el orden terminado en la clave del bucket (contraparte, moneda, modalidad).
  type Dif = { corrida_id: number; contraparte_id: string; moneda: string; modalidad: string; saldo_sheets: number | null;
    saldo_web: number | null; diferencia: number };
  const corridasR = vista === "sheets"
    ? sinError(await supabase.from("conciliacion_corrida").select("*").order("id", { ascending: false }).limit(20)) : { data: [] };
  const corridas = (corridasR.data ?? []) as { id: number; creada_en: string; fuente: string; corte_sheets: string | null; buckets: number; con_diferencia: number }[];
  const ultima = corridas[0];
  const difs = ultima
    ? sinError(await traerTodo<Dif>((d, h) => supabase.from("conciliacion_saldo").select("*").eq("corrida_id", ultima.id)
        .order("contraparte_id").order("moneda").order("modalidad").range(d, h))).data
        .filter((d) => Math.abs(Number(d.diferencia)) > 0.005)
    : [];
  const [{ data, truncado }, monedasR] = sinErrores(await Promise.all([
    vista === "comparacion"
      ? traerTodo<Comparacion>((d, h) => supabase.from("comparacion_saldos").select("*").order("descuadrado", { ascending: false })
          .order("nombre").order("contraparte_id").order("moneda").order("modalidad").range(d, h))
      : traerTodo<Saldo>((d, h) => supabase.from("saldo_cliente").select("*")
          .order("nombre").order("contraparte_id").order("moneda").order("modalidad").range(d, h)),
    supabase.from("moneda").select("nombre").eq("activo", true).order("orden"),
  ]));
  const qs = (v: string) => `/saldos?${new URLSearchParams({ v, ...(q && { q }), ...(moneda && { moneda }) })}`;

  // Resumen: una fila por cliente, una columna por moneda · modalidad
  const saldos = vista !== "comparacion" ? (data as Saldo[]).filter(pasa) : [];
  const columnas = [...new Set(saldos.map((s) => `${s.moneda}|${s.modalidad}`))].sort();
  const porCliente = new Map<string, { nombre: string; tipo: string; v: Map<string, number> }>();
  for (const s of saldos) {
    const c = porCliente.get(s.contraparte_id) ?? { nombre: s.nombre, tipo: s.tipo, v: new Map() };
    c.v.set(`${s.moneda}|${s.modalidad}`, Number(s.saldo));
    porCliente.set(s.contraparte_id, c);
  }
  const totalCol = (k: string) => saldos.filter((s) => `${s.moneda}|${s.modalidad}` === k).reduce((a, s) => a + Number(s.saldo), 0);
  const comp = vista === "comparacion" ? (data as Comparacion[]).filter(pasa) : [];
  const descuadrados = comp.filter((c) => c.descuadrado).length;

  const botonRecalcular = (ct: string, m: string, md: string) => puedeRecalcular && (
    <Formulario accion={recalcular} confirmar={`¿Recalcular el saldo de ${ct} · ${m} · ${md}? Se rehace en orden de aprobación.`}>
      <input type="hidden" name="ct" value={ct} /><input type="hidden" name="moneda" value={m} /><input type="hidden" name="modalidad" value={md} />
      <button className={botonSuave}>Recalcular</button>
    </Formulario>
  );

  return (
    <div className="space-y-5">
      <Encabezado
        titulo="Saldos"
        descripcion="Saldo de cada cliente por moneda y modalidad. Cambia solo al aprobar, anular o corregir movimientos. Cada operador ve solo los saldos de sus clientes."
        acciones={vista === "resumen" && saldos.length > 0 && (
          <Link href={`/saldos/exportar?${new URLSearchParams({ ...(q && { q }), ...(moneda && { moneda }) })}`} prefetch={false} className={botonSuave}>Exportar a Excel (CSV)</Link>
        )}
      />
      {truncado && <Aviso tono="peligro">{avisoTope()} Los totales no están completos.</Aviso>}
      <nav aria-label="Vistas" className="-mb-px flex flex-wrap border-b border-borde">
        {visibles.map((x) => (
          <Link key={x.v} href={qs(x.v)} aria-current={vista === x.v ? "page" : undefined}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${vista === x.v ? "border-primario text-primario" : "border-transparent text-tenue hover:text-texto"}`}>
            {x.etiqueta}
          </Link>
        ))}
      </nav>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="v" value={vista} />
        <label className={etiqueta}>Cliente o código<input name="q" defaultValue={q} placeholder="CT-69, Comnorte…" className={campo} /></label>
        <label className={etiqueta}>Moneda
          <select name="moneda" defaultValue={moneda} className={campo}>
            <option value="">Todas</option>{(monedasR.data ?? []).map((m) => <option key={m.nombre}>{m.nombre}</option>)}
          </select>
        </label>
        <button className={boton}>Filtrar</button>
        {(q || moneda) && <Link href={qs(vista).split("?")[0] + `?v=${vista}`} className={botonSuave}>Limpiar</Link>}
      </form>

      {vista === "resumen" && (
        <Tarjeta>
          {porCliente.size === 0 ? <Vacio>Todavía no hay saldos: se crean al aprobar el primer movimiento de cada cliente.</Vacio> : (<>
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-borde text-left">
                  <th className="px-4 py-2">Cliente</th>
                  {columnas.map((k) => <th key={k} className="px-2 py-2 text-right">{k.split("|")[0]}<span className="block font-normal normal-case">{mod(k.split("|")[1])}</span></th>)}
                </tr></thead>
                <tbody>
                  {cortar([...porCliente], pagina).map(([ct, c]) => (
                    <tr key={ct} className="border-b border-borde/70">
                      <td className="px-4 py-2">{c.nombre}<span className="block text-xs text-tenue">{ct} · {c.tipo.toLowerCase()}</span></td>
                      {columnas.map((k) => {
                        const v = c.v.get(k);
                        const [m, md] = k.split("|");
                        return (
                          <td key={k} className={`px-2 py-2 text-right tabular-nums ${v != null && v < 0 ? "text-peligro" : ""}`}>
                            {v == null ? <span className="text-tenue">—</span> : (
                              <Link href={`/estado-cuenta?ct=${ct}&moneda=${m}&modalidad=${md}`} className="hover:underline" title="Ver estado de cuenta">{dinero(v)}</Link>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="px-4 py-2">Total</td>
                    {columnas.map((k) => <td key={k} className={`px-2 py-2 text-right tabular-nums ${totalCol(k) < 0 ? "text-peligro" : ""}`}>{dinero(totalCol(k))}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
            <Paginacion ruta="/saldos" sp={sp} total={porCliente.size} pagina={pagina} className="mt-3" />
          </>)}
        </Tarjeta>
      )}

      {vista === "detalle" && (
        <Tarjeta>
          {saldos.length === 0 ? <Vacio>No hay saldos con esos filtros.</Vacio> : (<>
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-borde text-left">
                  <th className="px-4 py-2">Cliente</th><th className="px-2 py-2">Moneda</th><th className="px-2 py-2">Modalidad</th>
                  <th className="px-2 py-2 text-right">Saldo</th><th className="px-2 py-2 text-right">Movimientos</th><th className="px-2 py-2">Último cambio</th><th className="px-2 py-2"></th>
                </tr></thead>
                <tbody>
                  {cortar(saldos, pagina).map((s) => (
                    <tr key={`${s.contraparte_id}|${s.moneda}|${s.modalidad}`} className="border-b border-borde/70">
                      <td className="px-4 py-2">{s.nombre}<span className="block text-xs text-tenue">{s.contraparte_id} · {s.tipo.toLowerCase()}</span></td>
                      <td className="px-2 py-2">{s.moneda}</td>
                      <td className="px-2 py-2 text-xs">{mod(s.modalidad)}</td>
                      <td className={`px-2 py-2 text-right font-semibold tabular-nums ${Number(s.saldo) < 0 ? "text-peligro" : ""}`}>{dinero(s.saldo)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{s.ultima_secuencia}</td>
                      <td className="px-2 py-2 whitespace-nowrap text-xs text-tenue">{fechaHora(s.actualizado_en)}</td>
                      <td className="px-2 py-2 text-xs">
                        <div className="flex items-center gap-3">
                          <Link className="text-primario hover:underline" href={`/estado-cuenta?ct=${s.contraparte_id}&moneda=${s.moneda}&modalidad=${s.modalidad}`}>Estado de cuenta</Link>
                          {botonRecalcular(s.contraparte_id, s.moneda, s.modalidad)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacion ruta="/saldos" sp={sp} total={saldos.length} pagina={pagina} className="mt-3" />
          </>)}
        </Tarjeta>
      )}

      {vista === "sheets" && (
        <>
          {!ultima ? <Vacio>Todavía no hay conciliaciones. Se generan con scripts/conciliar-saldos.mjs a partir de un export del Motor.</Vacio> : (
            ultima.con_diferencia
              ? <Aviso tono="peligro">Última conciliación ({fechaHora(ultima.creada_en)}, export {ultima.corte_sheets ? fechaHora(ultima.corte_sheets) : "—"}): {ultima.con_diferencia} de {ultima.buckets} saldos distintos a Sheets.</Aviso>
              : <Aviso tono="exito">Última conciliación ({fechaHora(ultima.creada_en)}, export {ultima.corte_sheets ? fechaHora(ultima.corte_sheets) : "—"}): los {ultima.buckets} saldos son iguales en la web y en Sheets.</Aviso>
          )}
          {difs.length > 0 && (
            <Tarjeta titulo="Diferencias de la última conciliación">
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-borde text-left">
                    <th className="px-4 py-2">Cliente</th><th className="px-2 py-2">Moneda · modalidad</th><th className="px-2 py-2 text-right">Sheets</th>
                    <th className="px-2 py-2 text-right">Web</th><th className="px-2 py-2 text-right">Diferencia</th>
                  </tr></thead>
                  <tbody>
                    {cortar(difs, pagina).map((d) => (
                      <tr key={`${d.contraparte_id}|${d.moneda}|${d.modalidad}`} className="border-b border-borde/70">
                        <td className="px-4 py-2">{d.contraparte_id}</td><td className="px-2 py-2 text-xs">{d.moneda} · {mod(d.modalidad)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{d.saldo_sheets == null ? "—" : dinero(d.saldo_sheets)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{d.saldo_web == null ? "—" : dinero(d.saldo_web)}</td>
                        <td className="px-2 py-2 text-right font-semibold tabular-nums text-peligro">{dinero(d.diferencia)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Paginacion ruta="/saldos" sp={sp} total={difs.length} pagina={pagina} className="mt-3" />
            </Tarjeta>
          )}
          {corridas.length > 0 && (
            <Tarjeta titulo="Historial de conciliaciones (meta del periodo en paralelo: 0 diferencias 5 días seguidos)">
              <ul className="divide-y divide-borde text-sm">
                {corridas.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 py-1.5">
                    <span className="font-mono text-xs">#{c.id}</span><span className="tabular-nums">{fechaHora(c.creada_en)}</span>
                    <span className="flex-1 truncate text-xs text-tenue">{c.fuente}</span>
                    {c.con_diferencia ? <Insignia tono="peligro">{c.con_diferencia} diferencia(s)</Insignia> : <Insignia tono="exito">sin diferencias</Insignia>}
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}
        </>
      )}

      {vista === "comparacion" && (
        <>
          {comp.length > 0 && (descuadrados
            ? <Aviso tono="peligro">{descuadrados} saldo(s) no cuadran con la suma de sus movimientos. {puedeRecalcular ? "Revíselos y recalcule." : "Avise al superadmin para recalcularlos."}</Aviso>
            : <Aviso tono="exito">Todos los saldos cuadran: el saldo guardado es igual a la suma de entradas − salidas y al último saldo de cada movimiento.</Aviso>)}
          <Tarjeta>
            {comp.length === 0 ? <Vacio>No hay saldos con esos filtros.</Vacio> : (<>
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-borde text-left">
                    <th className="px-4 py-2">Cliente</th><th className="px-2 py-2">Moneda · modalidad</th><th className="px-2 py-2 text-right">Saldo guardado</th>
                    <th className="px-2 py-2 text-right">Suma de movimientos</th><th className="px-2 py-2 text-right">Último saldo</th><th className="px-2 py-2 text-right">Diferencia</th><th className="px-2 py-2"></th>
                  </tr></thead>
                  <tbody>
                    {cortar(comp, pagina).map((c) => (
                      <tr key={`${c.contraparte_id}|${c.moneda}|${c.modalidad}`} className={`border-b border-borde/70 ${c.descuadrado ? "bg-peligro-suave/50" : ""}`}>
                        <td className="px-4 py-2">{c.nombre}<span className="block text-xs text-tenue">{c.contraparte_id} · {c.movimientos} mov.</span></td>
                        <td className="px-2 py-2 text-xs">{c.moneda} · {mod(c.modalidad)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{dinero(c.saldo_bucket)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{dinero(c.suma_movimientos)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{c.ultimo_saldo == null ? "—" : dinero(c.ultimo_saldo)}</td>
                        <td className={`px-2 py-2 text-right font-semibold tabular-nums ${c.descuadrado ? "text-peligro" : "text-tenue"}`}>{dinero(c.diferencia)}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-2">
                            {c.descuadrado ? <Insignia tono="peligro">Descuadrado</Insignia> : <Insignia tono="exito">OK</Insignia>}
                            {c.descuadrado && botonRecalcular(c.contraparte_id, c.moneda, c.modalidad)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Paginacion ruta="/saldos" sp={sp} total={comp.length} pagina={pagina} className="mt-3" />
            </>)}
          </Tarjeta>
        </>
      )}
    </div>
  );
}
