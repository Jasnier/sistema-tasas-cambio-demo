import Link from "next/link";
import { EnVivo } from "@/components/EnVivo";
import { Formulario } from "@/components/Formulario";
import { boton, botonSuave, campo, etiqueta, chip } from "@/components/estilos";
import { Encabezado, ESTADO_MOV, EstadoMovimiento, Insignia, Tarjeta, Vacio, dinero } from "@/components/ui";
import { exigirPermiso } from "@/lib/sesion";
import { sinErrores } from "@/lib/supabase/datos";
import { crearClienteServidor } from "@/lib/supabase/server";
import { accionLote } from "./actions";
import { ESTADOS, aQuery, catalogos, consultaMovimientos, fechaHora, leerFiltros, librosClienteGrande, parecidos, tasa, type FilaMov } from "./datos";
import { AccionConMotivo } from "./AccionConMotivo";
import { SeleccionarTodo } from "./SeleccionarTodo";
import { ContadorSeleccion } from "./ContadorSeleccion";

const POR_PAGINA = 100;

/** STW-23: bandeja de movimientos (reemplaza la hoja VISTAS): filtros, búsqueda, selección múltiple y exportación. */
export default async function PaginaMovimientos({ searchParams }: PageProps<"/movimientos">) {
  const sesion = await exigirPermiso("VER_MOVIMIENTOS");
  const sp = await searchParams;
  const f = leerFiltros(sp);
  const pagina = Math.max(1, Math.min(100000, Number.parseInt(typeof sp.pag === "string" ? sp.pag : "1", 10) || 1));
  const supabase = await crearClienteServidor();

  // Por páginas: solo se traen las filas que se ven (con 20 mil movimientos no se carga todo de una vez)
  // Administración: lo que un cliente grande registró no le aparece hasta que el operador lo envía (sale de borrador).
  // El envío lo hace el operador, por eso el estado "Enviado" solo se ofrece como filtro al operador.
  const esAdmin = sesion.permisos.has("APROBAR_MOVIMIENTO");
  const ocultar = esAdmin ? await librosClienteGrande(supabase) : [];
  const [{ data, count }, cat] = sinErrores(await Promise.all([
    consultaMovimientos(supabase, f, POR_PAGINA, (pagina - 1) * POR_PAGINA, ocultar), catalogos(supabase)]));
  const filas = (data ?? []) as FilaMov[];
  const dup = await parecidos(supabase, filas.map((m) => m.id));
  const puedeVerificar = sesion.permisos.has("VERIFICAR_MOVIMIENTO");
  const puedeRechazar = sesion.permisos.has("RECHAZAR_MOVIMIENTO");
  const puedeMasivo = sesion.permisos.has("EDITAR_MOVIMIENTOS_MASIVO") && f.estado === "APROBADO";
  // STW-42: el operador (o la administración) envía a verificación lo que registran sus clientes grandes
  const puedeEnviar = !sesion.permisos.has("PORTAL_CLIENTE") && sesion.permisos.has("REGISTRAR_MOVIMIENTO");
  const conSeleccion = puedeVerificar || puedeRechazar || puedeMasivo || puedeEnviar;
  const puedeRegistrar = sesion.permisos.has("REGISTRAR_MOVIMIENTO");
  const total = count ?? filas.length;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const irA = (n: number) => { const q = aQuery(f); return `/movimientos${q}${n > 1 ? `${q ? "&" : "?"}pag=${n}` : ""}`; };
  const primera = total ? (pagina - 1) * POR_PAGINA + 1 : 0;
  const paginacion = paginas > 1 && (
    <nav aria-label="Páginas" className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-tenue">
        {primera.toLocaleString("es-CO")}–{Math.min(pagina * POR_PAGINA, total).toLocaleString("es-CO")} de {total.toLocaleString("es-CO")}
      </span>
      <span className="flex items-center gap-1">
        {pagina > 1 ? <>
          <Link href={irA(1)} className={botonSuave} aria-label="Primera página">«</Link>
          <Link href={irA(pagina - 1)} className={botonSuave}>‹ Anterior</Link>
        </> : null}
        <span className="px-2 tabular-nums">Página {pagina.toLocaleString("es-CO")} de {paginas.toLocaleString("es-CO")}</span>
        {pagina < paginas ? <>
          <Link href={irA(pagina + 1)} className={botonSuave}>Siguiente ›</Link>
          <Link href={irA(paginas)} className={botonSuave} aria-label="Última página">»</Link>
        </> : null}
      </span>
    </nav>
  );

  const chips = [{ v: "", e: "Activos" }, ...ESTADOS.filter((e) => e !== "ENVIADO_OPERADOR" || !esAdmin || f.estado === e)
    .map((e) => ({ v: e, e: ESTADO_MOV[e].etiqueta }))];
  // Accesos rápidos (como las hojas de Sheets). Administración: por operador (su libro y el de sus clientes grandes).
  // Operador: su libro y cada uno de sus clientes grandes.
  const operadores = esAdmin ? cat.libros.filter((l) => l.tipo === "operador") : [];
  const misLibros = esAdmin ? [] : [...cat.libros].sort((a, b) => Number(b.tipo === "operador") - Number(a.tipo === "operador"));
  const filtrosActivos = Object.entries(f).filter(([k, v]) => v && k !== "estado" && k !== "operador").length;

  return (
    <div className="space-y-5">
      <Encabezado
        titulo="Movimientos"
        descripcion="Todo lo que registran operadores y clientes grandes. Un movimiento verificado queda bloqueado y listo para aprobar; para corregirlo hay que desbloquearlo con motivo."
        acciones={<>
          <EnVivo />
          <Link href={`/movimientos/exportar${aQuery(f)}`} className={botonSuave} prefetch={false}>Exportar a Excel (CSV)</Link>
          {sesion.permisos.has("APROBAR_MOVIMIENTO") && <Link href="/aprobacion" className={botonSuave}>Ir a aprobación</Link>}
          {puedeRegistrar && <Link href="/movimientos/nuevo" className={boton}>+ Registrar</Link>}
        </>}
      />

      <nav aria-label="Estados" className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <Link key={c.v || "activos"} href={`/movimientos${aQuery({ ...f, estado: c.v })}`}
            className={chip((f.estado || "") === c.v)}>
            {c.e}
          </Link>
        ))}
        {operadores.length > 1 && <>
          <span className="mx-1 h-6 w-px self-center bg-borde-fuerte" aria-hidden />
          <Link href={`/movimientos${aQuery({ ...f, operador: "" })}`} className={chip(!f.operador)}>Todos los operadores</Link>
          {operadores.map((o) => (
            <Link key={o.id} href={`/movimientos${aQuery({ ...f, operador: o.id, libro: "" })}`} className={chip(f.operador === o.id)}
              title={`Libro ${o.prefijo} y los de sus clientes grandes`}>
              {o.nombre}
            </Link>
          ))}
        </>}
        {misLibros.length > 1 && <>
          <span className="mx-1 h-6 w-px self-center bg-borde-fuerte" aria-hidden />
          <Link href={`/movimientos${aQuery({ ...f, libro: "" })}`} className={chip(!f.libro)}>Todos los libros</Link>
          {misLibros.map((l) => (
            <Link key={l.id} href={`/movimientos${aQuery({ ...f, libro: l.id })}`} className={chip(f.libro === l.id)} title={`Libro ${l.prefijo}`}>
              {l.tipo === "operador" ? `Mi libro (${l.prefijo})` : l.nombre}
            </Link>
          ))}
        </>}
      </nav>

      {/* Filtros siempre visibles (no se pliegan) */}
      <section className="rounded-xl border border-borde bg-superficie shadow-sm">
        <h2 className="flex items-center gap-2 px-4 py-3 text-sm font-semibold">
          Filtros y búsqueda {filtrosActivos > 0 && <Insignia tono="primario">{filtrosActivos} activo{filtrosActivos > 1 ? "s" : ""}</Insignia>}
        </h2>
        <form method="get" className="grid gap-3 border-t border-borde p-4 sm:grid-cols-2 lg:grid-cols-4">
          {f.estado && <input type="hidden" name="estado" value={f.estado} />}
          {f.operador && <input type="hidden" name="operador" value={f.operador} />}
          <label className={`${etiqueta} sm:col-span-2`}>Buscar (código, id de transacción, tercero, observaciones)
            <input name="q" defaultValue={f.q} placeholder="LN-0012, 98765…" className={campo} />
          </label>
          <label className={etiqueta}>Desde<input type="date" name="desde" defaultValue={f.desde} className={campo} /></label>
          <label className={etiqueta}>Hasta<input type="date" name="hasta" defaultValue={f.hasta} className={campo} /></label>
          <label className={etiqueta}>Libro
            <select name="libro" defaultValue={f.libro} className={campo}>
              <option value="">Todos</option>
              {cat.libros.map((l) => <option key={l.id} value={l.id}>{l.prefijo} · {l.nombre}</option>)}
            </select>
          </label>
          <label className={etiqueta}>Cliente o aliado
            <select name="contraparte" defaultValue={f.contraparte} className={campo}>
              <option value="">Todos</option>
              {cat.contrapartes.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {c.id}</option>)}
            </select>
          </label>
          <label className={etiqueta}>Moneda (origen o destino)
            <select name="moneda" defaultValue={f.moneda} className={campo}>
              <option value="">Todas</option>{cat.monedas.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={etiqueta}>Modalidad
              <select name="modalidad" defaultValue={f.modalidad} className={campo}>
                <option value="">Todas</option><option>TRANSFERENCIA</option><option>EFECTIVO</option>
              </select>
            </label>
            <label className={etiqueta}>Tipo
              <select name="tipo" defaultValue={f.tipo} className={campo}>
                <option value="">Todos</option><option value="ENTRADA">Entrada</option><option value="SALIDA">Salida</option>
              </select>
            </label>
          </div>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <button className={boton}>Aplicar filtros</button>
            <Link href={`/movimientos${aQuery({ estado: f.estado, operador: f.operador })}`} className={botonSuave}>Limpiar</Link>
          </div>
        </form>
      </section>


      <Tarjeta
        titulo={<>{total.toLocaleString("es-CO")} movimiento{total === 1 ? "" : "s"}</>}
      >
        {/* El formulario queda montado aunque la lista quede vacía, para que se vea el mensaje de lo que se hizo */}
        {/* notificar: el resultado (y lo omitido) sale arriba como aviso, no al final de una tabla larga */}
        <Formulario key={`${aQuery(f)}#${pagina}`} accion={accionLote} limpiar notificar className="group space-y-3">
          {filas.length === 0 ? (
            pagina > 1 && total > 0
              ? <Vacio>Esta página ya no tiene movimientos. <Link href={irA(1)} className="text-primario underline">Ir a la primera</Link>.</Vacio>
              : <Vacio>No hay movimientos con estos filtros.{puedeRegistrar && <> <Link href="/movimientos/nuevo" className="text-primario underline">Registrar uno</Link>.</>}</Vacio>
          ) : (<>
            {/* La barra de acciones solo aparece cuando hay al menos un movimiento marcado */}
            {conSeleccion && (
              <div className="hidden flex-wrap items-end gap-2 rounded-lg bg-superficie-2 p-2 group-has-[.fila-sel:checked]:flex">
                <ContadorSeleccion />
                {puedeVerificar && <button name="op" value="verificar" className={boton}>Verificar seleccionados</button>}
                {puedeEnviar && <button name="op" value="enviar" className={puedeVerificar ? botonSuave : boton}
                  title="Registros de clientes grandes que están en borrador">Enviar a verificación (clientes grandes)</button>}
                {puedeVerificar && <span className="mx-1 hidden h-6 w-px bg-borde-fuerte sm:block" aria-hidden />}
                {/* Desbloquear y rechazar piden el motivo en una ventana con el resumen de lo marcado */}
                {puedeVerificar && <AccionConMotivo op="desbloquear" etiqueta="Desbloquear seleccionados" titulo="Desbloquear movimientos"
                  ayuda="Vuelven a borrador para que el operador los corrija. El motivo queda en el historial." />}
                {puedeRechazar && f.estado !== "APROBADO" && <AccionConMotivo op="rechazar" etiqueta="Rechazar seleccionados" titulo="Rechazar movimientos" peligro
                  ayuda="Se devuelven a quien los registró con este motivo para que los corrija." />}
              </div>
            )}
            {puedeMasivo && (
              <div className="hidden flex-wrap items-end gap-2 rounded-lg border border-aviso/30 bg-aviso-suave/50 p-2 group-has-[.fila-sel:checked]:flex">
                <span className="self-center text-xs font-semibold text-aviso">Edición masiva de aprobados:</span>
                <label className={etiqueta}>Cambiar
                  <select name="masivo_campo" className={campo} defaultValue="modalidad">
                    <option value="modalidad">Modalidad</option><option value="moneda_destino">Moneda destino</option>
                  </select>
                </label>
                <label className={etiqueta}>Por
                  <input name="masivo_valor" list="valores-masivo" placeholder="EFECTIVO" className={`${campo} w-36`} />
                </label>
                <datalist id="valores-masivo"><option value="EFECTIVO" /><option value="TRANSFERENCIA" />{cat.monedas.map((m) => <option key={m} value={m} />)}</datalist>
                <label className={etiqueta}>Motivo
                  <input name="motivo_masivo" placeholder="Ej.: era efectivo" className={`${campo} w-48`} />
                </label>
                <label className="flex items-center gap-1.5 pb-1.5 text-xs"><input type="checkbox" name="confirmar_negativo" className="size-4" /> Aunque quede saldo negativo</label>
                <button name="op" value="masivo_simular" className={botonSuave}>Vista previa</button>
                <button name="op" value="masivo_aplicar" className={boton}>Aplicar a seleccionados</button>
              </div>
            )}
            {paginacion}
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-borde text-left">
                    {conSeleccion && <th className="w-8 px-4 py-2"><SeleccionarTodo /></th>}
                    <th className="px-2 py-2">Código</th>
                    <th className="px-2 py-2">Fecha</th>
                    <th className="px-2 py-2">Cliente</th>
                    <th className="px-2 py-2">Mov.</th>
                    <th className="px-2 py-2 text-right">Monto</th>
                    <th className="px-2 py-2">Modalidad</th>
                    <th className="px-2 py-2">Id transacción</th>
                    <th className="px-2 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((m) => {
                    const otros = dup.get(m.id);
                    const seleccionable = m.estado === "BORRADOR" || m.estado === "ENVIADO_OPERADOR" || m.estado === "VERIFICADO"
                      || (puedeMasivo && m.estado === "APROBADO");
                    return (
                      <tr key={m.id} className={`border-b border-borde/70 align-top ${m.estado === "ANULADO" ? "text-tenue line-through decoration-tenue/40" : ""}`}>
                        {conSeleccion && (
                          <td className="px-4 py-2">
                            <input type="checkbox" name="ids" value={m.id} disabled={!seleccionable} aria-label={`Seleccionar ${m.codigo}`} className="fila-sel size-4 accent-[var(--primario)]"
                              data-codigo={m.codigo} data-cliente={m.contraparte?.nombre ?? m.contraparte_id}
                              data-monto={`${dinero(m.monto_origen)} ${m.moneda_origen}`} data-estado={ESTADO_MOV[m.estado as keyof typeof ESTADO_MOV]?.etiqueta ?? m.estado} />
                          </td>
                        )}
                        <td className="px-2 py-2 whitespace-nowrap">
                          <Link href={`/movimientos/${m.id}`} className="font-mono text-xs font-semibold text-primario hover:underline">{m.codigo}</Link>
                          <span className="block text-xs text-tenue">{m.libro?.nombre}</span>
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap tabular-nums">{fechaHora(m.fecha_operacion)}</td>
                        <td className="px-2 py-2">
                          {m.contraparte?.nombre ?? m.contraparte_id}
                          <span className="block text-xs text-tenue">{m.contraparte_id}{m.tercero && ` · ${m.tercero}`}</span>
                        </td>
                        <td className="px-2 py-2">
                          <Insignia tono={m.tipo === "ENTRADA" ? "exito" : "peligro"}>{m.tipo === "ENTRADA" ? "Entrada" : "Salida"}</Insignia>
                        </td>
                        <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">
                          <span className="font-medium">{dinero(m.monto_origen)}</span> <span className="text-xs text-tenue">{m.moneda_origen}</span>
                          {m.monto_destino != null ? (
                            <span className="block text-xs" title={`Tasa ${tasa(m.tasa_aplicada)} · saldo ${dinero(m.saldo_post)}`}>
                              → <span className="font-medium">{dinero(m.monto_destino)}</span> <span className="text-tenue">{m.moneda_destino} @ {tasa(m.tasa_aplicada)}</span>
                            </span>
                          ) : <span className="block text-xs text-tenue">→ {m.moneda_destino}{m.descuento_tasa && " · ×0,95"}</span>}
                        </td>
                        <td className="px-2 py-2 text-xs">{m.modalidad === "TRANSFERENCIA" ? "Transferencia" : "Efectivo"}</td>
                        <td className="px-2 py-2 font-mono text-xs">{m.id_transaccion}</td>
                        <td className="px-2 py-2">
                          <div className="flex flex-col items-start gap-1">
                            <EstadoMovimiento estado={m.estado} />
                            {m.estado === "RECHAZADO" && m.rechazado_motivo && (
                              <span className="max-w-48 text-xs text-peligro" title={m.rechazado_motivo}>{m.rechazado_motivo}</span>
                            )}
                            {m.estado === "VERIFICADO" && m.aprobacion_error && (
                              <Insignia tono="peligro" title={m.aprobacion_error}>✕ no aprobado</Insignia>
                            )}
                            {otros && m.estado !== "ANULADO" && (
                              <Insignia tono="aviso" title={`Mismo cliente, moneda, tipo, monto y día que ${otros.join(", ")}${m.duplicado_confirmado ? " (confirmado al registrar)" : ""}`}>
                                ⚠ parecido a {otros[0]}{otros.length > 1 ? ` +${otros.length - 1}` : ""}
                              </Insignia>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {paginacion}
          </>)}
        </Formulario>
      </Tarjeta>
    </div>
  );
}
