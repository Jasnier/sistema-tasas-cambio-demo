import Link from "next/link";
import { Formulario } from "@/components/Formulario";
import { boton, botonSuave, campo } from "@/components/estilos";
import { ahoraMs } from "@/lib/fechas";
import { exigirPermiso } from "@/lib/sesion";
import { sinErrores } from "@/lib/supabase/datos";
import { crearClienteServidor } from "@/lib/supabase/server";
import { apropiar, corregir, liberar, responderLiberacion, solicitarLiberacion, tomar } from "./actions";
import { DialogoMotivo } from "./DialogoMotivo";
import { Paginacion } from "@/components/Paginacion";
import { cortar, leerPagina, rango } from "@/lib/paginacion";
import { traerTodo } from "@/lib/paginar";
import { Encabezado, Insignia } from "@/components/ui";
import { BandejaEnVivo } from "./BandejaEnVivo";

/**
 * STW-18: bandeja de comprobantes por apropiar (reemplaza BANDEJA_BRASIL de Brasil Operadores).
 * Una sola bandeja con todos los bancos (pedido de Jasnier, 2026-11-11): buscador por ID, remitente o código,
 * filtros plegables y una pestaña "Apropiados" con lo ya apropiado y quién lo apropió (apropiadores_brasil, 2500).
 */
type Comp = {
  id: string; codigo: string; banco_id: string; fecha: string; id_tx: string | null; remitente: string | null;
  observacion: string | null; tipo: string; valor: number; estado: string; bloqueado_por: string | null;
  bloqueado_en: string | null; envio_mensaje: string | null;
};
type Apropiado = {
  id: string; codigo: string; banco_id: string; fecha: string; id_tx: string | null; remitente: string | null; tipo: string;
  valor: number; codigo_brs: string | null; libro_destino_id: string | null; apropiado_por: string | null; apropiado_en: string;
};
type Libro = { id: string; codigo: string; prefijo: string; nombre: string; tipo: string };
type Item = { id: string; nombre: string };
type Solicitud = { id: string; comprobante_id: string; comprobante: string; valor: number; movimiento: string | null; libro: string | null;
  motivo: string; estado: string; respuesta: string | null; creado_en: string; atendida_en: string | null;
  solicitado_por: string; solicitante: string; dirigida_a: string | null; apropiador: string | null };
type Reciente = { id: string; codigo: string; valor: number; tipo: string; remitente: string | null; codigo_brs: string | null;
  apropiado_en: string; libro_destino_id: string | null };

const TOMA_MS = 10 * 60 * 1000;
const dinero = (n: number) => Number(n).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uno = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim() : "");
const fechaValida = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
const uuid = (v: string) => (/^[0-9a-f-]{36}$/i.test(v) ? v : "");
const horaBogota = (iso: string) => new Date(iso).toLocaleString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default async function PaginaBandeja({ searchParams }: PageProps<"/brasil/bandeja">) {
  const sesion = await exigirPermiso("BRASIL_APROPIAR");
  const sp = await searchParams;
  const vista = uno(sp.vista) === "apropiados" ? "apropiados" : "pendientes";
  const banco = uno(sp.banco);
  const desde = fechaValida(uno(sp.desde));
  const hasta = fechaValida(uno(sp.hasta));
  const tipo = ["ENTRADA", "SALIDA"].includes(uno(sp.tipo)) ? uno(sp.tipo) : "";
  // Lo que va dentro de un .or() de PostgREST no puede llevar comas, paréntesis ni comodines
  const q = uno(sp.q).replace(/[,()*%\\]/g, " ").trim().slice(0, 60);
  const por = vista === "apropiados" ? uuid(uno(sp.por)) : "";
  const libroF = vista === "apropiados" ? uuid(uno(sp.libro)) : "";
  const pagina = leerPagina(sp);
  const supabase = await crearClienteServidor();
  const ahora = (await ahoraMs());

  // Todo lo pendiente (para encontrar siempre lo que está "en proceso por usted"); los filtros se aplican al pintar
  const pendientesQ = traerTodo<Comp>((d, h) => supabase.from("comprobante_brasil")
    .select("id, codigo, banco_id, fecha, id_tx, remitente, observacion, tipo, valor, estado, bloqueado_por, bloqueado_en, envio_mensaje")
    .eq("clase", "COMPROBANTE").in("estado", ["PENDIENTE", "EN_PROCESO", "ERROR"])
    .order("fecha").order("creado_en").order("id").range(d, h));
  // Lo que esta persona apropió hace poco: queda a la vista aunque se cierre el formulario
  const recientesQ = supabase.from("comprobante_brasil")
    .select("id, codigo, valor, tipo, remitente, codigo_brs, apropiado_en, libro_destino_id")
    .eq("estado", "APLICADO").eq("apropiado_por", sesion.id).gte("apropiado_en", new Date(ahora - 2 * 3600 * 1000).toISOString())
    .order("apropiado_en", { ascending: false }).limit(20);
  // Pestaña Apropiados: los filtros van a la base y se pide solo la página que se ve
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filtrarApropiados = (c: any) => {
    c = c.eq("estado", "APLICADO");
    if (banco) c = c.eq("banco_id", banco);
    if (desde) c = c.gte("fecha", desde);
    if (hasta) c = c.lte("fecha", hasta);
    if (tipo) c = c.eq("tipo", tipo);
    if (por) c = c.eq("apropiado_por", por);
    if (libroF) c = c.eq("libro_destino_id", libroF);
    if (q) c = c.or(`id_tx.ilike.%${q}%,remitente.ilike.%${q}%,codigo.ilike.%${q}%,codigo_brs.ilike.%${q}%`);
    return c;
  };
  const totalApropiadosQ = filtrarApropiados(supabase.from("comprobante_brasil").select("id", { count: "exact", head: true }));
  const apropiadosQ = vista === "apropiados"
    ? filtrarApropiados(supabase.from("comprobante_brasil")
        .select("id, codigo, banco_id, fecha, id_tx, remitente, tipo, valor, codigo_brs, libro_destino_id, apropiado_por, apropiado_en"))
        .order("apropiado_en", { ascending: false }).order("id").range(...rango(pagina))
    : Promise.resolve({ data: [] });

  const [{ data: pendientesTodos }, { data: recientesD }, { count: totalApropiados }, { data: apropiadosD },
    bancosR, librosR, apropiadoresR, monedasR, recibidosR, empresasR, contrapartesR, solicitudesR] = sinErrores(await Promise.all([
    pendientesQ,
    recientesQ,
    totalApropiadosQ,
    apropiadosQ,
    supabase.from("banco_brasil").select("id, nombre").eq("activo", true).order("orden"),
    // Libros destino por función (2400): quien apropia no lee la tabla libro completa (P-1)
    supabase.rpc("libros_destino_brasil"),
    // Nombre de quien apropió (2500): la tabla usuario solo deja leer el propio nombre
    supabase.rpc("apropiadores_brasil"),
    supabase.from("moneda").select("nombre").eq("activo", true).order("orden"),
    supabase.from("recibido_en").select("id, nombre").eq("activo", true).order("orden"),
    supabase.from("empresa").select("id, nombre").eq("activo", true).order("orden"),
    supabase.from("contraparte").select("id, nombre, tipo").eq("activo", true).order("nombre"),
    // Corregir apropiaciones (2600): solicitudes de liberación que le tocan (con nombres)
    supabase.rpc("solicitudes_liberacion"),
  ]));
  const vigenteMia = (c: Comp) => c.estado === "EN_PROCESO" && c.bloqueado_por === sesion.id && c.bloqueado_en && Date.parse(c.bloqueado_en) + TOMA_MS > ahora;
  const tomadoPorOtro = (c: Comp) => c.estado === "EN_PROCESO" && c.bloqueado_por !== sesion.id && c.bloqueado_en && Date.parse(c.bloqueado_en) + TOMA_MS > ahora;
  const mios = pendientesTodos.filter(vigenteMia);
  const porApropiar = pendientesTodos.filter((c) => !vigenteMia(c));
  // Buscador y filtros sobre lo pendiente (está todo en memoria)
  const texto = q.toLowerCase();
  const bandeja = porApropiar.filter((c) => (!banco || c.banco_id === banco) && (!desde || c.fecha >= desde) && (!hasta || c.fecha <= hasta)
    && (!tipo || c.tipo === tipo)
    && (!texto || [c.id_tx, c.remitente, c.codigo].some((v) => v?.toLowerCase().includes(texto))));
  const bancos = (bancosR.data ?? []) as Item[];
  const nombreBanco = Object.fromEntries(bancos.map((b) => [b.id, b.nombre]));
  const libros = (librosR.data ?? []) as Libro[];
  const libroPorId = new Map(libros.map((l) => [l.id, l]));
  const nombreLibro = (id: string | null) => { const l = id ? libroPorId.get(id) : undefined; return l ? `${l.prefijo} · ${l.nombre}` : "—"; };
  const apropiadores = (apropiadoresR.data ?? []) as Item[];
  const nombreUsuario = new Map(apropiadores.map((u) => [u.id, u.nombre]));
  const monedas = (monedasR.data ?? []).map((m) => m.nombre as string);
  const recibidos = (recibidosR.data ?? []) as Item[];
  const empresas = (empresasR.data ?? []) as Item[];
  const contrapartes = (contrapartesR.data ?? []) as (Item & { tipo: string })[];
  const recientes = (recientesD ?? []) as unknown as Reciente[];
  const apropiados = (apropiadosD ?? []) as unknown as Apropiado[];
  const esAdmin = sesion.permisos.has("APROBAR_MOVIMIENTO");
  const solicitudes = (solicitudesR.data ?? []) as Solicitud[];
  // Para mí: las que me piden a mí (la administración ve todas las abiertas). Mías: las que yo pedí.
  const paraMi = solicitudes.filter((x) => x.estado === "PENDIENTE" && (x.dirigida_a === sesion.id || (esAdmin && x.solicitado_por !== sesion.id)));
  const pedidasPorMi = solicitudes.filter((x) => x.solicitado_por === sesion.id);
  const solicitudAbierta = new Map(solicitudes.filter((x) => x.estado === "PENDIENTE").map((x) => [x.comprobante_id, x]));
  const resumenComp = (codigo: string, valor: number, brs: string | null, libro: string) =>
    [`Comprobante ${codigo} · ${dinero(valor)} BRL`, `Movimiento ${brs ?? "—"} en ${libro}`];
  /** Corregir (si es suyo o es administración) o solicitar la liberación (si lo apropió otra persona). */
  const accionApropiado = (a: { id: string; codigo: string; valor: number; codigo_brs: string | null; libro_destino_id: string | null; apropiado_por?: string | null }, enlace = false) => {
    const resumen = resumenComp(a.codigo, a.valor, a.codigo_brs, nombreLibro(a.libro_destino_id));
    if (a.apropiado_por === sesion.id || esAdmin) {
      return <DialogoMotivo accion={corregir} campos={{ id: a.id }} etiqueta="Corregir" enlace={enlace} peligro
        titulo="Corregir apropiación" resumen={resumen} confirmar="Corregir"
        ayuda="El movimiento se anula (desaparece del libro donde está) y el comprobante vuelve a usted por 10 minutos para apropiarlo bien."
        placeholder="Ej.: lo mandé al libro equivocado" />;
    }
    const abierta = solicitudAbierta.get(a.id);
    if (abierta) return <span className="text-xs text-tenue">{abierta.solicitado_por === sesion.id ? "Liberación solicitada" : `Lo pidió ${abierta.solicitante}`}</span>;
    return <DialogoMotivo accion={solicitarLiberacion} campos={{ id: a.id }} etiqueta="Solicitar liberación" enlace={enlace}
      titulo="Solicitar liberación" resumen={[...resumen, `Lo apropió ${(a.apropiado_por && nombreUsuario.get(a.apropiado_por)) ?? "otra persona"}`]}
      confirmar="Enviar solicitud" ayuda="A quien lo apropió le llega su solicitud. Si la acepta, el comprobante pasa a usted para apropiarlo."
      placeholder="Ej.: ese pago es de mi cliente" />;
  };
  const vence = (c: Comp) => new Date(Date.parse(c.bloqueado_en!) + TOMA_MS).toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit" });

  const filtrosActivos = [banco, desde, hasta, tipo, por, libroF].filter(Boolean).length;
  // Cambiar de pestaña conserva la búsqueda y los filtros comunes (no los propios de Apropiados)
  const enlaceVista = (v: string) => {
    const p = new URLSearchParams(Object.entries({ vista: v === "pendientes" ? "" : v, q, banco, desde, hasta, tipo }).filter(([, x]) => x));
    return `/brasil/bandeja${p.size ? "?" + p : ""}`;
  };
  const pestana = (v: string, etiqueta: string, n: number) => (
    <Link key={v} href={enlaceVista(v)} aria-current={vista === v ? "page" : undefined}
      className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${vista === v
        ? "border-primario text-primario" : "border-transparent text-tenue hover:border-borde-fuerte hover:text-texto"}`}>
      {etiqueta}
      <span className={`rounded-full px-1.5 text-xs tabular-nums ${n ? "bg-primario-suave text-primario" : "bg-superficie-2 text-tenue"}`}>{n.toLocaleString("es-CO")}</span>
    </Link>
  );

  return (
    <div className="space-y-6">
      <Encabezado
        titulo="Brasil · bandeja y apropiación"
        acciones={<BandejaEnVivo />}
        descripcion="Todos los bancos llegan a esta bandeja. Tome un comprobante (queda a su nombre 10 minutos), complete los datos y apropíelo: se crea el movimiento en borrador en el libro elegido y sigue la verificación y aprobación de siempre. Si ese movimiento se anula, el comprobante vuelve aquí."
      />

      {paraMi.length > 0 && (
        <section className="space-y-2 rounded-xl border border-aviso/40 bg-aviso-suave/50 p-4" aria-label="Solicitudes de liberación">
          <h2 className="font-semibold text-aviso">{paraMi.length === 1 ? "1 solicitud para liberar un comprobante" : `${paraMi.length} solicitudes para liberar comprobantes`}</h2>
          <ul className="divide-y divide-aviso/20 text-sm">
            {paraMi.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{x.solicitante}</strong> pide <span className="font-mono text-xs">{x.comprobante}</span> ({dinero(x.valor)} BRL,{" "}
                  <span className="font-mono text-xs">{x.movimiento}</span> en {x.libro}{esAdmin && x.apropiador ? `, lo apropió ${x.apropiador}` : ""}):{" "}
                  <em>«{x.motivo}»</em>
                </span>
                <span className="flex items-center gap-2">
                  <Formulario accion={responderLiberacion} notificar
                    confirmar={`¿Liberar ${x.comprobante} para ${x.solicitante}? Se anula ${x.movimiento ?? "el movimiento"} y el comprobante pasa a esa persona.`}>
                    <input type="hidden" name="solicitud" value={x.id} /><input type="hidden" name="aceptar" value="1" />
                    <button className={boton}>Liberar</button>
                  </Formulario>
                  <DialogoMotivo accion={responderLiberacion} campos={{ solicitud: x.id, aceptar: "0" }} etiqueta="Rechazar" peligro
                    titulo="Rechazar la solicitud" confirmar="Rechazar" resumen={[`${x.solicitante} pide ${x.comprobante}: «${x.motivo}»`]}
                    ayuda="La apropiación sigue igual. A quien lo pidió le llega su respuesta." placeholder="Ej.: ese pago es de Comnorte, ya lo confirmé" />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pedidasPorMi.length > 0 && (
        <section className="space-y-1 rounded-xl border border-borde bg-superficie p-4 text-sm shadow-xs" aria-label="Sus solicitudes">
          <h2 className="font-semibold">Sus solicitudes de liberación</h2>
          <ul className="space-y-1">
            {pedidasPorMi.map((x) => (
              <li key={x.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-xs">{x.comprobante}</span>
                <span className="text-tenue">a {x.apropiador ?? "—"}</span>
                {x.estado === "PENDIENTE" ? <Insignia tono="aviso">Esperando respuesta</Insignia>
                  : x.estado === "ACEPTADA" ? <Insignia tono="exito">Liberado: ya es suyo arriba (10 min)</Insignia>
                  : x.estado === "RECHAZADA" ? <Insignia tono="peligro">Rechazada</Insignia>
                  : <Insignia>Sin efecto</Insignia>}
                {x.respuesta && <span className="text-xs text-tenue">«{x.respuesta}»</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {vista === "pendientes" && mios.length > 0 && (
        <section className="space-y-3 rounded-xl border border-borde bg-superficie p-4 shadow-sm">
          <h2 className="font-semibold">En proceso por usted</h2>
          {mios.map((c) => (
            <div key={c.id} className="space-y-2 rounded-md border border-primario/40 p-3">
              <p className="text-sm">
                <span className="font-mono">{c.codigo}</span> · {nombreBanco[c.banco_id] ?? c.banco_id} · {c.fecha} · {c.tipo.toLowerCase()} <strong>{dinero(c.valor)}</strong> BRL
                {c.id_tx && <> · ID {c.id_tx}</>}{c.remitente && <> · {c.remitente}</>}
                <span className="ml-2 text-xs text-tenue">suyo hasta las {vence(c)}</span>
              </p>
              <Formulario accion={apropiar} notificar className="flex flex-wrap items-end gap-2 text-sm"
                confirmar={`¿Apropiar ${c.codigo} al libro elegido? Se crea el movimiento BRS- en borrador.`}>
                <input type="hidden" name="id" value={c.id} />
                <label className="flex flex-col">Libro destino
                  <select name="libro" required defaultValue="" className={campo}>
                    <option value="" disabled>Elija…</option>
                    {libros.map((l) => <option key={l.id} value={l.id}>{l.prefijo} · {l.nombre}{l.tipo === "cliente_grande" ? " (cliente grande)" : ""}</option>)}
                  </select>
                </label>
                <label className="flex flex-col">Hora<input type="time" name="hora" required className={campo} /></label>
                <label className="flex flex-col">Modalidad
                  <select name="modalidad" className={campo}><option>TRANSFERENCIA</option><option>EFECTIVO</option></select>
                </label>
                <label className="flex flex-col">Moneda destino
                  <select name="moneda_destino" required defaultValue="COP" className={campo}>{monedas.map((m) => <option key={m}>{m}</option>)}</select>
                </label>
                <label className="flex flex-col">Recibido en
                  <select name="recibido_en" className={campo}><option value="">—</option>{recibidos.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select>
                </label>
                <label className="flex flex-col">Empresa
                  <select name="empresa" className={campo}><option value="">—</option>{empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select>
                </label>
                <label className="flex flex-col">Contraparte
                  <select name="contraparte" required defaultValue="" className={`${campo} max-w-64`}>
                    <option value="" disabled>Elija…</option>
                    {contrapartes.map((k) => <option key={k.id} value={k.id}>{k.nombre} · {k.id} · {k.tipo.toLowerCase()}</option>)}
                  </select>
                </label>
                <button className={boton}>Apropiar</button>
              </Formulario>
              <Formulario accion={liberar} notificar><input type="hidden" name="id" value={c.id} /><button className={botonSuave}>Liberar sin apropiar</button></Formulario>
              {c.envio_mensaje && <p className="text-xs text-aviso">{c.envio_mensaje}</p>}
            </div>
          ))}
        </section>
      )}

      {vista === "pendientes" && recientes.length > 0 && (
        <section className="space-y-2 rounded-xl border border-exito/30 bg-exito-suave/40 p-4">
          <h2 className="font-semibold">Apropiados por usted (últimas 2 horas)</h2>
          <ul className="space-y-1 text-sm">
            {recientes.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-xs">{r.codigo}</span><span aria-hidden>→</span>
                <Link href={`/movimientos?q=${r.codigo_brs ?? ""}`} className="font-mono font-semibold text-primario hover:underline">{r.codigo_brs}</Link>
                <span>en {nombreLibro(r.libro_destino_id)}</span>
                <span className="tabular-nums text-tenue">{r.tipo === "SALIDA" ? "−" : ""}{dinero(r.valor)} BRL{r.remitente ? ` · ${r.remitente}` : ""}</span>
                <span className="text-xs text-tenue">{new Date(r.apropiado_en).toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit" })}</span>
                {accionApropiado({ ...r, apropiado_por: sesion.id }, true)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-borde bg-superficie p-4 shadow-sm">
        <nav aria-label="Vistas" className="-mx-4 -mt-4 flex flex-wrap border-b border-borde px-1">
          {pestana("pendientes", "Por apropiar", porApropiar.length)}
          {pestana("apropiados", "Apropiados", totalApropiados ?? 0)}
        </nav>

        {/* Buscador siempre a la vista; los filtros se abren con el botón (si hay alguno aplicado, se ven abiertos) */}
        <form role="search" className="space-y-2 text-sm">
          {vista === "apropiados" && <input type="hidden" name="vista" value="apropiados" />}
          <input type="checkbox" id="ver-filtros-bandeja" className="peer sr-only" defaultChecked={filtrosActivos > 0} />
          <div className="flex flex-wrap items-center gap-2">
            <input type="search" name="q" defaultValue={q} aria-label="Buscar"
              placeholder={vista === "apropiados" ? "Buscar por ID, remitente, código o BRS-…" : "Buscar por ID, remitente o código…"}
              className={`${campo} min-w-0 flex-1 sm:max-w-sm`} />
            <button className={boton}>Buscar</button>
            <label htmlFor="ver-filtros-bandeja" className={`${botonSuave} cursor-pointer select-none`} role="button" aria-controls="filtros-bandeja">
              <span aria-hidden>⚲</span> Filtros{filtrosActivos > 0 && <span className="rounded-full bg-primario px-1.5 text-xs text-primario-texto">{filtrosActivos}</span>}
            </label>
            {(q || filtrosActivos > 0) && <Link href={enlaceVista(vista).split("?")[0] + (vista === "apropiados" ? "?vista=apropiados" : "")} className="text-xs underline">Quitar búsqueda y filtros</Link>}
          </div>
          <div id="filtros-bandeja" className="hidden flex-wrap items-end gap-2 rounded-lg border border-borde bg-superficie-2/50 p-3 peer-checked:flex">
            <label className="flex flex-col">Banco
              <select name="banco" defaultValue={banco} className={campo}>
                <option value="">Todos</option>{bancos.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
              </select>
            </label>
            <label className="flex flex-col">Desde<input type="date" name="desde" defaultValue={desde} className={campo} /></label>
            <label className="flex flex-col">Hasta<input type="date" name="hasta" defaultValue={hasta} className={campo} /></label>
            <label className="flex flex-col">Tipo
              <select name="tipo" defaultValue={tipo} className={campo}>
                <option value="">Todos</option><option value="ENTRADA">Entradas</option><option value="SALIDA">Salidas</option>
              </select>
            </label>
            {vista === "apropiados" && <>
              <label className="flex flex-col">Apropiado por
                <select name="por" defaultValue={por} className={campo}>
                  <option value="">Cualquiera</option>{apropiadores.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select>
              </label>
              <label className="flex flex-col">Libro destino
                <select name="libro" defaultValue={libroF} className={campo}>
                  <option value="">Todos</option>{libros.map((l) => <option key={l.id} value={l.id}>{l.prefijo} · {l.nombre}</option>)}
                </select>
              </label>
            </>}
            <button className={botonSuave}>Aplicar filtros</button>
          </div>
        </form>

        {vista === "pendientes" ? <>
          <p className="text-sm"><strong>{bandeja.length.toLocaleString("es-CO")}</strong> por apropiar
            {bandeja.length !== porApropiar.length && <span className="text-tenue"> (de {porApropiar.length.toLocaleString("es-CO")}, con la búsqueda o los filtros)</span>}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-borde text-left">
                <th className="px-2 py-2">Código</th><th className="px-2 py-2">Banco</th><th className="px-2 py-2">Fecha</th><th className="px-2 py-2">ID</th>
                <th className="px-2 py-2">Remitente</th><th className="px-2 py-2 text-right">Valor</th><th className="px-2 py-2">Estado</th><th className="px-2 py-2"></th>
              </tr></thead>
              <tbody>
                {cortar(bandeja, pagina).map((c) => (
                  <tr key={c.id} className="border-b border-borde/70 align-top">
                    <td className="px-2 py-1 font-mono text-xs whitespace-nowrap">{c.codigo}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{nombreBanco[c.banco_id] ?? c.banco_id}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{c.fecha}</td>
                    <td className="px-2 py-1 font-mono text-xs">{c.id_tx}</td>
                    <td className="px-2 py-1">{c.remitente}{c.observacion && <span className="block text-xs text-tenue">{c.observacion}</span>}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{c.tipo === "SALIDA" ? "−" : ""}{dinero(c.valor)}</td>
                    <td className="px-2 py-1">
                      {tomadoPorOtro(c) ? <span className="text-xs">en proceso (otra persona, hasta las {vence(c)})</span>
                        : c.estado === "ERROR" ? <span className="text-xs text-peligro" title={c.envio_mensaje ?? ""}>error del envío anterior: {c.envio_mensaje}</span>
                        : <span className="text-xs">{c.estado === "EN_PROCESO" ? "pendiente (toma vencida)" : "pendiente"}
                            {c.envio_mensaje && <span className="block text-aviso">{c.envio_mensaje}</span>}</span>}
                    </td>
                    <td className="px-2 py-1">
                      {!tomadoPorOtro(c) && (
                        <Formulario accion={tomar} notificar><input type="hidden" name="id" value={c.id} /><button className={botonSuave}>{c.estado === "ERROR" ? "Reintentar" : "Tomar"}</button></Formulario>
                      )}
                    </td>
                  </tr>
                ))}
                {bandeja.length === 0 && <tr><td colSpan={8} className="px-2 py-4 text-tenue">
                  {porApropiar.length ? "Ningún comprobante por apropiar coincide con la búsqueda o los filtros." : "No hay comprobantes por apropiar."}</td></tr>}
              </tbody>
            </table>
          </div>
          <Paginacion ruta="/brasil/bandeja" sp={sp} total={bandeja.length} pagina={pagina} />
        </> : <>
          <p className="text-sm"><strong>{(totalApropiados ?? 0).toLocaleString("es-CO")}</strong> apropiado(s){(q || filtrosActivos > 0) && <span className="text-tenue"> con la búsqueda o los filtros</span>}, del más reciente al más antiguo</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-borde text-left">
                <th className="px-2 py-2">Código</th><th className="px-2 py-2">Banco</th><th className="px-2 py-2">Fecha</th><th className="px-2 py-2">ID</th>
                <th className="px-2 py-2">Remitente</th><th className="px-2 py-2 text-right">Valor</th><th className="px-2 py-2">Movimiento</th>
                <th className="px-2 py-2">Libro destino</th><th className="px-2 py-2">Apropiado por</th><th className="px-2 py-2">Cuándo</th>
                <th className="px-2 py-2"><span className="sr-only">Acción</span></th>
              </tr></thead>
              <tbody>
                {apropiados.map((a) => (
                  <tr key={a.id} className="border-b border-borde/70 align-top">
                    <td className="px-2 py-1 font-mono text-xs whitespace-nowrap">{a.codigo}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{nombreBanco[a.banco_id] ?? a.banco_id}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{a.fecha}</td>
                    <td className="px-2 py-1 font-mono text-xs">{a.id_tx}</td>
                    <td className="px-2 py-1">{a.remitente}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{a.tipo === "SALIDA" ? "−" : ""}{dinero(a.valor)}</td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {a.codigo_brs ? <Link href={`/movimientos?q=${a.codigo_brs}`} className="font-mono text-xs font-semibold text-primario hover:underline">{a.codigo_brs}</Link> : "—"}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">{nombreLibro(a.libro_destino_id)}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{(a.apropiado_por && nombreUsuario.get(a.apropiado_por)) ?? "—"}</td>
                    <td className="px-2 py-1 whitespace-nowrap tabular-nums text-tenue">{a.apropiado_en ? horaBogota(a.apropiado_en) : "—"}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{accionApropiado(a)}</td>
                  </tr>
                ))}
                {apropiados.length === 0 && <tr><td colSpan={11} className="px-2 py-4 text-tenue">
                  {q || filtrosActivos > 0 ? "Ningún comprobante apropiado coincide con la búsqueda o los filtros." : "Todavía no se ha apropiado ningún comprobante."}</td></tr>}
              </tbody>
            </table>
          </div>
          <Paginacion ruta="/brasil/bandeja" sp={sp} total={totalApropiados ?? 0} pagina={pagina} />
        </>}
      </section>
    </div>
  );
}
