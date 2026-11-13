import Link from "next/link";
import { Formulario } from "@/components/Formulario";
import { boton, botonPeligro, botonSuave, campo, etiqueta } from "@/components/estilos";
import { Cifra, Encabezado, Insignia, Tarjeta, Vacio, dinero } from "@/components/ui";
import { exigirPermiso } from "@/lib/sesion";
import { sinError, sinErrores } from "@/lib/supabase/datos";
import { crearClienteServidor } from "@/lib/supabase/server";
import { fechaHora, tasa } from "../movimientos/datos";
import { anularRetiro, recalcularGanancias, registrarRetiro } from "./actions";
import { Paginacion } from "@/components/Paginacion";
import { leerPagina, rango } from "@/lib/paginacion";
import { traerTodo } from "@/lib/paginar";

type Resumen = { libro_id: string; nombre: string; prefijo: string; usa_retiros: boolean; utilidad_total: number; total_retirado: number; disponible: number;
  operaciones: number; retiros: number; ultimo_movimiento: string | null };
type Ganancia = { movimiento_id: string; moneda_origen: string; beneficio: number; tasa_cliente: number; monto_base: number; utilidad: number;
  movimiento: { codigo: string; fecha_operacion: string; tercero: string | null; moneda_destino: string; monto_origen: number; estado: string } | null };
type Caja = { id: number; codigo: string; tipo: string; fecha: string; descripcion: string | null; entrada: number; salida: number; saldo: number; movimiento_id: string | null };

/**
 * STW-43 / STW-44: ganancias del cliente grande (hojas GANANCIAS y CAJA_GANANCIAS de LAZ y VRJ).
 * El cliente ve las suyas; la administración elige el cliente. A la caja solo entran SOL y REAL (P-20).
 */
export default async function PaginaGanancias({ searchParams }: PageProps<"/ganancias">) {
  const sesion = await exigirPermiso("VER_GANANCIAS");
  const sp = await searchParams;
  const supabase = await crearClienteServidor();
  const { data: res } = sinError(await supabase.from("caja_ganancia_resumen").select("*").order("nombre"));
  // RLS: el cliente solo recibe su libro; la administración, todos los que tienen ganancias activas
  const resumenes = (res ?? []) as Resumen[];
  const r = resumenes.find((x) => x.libro_id === sp.libro) ?? resumenes[0];

  // Dos tablas por páginas: la caja usa ?pag= y la ganancia por operación ?pagg=
  const pagCaja = leerPagina(sp, "pag");
  const pagGan = leerPagina(sp, "pagg");
  const [ganR, cajaR, anuR] = r ? sinErrores(await Promise.all([
    supabase.from("ganancia_movimiento").select("movimiento_id, moneda_origen, beneficio, tasa_cliente, monto_base, utilidad, movimiento:movimiento(codigo, fecha_operacion, tercero, moneda_destino, monto_origen, estado)", { count: "exact" })
      .eq("libro_id", r.libro_id).order("congelado_en", { ascending: false }).order("movimiento_id").range(...rango(pagGan)),
    supabase.from("caja_ganancia_saldo").select("*", { count: "exact" }).eq("libro_id", r.libro_id).order("id", { ascending: false }).range(...rango(pagCaja)),
    // Qué retiros ya se anularon (de toda la caja, no solo de la página que se ve)
    traerTodo<{ codigo: string }>((d, h) => supabase.from("caja_ganancia_saldo").select("codigo").eq("libro_id", r.libro_id).like("codigo", "ANU-%").order("id").range(d, h)),
  ])) : [{ data: [], count: 0 }, { data: [], count: 0 }, { data: [] }];
  const ganancias = (ganR.data ?? []) as unknown as Ganancia[];
  const caja = (cajaR.data ?? []) as Caja[];
  const anulados = new Set((anuR.data ?? []).map((c) => c.codigo.slice(4)));

  return (
    <div className="space-y-5">
      <Encabezado titulo={r ? `Ganancias · ${r.nombre}` : "Ganancias"}
        descripcion="Lo que gana el cliente en cada operación aprobada: su beneficio por el monto (menos 15 si es Agente BCP en soles), con el beneficio vigente ese día. A la caja solo entran soles y reales; anular o corregir deja un ajuste, nunca borra."
        acciones={r && sesion.permisos.has("RECALCULAR_GANANCIAS") && (
          <Formulario accion={recalcularGanancias} confirmar={`¿Recalcular las ganancias de ${r.nombre}?`}>
            <input type="hidden" name="libro" value={r.libro_id} /><button className={botonSuave}>Recalcular (superadmin)</button>
          </Formulario>
        )} />

      {resumenes.length > 1 && (
        <nav aria-label="Clientes" className="-mb-px flex flex-wrap border-b border-borde">
          {resumenes.map((x) => (
            <Link key={x.libro_id} href={`/ganancias?libro=${x.libro_id}`} aria-current={x.libro_id === r?.libro_id ? "page" : undefined}
              className={`border-b-2 px-3 py-2 text-sm font-medium ${x.libro_id === r?.libro_id ? "border-primario text-primario" : "border-transparent text-tenue hover:text-texto"}`}>
              {x.nombre}
            </Link>
          ))}
        </nav>
      )}

      {!r ? <Vacio>No hay clientes con ganancias activas (se activan en Configuración → Clientes grandes).</Vacio> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Cifra etiqueta="Utilidad total" valor={dinero(r.utilidad_total)} tono="exito" detalle={`${r.operaciones} operación(es)`} />
            <Cifra etiqueta="Total retirado" valor={dinero(r.total_retirado)} detalle={`${r.retiros} retiro(s)`} />
            <Cifra etiqueta="Disponible" valor={dinero(r.disponible)} tono={Number(r.disponible) < 0 ? "peligro" : "primario"} />
            <Cifra etiqueta="Último movimiento" valor={r.ultimo_movimiento ? fechaHora(r.ultimo_movimiento).split(",")[0] : "—"} />
          </div>

          {r.usa_retiros && sesion.permisos.has("REGISTRAR_RETIRO") && (
            <Tarjeta titulo="Registrar retiro">
              <Formulario accion={registrarRetiro} limpiar className="flex flex-wrap items-end gap-3"
                confirmar="¿Registrar el retiro? Sale de la caja de ganancias.">
                <input type="hidden" name="libro" value={r.libro_id} />
                <label className={etiqueta}>Monto<input name="monto" required inputMode="decimal" placeholder="25000,50" className={`${campo} w-40 text-right`} /></label>
                <label className={etiqueta}>Descripción<input name="descripcion" placeholder="Retiro en efectivo, transferencia…" className={`${campo} w-72`} /></label>
                <button className={boton}>Registrar retiro</button>
                <span className="text-xs text-tenue">Disponible: {dinero(r.disponible)}. No se puede retirar más de lo disponible.</span>
              </Formulario>
            </Tarjeta>
          )}

          <Tarjeta titulo="Caja de ganancias">
            {caja.length === 0 ? <Vacio>La caja está vacía: se llena al aprobar operaciones en SOL o REAL.</Vacio> : (
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-borde text-left">
                    <th className="px-4 py-2">Código</th><th className="px-2 py-2">Fecha</th><th className="px-2 py-2">Tipo</th><th className="px-2 py-2">Descripción</th>
                    <th className="px-2 py-2 text-right">Entrada</th><th className="px-2 py-2 text-right">Salida</th><th className="px-2 py-2 text-right">Saldo</th><th className="px-2 py-2"></th>
                  </tr></thead>
                  <tbody>
                    {caja.map((c) => (
                      <tr key={c.id} className="border-b border-borde/70">
                        <td className="px-4 py-1.5 font-mono text-xs">{c.movimiento_id ? <Link href={`/movimientos/${c.movimiento_id}`} className="text-primario hover:underline">{c.codigo}</Link> : c.codigo}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{fechaHora(c.fecha)}</td>
                        <td className="px-2 py-1.5"><Insignia tono={c.tipo === "UTILIDAD" ? "exito" : c.tipo === "RETIRO" ? "info" : "aviso"}>{c.tipo.toLowerCase()}</Insignia></td>
                        <td className="px-2 py-1.5 text-xs">{c.descripcion}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-exito">{Number(c.entrada) ? dinero(c.entrada) : ""}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-peligro">{Number(c.salida) ? dinero(c.salida) : ""}</td>
                        <td className={`px-2 py-1.5 text-right font-medium tabular-nums ${Number(c.saldo) < 0 ? "text-peligro" : ""}`}>{dinero(c.saldo)}</td>
                        <td className="px-2 py-1.5">
                          {c.tipo === "RETIRO" && sesion.permisos.has("APROBAR_MOVIMIENTO") ? (
                            // El formulario queda montado después de anular, para que se vea la confirmación
                            <Formulario accion={anularRetiro} className="flex flex-col items-start gap-1" confirmar={`¿Anular ${c.codigo}? Entra un ajuste por el mismo valor.`}>
                              {anulados.has(c.codigo) ? <Insignia>anulado</Insignia> : (
                                <details><summary className="cursor-pointer text-xs text-peligro">Anular</summary>
                                  <div className="mt-2 flex items-end gap-2">
                                    <input type="hidden" name="codigo" value={c.codigo} />
                                    <input name="motivo" required minLength={3} placeholder="Motivo" aria-label={`Motivo para anular ${c.codigo}`} className={`${campo} w-36`} />
                                    <button className={botonPeligro}>Anular</button>
                                  </div>
                                </details>
                              )}
                            </Formulario>
                          ) : anulados.has(c.codigo) && <Insignia>anulado</Insignia>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Paginacion ruta="/ganancias" sp={sp} total={cajaR.count ?? 0} pagina={pagCaja} parametro="pag" className="mt-3" />
          </Tarjeta>

          <Tarjeta titulo="Ganancia por operación">
            {ganancias.length === 0 ? <Vacio>Todavía no hay operaciones aprobadas.</Vacio> : (
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-borde text-left">
                    <th className="px-4 py-2">Código</th><th className="px-2 py-2">Fecha</th><th className="px-2 py-2">Par</th>
                    <th className="px-2 py-2 text-right">Monto base</th><th className="px-2 py-2 text-right">Beneficio</th><th className="px-2 py-2 text-right">Tasa cliente</th>
                    <th className="px-2 py-2 text-right">Ganancia</th><th className="px-2 py-2"></th>
                  </tr></thead>
                  <tbody>
                    {ganancias.map((g) => {
                      const enCaja = ["SOL", "REAL"].includes(g.moneda_origen);
                      return (
                        <tr key={g.movimiento_id} className={`border-b border-borde/70 ${g.movimiento?.estado === "ANULADO" ? "text-tenue line-through" : ""}`}>
                          <td className="px-4 py-1.5"><Link href={`/movimientos/${g.movimiento_id}`} className="font-mono text-xs font-semibold text-primario hover:underline">{g.movimiento?.codigo}</Link>
                            {g.movimiento?.tercero && <span className="block text-xs text-tenue">{g.movimiento.tercero}</span>}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{g.movimiento ? fechaHora(g.movimiento.fecha_operacion) : ""}</td>
                          <td className="px-2 py-1.5 text-xs">{g.moneda_origen} → {g.movimiento?.moneda_destino}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{dinero(g.monto_base)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{tasa(g.beneficio)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{tasa(g.tasa_cliente)}</td>
                          <td className="px-2 py-1.5 text-right font-medium tabular-nums">{dinero(g.utilidad)}</td>
                          <td className="px-2 py-1.5 text-xs">{g.movimiento?.estado === "ANULADO" ? <Insignia>anulado</Insignia> : !enCaja && <Insignia title="P-20: a la caja solo entran SOL y REAL">no va a caja</Insignia>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <Paginacion ruta="/ganancias" sp={sp} total={ganR.count ?? 0} pagina={pagGan} parametro="pagg" className="mt-3" />
          </Tarjeta>
          {!r.usa_retiros && <p className="text-xs text-tenue">Este cliente no tiene activados los retiros (Configuración → Clientes grandes).</p>}
        </>
      )}
    </div>
  );
}
