import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/components/Formulario";
import { boton, botonPeligro, botonSuave, campo, etiqueta } from "@/components/estilos";
import { Aviso, Encabezado, EstadoMovimiento, Insignia, Tarjeta, dinero } from "@/components/ui";
import { ahoraMs } from "@/lib/fechas";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { accionLote, anularBorrador, anularMovimiento } from "../actions";
import { COLUMNAS, catalogos, fechaHora, parecidos, partesBogota, tasa, type FilaMov } from "../datos";
import { FormularioMovimiento } from "../FormularioMovimiento";
import { FormularioCorreccion } from "../FormularioCorreccion";

type Detalle = FilaMov & {
  verificado_por: string | null; desbloqueo_motivo: string | null; desbloqueado_en: string | null;
  anulado_motivo: string | null; anulado_en: string | null; creado_por: string | null; actualizado_en: string;
  recibido_en: { nombre: string } | null; empresa: { nombre: string } | null;
  monto_efectivo: number | null; entrada: number | null; salida: number | null; saldo_anterior: number | null;
  tasa_cliente_id: string | null; secuencia_bucket: number | null; aprobacion_error_en: string | null;
  rechazado_en: string | null; corregido_motivo: string | null; corregido_en: string | null;
};
type Utilidad = { tasa_adquisicion: number; valor_adquisicion: number; utilidad: number; puntos_utilidad: number; beneficio: number;
  tasa_utilidad_id: string | null; ajuste_id: string | null; marca_utilidad: string | null; puntos_restados: number | null; motivo_ajuste: string | null };
type Cambio = { id: number; accion: string; en: string; usuario_id: string | null; antes: Record<string, unknown> | null; despues: Record<string, unknown> | null };

const CAMPOS_HISTORIAL: Record<string, string> = {
  estado: "Estado", monto_origen: "Monto", id_transaccion: "Id transacción", fecha_operacion: "Fecha", contraparte_id: "Cliente",
  moneda_origen: "Moneda origen", moneda_destino: "Moneda destino", modalidad: "Modalidad", tipo: "Tipo", tercero: "Tercero",
  descuento_tasa: "Descuento", observaciones: "Observaciones", desbloqueo_motivo: "Motivo de desbloqueo", anulado_motivo: "Motivo de anulación",
};

/** Detalle de un movimiento: corrección del borrador, verificación/desbloqueo (STW-24) e historial auditado. */
export default async function PaginaMovimiento({ params }: PageProps<"/movimientos/[id]">) {
  const sesion = await exigirPermiso("VER_MOVIMIENTOS");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from("movimiento")
    .select(COLUMNAS + ", verificado_por, desbloqueo_motivo, desbloqueado_en, anulado_motivo, anulado_en, creado_por, actualizado_en, recibido_en(nombre), empresa(nombre), monto_efectivo, entrada, salida, saldo_anterior, tasa_cliente_id, secuencia_bucket, aprobacion_error_en, rechazado_en, corregido_motivo, corregido_en")
    .eq("id", id).maybeSingle();
  if (!data) notFound();
  const m = data as unknown as Detalle;

  const [puede, dup, historial, utilidadR] = await Promise.all([
    supabase.rpc("puede_registrar_en_libro", { p_libro: m.libro_id }),
    parecidos(supabase, [m.id]),
    sesion.permisos.has("VER_AUDITORIA")
      ? supabase.from("auditoria").select("id, accion, en, usuario_id, antes, despues").eq("tabla", "movimiento").eq("registro_id", m.id).order("en")
      : Promise.resolve({ data: null }),
    // RLS: solo la administración la ve; para los demás llega vacía
    m.aprobado_en ? supabase.from("movimiento_utilidad").select("*").eq("movimiento_id", m.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const ut = utilidadR.data as Utilidad | null;
  const editable = m.estado === "BORRADOR" && puede.data === true;
  const puedeVerificar = sesion.permisos.has("VERIFICAR_MOVIMIENTO");
  const puedeCorregir = m.estado === "APROBADO" && sesion.permisos.has("CORREGIR_MOVIMIENTO");
  const cat = editable || puedeCorregir ? await catalogos(supabase) : null;
  const otros = dup.get(m.id);
  const { fecha, hora } = partesBogota(m.fecha_operacion);
  const cambios = (historial.data ?? []) as Cambio[];

  const dato = (k: string, v: React.ReactNode) => (
    <div className="min-w-0"><dt className="text-xs font-medium text-tenue">{k}</dt><dd className="mt-0.5 break-words">{v || "—"}</dd></div>
  );

  return (
    <div className="space-y-5">
      <Encabezado
        migas={[{ href: "/movimientos", etiqueta: "Movimientos" }]}
        titulo={m.codigo}
        detalle={<>{m.libro?.nombre} · registrado el {fechaHora(m.creado_en)}</>}
        acciones={<EstadoMovimiento estado={m.estado} />}
      />

      {otros && m.estado !== "ANULADO" && (
        <Aviso>⚠ Se parece a {otros.join(", ")} (mismo cliente, moneda, tipo, monto y día).{m.duplicado_confirmado && " Quien lo registró confirmó que es distinto."}</Aviso>
      )}
      {m.estado === "ANULADO" && (
        <Aviso tono="neutro">
          Anulado el {fechaHora(m.anulado_en!)}: {m.anulado_motivo}.
          {m.aprobado_en && <> Ya no cuenta en el saldo: los movimientos posteriores de {m.contraparte_id} se recalcularon en ese momento.</>}
        </Aviso>
      )}
      {m.corregido_en && m.estado === "APROBADO" && (
        <Aviso tono="info">Corregido el {fechaHora(m.corregido_en)}: {m.corregido_motivo}. Los saldos se recalcularon en ese momento.</Aviso>
      )}
      {m.estado === "RECHAZADO" && <Aviso tono="peligro">Rechazado{m.rechazado_en ? ` el ${fechaHora(m.rechazado_en)}` : ""}: {m.rechazado_motivo}</Aviso>}
      {m.estado === "BORRADOR" && m.desbloqueo_motivo && m.desbloqueado_en && (
        <Aviso tono="info">Desbloqueado el {fechaHora(m.desbloqueado_en)} para corregir: {m.desbloqueo_motivo}</Aviso>
      )}

      <Tarjeta titulo="Datos">
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {dato("Tipo", <Insignia tono={m.tipo === "ENTRADA" ? "exito" : "peligro"}>{m.tipo === "ENTRADA" ? "Entrada" : "Salida"}</Insignia>)}
          {dato("Monto", <span className="text-lg font-semibold tabular-nums">{dinero(m.monto_origen)} {m.moneda_origen} → {m.moneda_destino}</span>)}
          {dato("Fecha de la operación", fechaHora(m.fecha_operacion))}
          {dato("Id de transacción", <span className="font-mono">{m.id_transaccion}</span>)}
          {dato("Cliente o aliado", `${m.contraparte?.nombre ?? ""} · ${m.contraparte_id}`)}
          {dato("Tercero", m.tercero)}
          {dato("Modalidad", m.modalidad)}
          {dato("Descuento ×0,95", m.descuento_tasa ? "Sí" : "No")}
          {dato("Recibido en", m.recibido_en?.nombre ?? m.recibido_en_id)}
          {dato("Empresa", m.empresa?.nombre ?? m.empresa_id)}
          {dato("Verificado", m.verificado_en ? fechaHora(m.verificado_en) : "")}
          {dato("Observaciones", m.observaciones)}
        </dl>
        {!m.aprobado_en && <p className="mt-4 text-xs text-tenue">La tasa, el monto en {m.moneda_destino} y el saldo se calculan al aprobar.</p>}
      </Tarjeta>

      {m.estado === "VERIFICADO" && m.aprobacion_error && (
        <Aviso tono="peligro">No se pudo aprobar{m.aprobacion_error_en ? ` (${fechaHora(m.aprobacion_error_en)})` : ""}: {m.aprobacion_error}</Aviso>
      )}

      {m.aprobado_en && (
        <Tarjeta titulo={m.estado === "APROBADO" ? "Resultado de la aprobación" : "Resultado de la aprobación (anulado: ya no cuenta)"} acciones={m.aprobado_en && <span className="text-xs text-tenue">Aprobado el {fechaHora(m.aprobado_en)}</span>}>
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {dato("Tasa aplicada", <span className="text-lg font-semibold tabular-nums">{tasa(m.tasa_aplicada)}</span>)}
            {dato(`Monto ${m.moneda_destino}`, <span className="text-lg font-semibold tabular-nums">{dinero(m.monto_destino)}</span>)}
            {dato(m.tipo === "ENTRADA" ? "Entrada" : "Salida", <span className="tabular-nums">{dinero(m.tipo === "ENTRADA" ? m.entrada : m.salida)}</span>)}
            {dato("Saldo del cliente", <span className="tabular-nums">{dinero(m.saldo_anterior)} → <strong>{dinero(m.saldo_post)}</strong></span>)}
            {Number(m.monto_efectivo) !== Number(m.monto_origen) && dato("Monto efectivo (descuento fijo)", <span className="tabular-nums">{dinero(m.monto_efectivo)} {m.moneda_origen}</span>)}
            {dato("Tasa usada", m.tasa_cliente_id)}
            {dato("Período", m.periodo_id)}
            {dato("Posición en el saldo", m.secuencia_bucket ? `#${m.secuencia_bucket} de ${m.contraparte_id} · ${m.moneda_destino} · ${m.modalidad.toLowerCase()}` : "")}
          </dl>
          {ut && (
            <div className="mt-4 rounded-lg border border-borde bg-superficie-2 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-tenue">Solo administración</p>
              <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                {dato("Utilidad", <span className={`text-lg font-semibold tabular-nums ${Number(ut.utilidad) < 0 ? "text-peligro" : "text-exito"}`}>{dinero(ut.utilidad)}</span>)}
                {dato("Tasa de adquisición", <span className="tabular-nums">{tasa(ut.tasa_adquisicion)}</span>)}
                {dato("Puntos de utilidad", `${tasa(ut.puntos_utilidad)}${ut.tasa_utilidad_id ? ` (${ut.tasa_utilidad_id})` : ""}`)}
                {dato("Beneficio del cliente", `${tasa(ut.beneficio)}${ut.ajuste_id ? ` (${ut.ajuste_id})` : " (sin beneficio)"}`)}
              </dl>
              {ut.marca_utilidad ? (
                <p className="mt-3 text-xs"><Insignia tono="aviso">{ut.marca_utilidad}{ut.puntos_restados ? ` −${tasa(ut.puntos_restados)}` : ""}</Insignia> {ut.motivo_ajuste}</p>
              ) : sesion.permisos.has("AJUSTAR_UTILIDAD") && m.estado === "APROBADO" && (
                <p className="mt-3 text-xs"><Link href={`/admin/utilidad?q=${m.codigo}`} className="text-primario hover:underline">Ajustar utilidad →</Link></p>
              )}
            </div>
          )}
        </Tarjeta>
      )}

      {(puedeVerificar && ["BORRADOR", "ENVIADO_OPERADOR", "VERIFICADO"].includes(m.estado)) && (
        <Tarjeta titulo="Verificación">
          <Formulario accion={accionLote} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="ids" value={m.id} />
            {m.estado === "VERIFICADO" ? (
              <>
                <label className={etiqueta}>Motivo del desbloqueo
                  <input name="motivo" required minLength={3} placeholder="Qué hay que corregir" className={`${campo} w-72`} />
                </label>
                <button name="op" value="desbloquear" className={botonSuave}>Desbloquear para corregir</button>
              </>
            ) : (
              <button name="op" value="verificar" className={boton}>Verificar (bloquea la edición)</button>
            )}
          </Formulario>
        </Tarjeta>
      )}

      {sesion.permisos.has("RECHAZAR_MOVIMIENTO") && ["BORRADOR", "ENVIADO_OPERADOR", "VERIFICADO"].includes(m.estado)
        && (sesion.permisos.has("APROBAR_MOVIMIENTO") || m.libro?.tipo === "cliente_grande") && (
        <Tarjeta titulo="Rechazar">
          <Formulario accion={accionLote} className="flex flex-wrap items-end gap-2" confirmar={`¿Rechazar ${m.codigo}? El operador y el cliente verán el motivo.`}>
            <input type="hidden" name="ids" value={m.id} />
            <label className={etiqueta}>Motivo (lo verán el operador y el cliente)
              <input name="motivo" required minLength={3} placeholder="Comprobante ilegible, monto no coincide…" className={`${campo} w-80`} />
            </label>
            <button name="op" value="rechazar" className={botonPeligro}>Rechazar</button>
          </Formulario>
        </Tarjeta>
      )}

      {puedeCorregir && cat && (
        <Tarjeta titulo="Corregir (recalcula tasa, monto y saldos)">
          <p className="mb-3 text-sm text-tenue">Cambie solo lo que está mal. Se busca la tasa vigente para la fecha y hora nuevas y se recalculan los saldos del cliente en el momento. Un ajuste manual de utilidad se conserva.</p>
          <FormularioCorreccion
            id={m.id} codigo={m.codigo} fecha={fecha} hora={hora} modalidad={m.modalidad} moneda_origen={m.moneda_origen}
            moneda_destino={m.moneda_destino} monto_origen={String(Number(m.monto_origen))} contraparte_id={m.contraparte_id}
            monedas={cat.monedas} contrapartes={cat.contrapartes} clienteFijo={m.libro?.tipo === "cliente_grande"}
          />
        </Tarjeta>
      )}

      {sesion.permisos.has("ANULAR_MOVIMIENTO") && m.estado === "APROBADO" && (
        <Tarjeta titulo="Anular movimiento aprobado">
          <p className="mb-3 text-sm text-tenue">
            No se borra: queda ANULADO con el motivo y deja de contar. Los saldos posteriores de {m.contraparte_id} en {m.moneda_destino} ·{" "}
            {m.modalidad.toLowerCase()} se recalculan en el momento.
          </p>
          <Formulario accion={anularMovimiento} className="flex flex-wrap items-end gap-3" confirmar={`¿Anular ${m.codigo}? Se recalcula el saldo del cliente.`}>
            <input type="hidden" name="id" value={m.id} />
            <label className={etiqueta}>Motivo
              <input name="motivo" required minLength={3} placeholder="Registrado dos veces, monto errado…" className={`${campo} w-80`} />
            </label>
            <label className="flex items-center gap-2 pb-2 text-sm" title="P-33: solo si el sistema avisa que el saldo queda negativo">
              <input type="checkbox" name="confirmar_negativo" className="size-4" /> Confirmo aunque el saldo quede negativo
            </label>
            <button className={botonPeligro}>Anular</button>
          </Formulario>
        </Tarjeta>
      )}

      {editable && cat && (
        <Tarjeta titulo="Corregir borrador">
          <FormularioMovimiento
            libros={cat.libros.filter((l) => l.id === m.libro_id)}
            monedas={cat.monedas} recibidos={cat.recibidos} empresas={cat.empresas} contrapartes={cat.contrapartes}
            puedeDescuento={sesion.permisos.has("APLICAR_DESCUENTO")}
            hoy={partesBogota(new Date((await ahoraMs())).toISOString()).fecha}
            valores={{
              id: m.id, libro_id: m.libro_id, id_transaccion: m.id_transaccion, tipo: m.tipo, fecha, hora, modalidad: m.modalidad,
              contraparte_id: m.contraparte_id, moneda_origen: m.moneda_origen, moneda_destino: m.moneda_destino,
              monto_origen: String(m.monto_origen).replace(".", ","), recibido_en_id: m.recibido_en_id ?? "", empresa_id: m.empresa_id ?? "",
              tercero: m.tercero ?? "", observaciones: m.observaciones ?? "", descuento_tasa: m.descuento_tasa,
            }}
          />
          <details className="mt-6 border-t border-borde pt-4">
            <summary className="cursor-pointer text-sm font-medium text-peligro">Anular este borrador</summary>
            <Formulario accion={anularBorrador} className="mt-3 flex flex-wrap items-end gap-2" confirmar={`¿Anular ${m.codigo}? Queda en el historial y no se puede deshacer.`}>
              <input type="hidden" name="id" value={m.id} />
              <label className={etiqueta}>Motivo
                <input name="motivo" required minLength={3} placeholder="Registrado por error, duplicado…" className={`${campo} w-72`} />
              </label>
              <button className={botonPeligro}>Anular</button>
            </Formulario>
          </details>
        </Tarjeta>
      )}

      {cambios.length > 0 && (
        <Tarjeta titulo="Historial (auditoría)">
          <ol className="space-y-3 border-l border-borde pl-4 text-sm">
            {cambios.map((c) => {
              const dif = c.accion === "UPDATE" && c.antes && c.despues
                ? Object.keys(CAMPOS_HISTORIAL).filter((k) => JSON.stringify(c.antes![k]) !== JSON.stringify(c.despues![k]))
                : [];
              return (
                <li key={c.id} className="relative">
                  <span aria-hidden className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-primario" />
                  <p className="text-xs text-tenue">{fechaHora(c.en)}{c.usuario_id === sesion.id && " · usted"}</p>
                  <p>{c.accion === "INSERT" ? "Registrado" : dif.length ? dif.map((k) => (
                    <span key={k} className="mr-3 inline-block">{CAMPOS_HISTORIAL[k]}: <s className="text-tenue">{String(c.antes![k] ?? "—")}</s> → <strong>{String(c.despues![k] ?? "—")}</strong></span>
                  )) : "Cambio interno"}</p>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-xs"><Link href="/admin/auditoria" className="text-primario hover:underline">Ver auditoría completa</Link></p>
        </Tarjeta>
      )}
    </div>
  );
}
