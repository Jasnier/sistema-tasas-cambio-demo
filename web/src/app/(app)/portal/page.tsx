import Link from "next/link";
import { EnVivo } from "@/components/EnVivo";
import { boton } from "@/components/estilos";
import { Aviso, Cifra, Encabezado, EstadoMovimiento, Tarjeta, Vacio, dinero } from "@/components/ui";
import { exigirPermiso } from "@/lib/sesion";
import { sinError, sinErrores } from "@/lib/supabase/datos";
import { crearClienteServidor } from "@/lib/supabase/server";
import { fechaHora, tasa } from "../movimientos/datos";
import { estadoDeCuenta } from "../estado-cuenta/datos";
import { Paginacion } from "@/components/Paginacion";
import { POR_PAGINA, cortar } from "@/lib/paginacion";

type Libro = { id: string; nombre: string; prefijo: string; contraparte_id: string | null; usa_ganancias: boolean; operador_id: string | null };
type Mov = { id: string; codigo: string; fecha_operacion: string; tipo: string; moneda_origen: string; moneda_destino: string; monto_origen: number;
  estado: string; rechazado_motivo: string | null; monto_destino: number | null; tasa_aplicada: number | null };

/**
 * STW-41: portal del cliente grande. Solo registra y consulta (no envía nada: lo envía su operador, STW-42). Ve solo lo
 * suyo (RLS): su saldo global resumido por moneda y modalidad (P-2) y el detalle que lo compone, el estado de cada registro
 * (P-7: siempre visible) y los rechazos con su motivo.
 */
export default async function PaginaPortal({ searchParams }: PageProps<"/portal">) {
  const sesion = await exigirPermiso("PORTAL_CLIENTE");
  const sp = await searchParams;
  const supabase = await crearClienteServidor();
  const { data: mios } = sinError(await supabase.from("libro_usuario").select("libro:libro(id, nombre, prefijo, contraparte_id, usa_ganancias, operador_id, tipo)").eq("usuario_id", sesion.id));
  const libro = ((mios ?? []).map((r) => r.libro as unknown as Libro & { tipo: string })).find((l) => l?.tipo === "cliente_grande");
  if (!libro) return <Aviso>Su usuario no está asignado a un libro de cliente grande. Pida a la administración que lo asigne.</Aviso>;

  const [saldosR, movsR, operadorR] = sinErrores(await Promise.all([
    libro.contraparte_id ? supabase.from("saldo_bucket").select("moneda, modalidad, saldo, actualizado_en").eq("contraparte_id", libro.contraparte_id).order("moneda") : Promise.resolve({ data: [] }),
    supabase.from("movimiento").select("id, codigo, fecha_operacion, tipo, moneda_origen, moneda_destino, monto_origen, estado, rechazado_motivo, monto_destino, tasa_aplicada")
      .eq("libro_id", libro.id).neq("estado", "ANULADO").order("creado_en", { ascending: false }).limit(200),
    supabase.rpc("nombre_de_mi_operador"),
  ]));
  const saldos = (saldosR.data ?? []) as { moneda: string; modalidad: string; saldo: number; actualizado_en: string }[];
  const movs = (movsR.data ?? []) as Mov[];
  const recientes = movs.slice(0, 15);
  const rechazados = movs.filter((m) => m.estado === "RECHAZADO").slice(0, 10);

  // Estado de cuenta del bucket elegido (por defecto el primero con saldo)
  const elegido = saldos.find((s) => `${s.moneda}|${s.modalidad}` === sp.cuenta) ?? saldos[0];
  const cuenta = elegido && libro.contraparte_id
    ? await estadoDeCuenta(supabase, { ct: libro.contraparte_id, moneda: elegido.moneda, modalidad: elegido.modalidad, desde: "", hasta: "" })
    : null;
  // Un libro mayor: por defecto se abre en la última página (lo más reciente), con el saldo al final
  const totalLineas = cuenta?.lineas.length ?? 0;
  const ultimaPagina = Math.max(1, Math.ceil(totalLineas / POR_PAGINA));
  const pagina = typeof sp.pag === "string" && Number(sp.pag) > 0 ? Math.min(Number.parseInt(sp.pag, 10), ultimaPagina) : ultimaPagina;

  return (
    <div className="space-y-5">
      <Encabezado titulo={`Mi cuenta · ${libro.nombre}`}
        detalle={<>Código {libro.contraparte_id ?? "sin asignar"} · lo atiende {(operadorR.data as string | null) ?? "— (sin operador asignado)"}</>}
        descripcion="Su saldo es el total de su código en el sistema: suma también lo que su operador registró a su nombre (se ve en tono claro y no se puede editar)."
        acciones={<><EnVivo /><Link href="/movimientos/nuevo" className={boton}>+ Registrar movimiento</Link></>} />

      {!libro.operador_id && <Aviso tono="peligro">Su libro no tiene operador asignado: sus registros no avanzan hasta que la administración lo asigne.</Aviso>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {saldos.length === 0 && <Cifra etiqueta="Saldo" valor="0,00" detalle="Aún no tiene movimientos aprobados" />}
        {saldos.map((s) => (
          <Cifra key={`${s.moneda}|${s.modalidad}`} etiqueta={`Saldo ${s.moneda} · ${s.modalidad === "TRANSFERENCIA" ? "transferencia" : "efectivo"}`}
            valor={dinero(s.saldo)} tono={Number(s.saldo) < 0 ? "peligro" : "primario"} href={`/portal?cuenta=${s.moneda}|${s.modalidad}#cuenta`}
            detalle={`Actualizado ${fechaHora(s.actualizado_en)}`} />
        ))}
      </div>

      <Tarjeta titulo="Mis registros recientes" acciones={<Link href="/movimientos" className="text-sm text-primario hover:underline">Ver todos →</Link>}>
        {recientes.length === 0 ? <Vacio>Todavía no ha registrado movimientos.</Vacio> : (
          <ul className="divide-y divide-borde text-sm">
            {recientes.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 py-1.5">
                <Link href={`/movimientos/${m.id}`} className="font-mono text-xs font-semibold text-primario hover:underline">{m.codigo}</Link>
                <span className="text-xs text-tenue">{fechaHora(m.fecha_operacion)}</span>
                <span className="flex-1 tabular-nums">{m.tipo === "SALIDA" ? "−" : "+"}{dinero(m.monto_origen)} {m.moneda_origen}
                  {m.monto_destino != null && <span className="text-tenue"> → {dinero(m.monto_destino)} {m.moneda_destino} @ {tasa(m.tasa_aplicada)}</span>}</span>
                <EstadoMovimiento estado={m.estado} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-tenue">Borrador: su operador lo revisa y lo envía. Enviado / verificado: en proceso. Aprobado: ya cuenta en su saldo.</p>
      </Tarjeta>

      {rechazados.length > 0 && (
        <Tarjeta titulo="Rechazados (corríjalos y regístrelos de nuevo)">
          <ul className="divide-y divide-borde text-sm">
            {rechazados.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 py-1.5">
                <Link href={`/movimientos/${m.id}`} className="font-mono text-xs font-semibold text-primario hover:underline">{m.codigo}</Link>
                <span className="tabular-nums">{dinero(m.monto_origen)} {m.moneda_origen}</span>
                <span className="flex-1 text-peligro">{m.rechazado_motivo}</span>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      <section id="cuenta">
        <Tarjeta titulo={cuenta && elegido ? `Estado de cuenta · ${elegido.moneda} · ${elegido.modalidad.toLowerCase()}` : "Estado de cuenta"}
          acciones={libro.usa_ganancias && sesion.permisos.has("VER_GANANCIAS") && <Link href="/ganancias" className="text-sm text-primario hover:underline">Ver mis ganancias →</Link>}>
          {!cuenta || cuenta.lineas.length === 0 ? <Vacio>Todavía no tiene movimientos aprobados.</Vacio> : (
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-borde text-left">
                  <th className="px-4 py-2">Fecha</th><th className="px-2 py-2">Código</th><th className="px-2 py-2 text-right">Monto</th>
                  <th className="px-2 py-2 text-right">Tasa</th><th className="px-2 py-2 text-right">Entrada</th><th className="px-2 py-2 text-right">Salida</th><th className="px-2 py-2 text-right">Saldo</th>
                </tr></thead>
                <tbody>
                  {cortar(cuenta.lineas, pagina).map((l) => (
                    <tr key={l.id} className={`border-b border-borde/70 ${l.es_propio ? "" : "bg-superficie-2/40 text-tenue"}`}
                      title={l.es_propio ? undefined : `Registrado a su código por ${l.libro?.nombre}`}>
                      <td className="px-4 py-1.5 whitespace-nowrap tabular-nums">{fechaHora(l.fecha_operacion)}</td>
                      <td className="px-2 py-1.5 font-mono text-xs">{l.codigo}{!l.es_propio && <span className="block font-sans text-tenue">{l.libro?.nombre}</span>}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{dinero(l.monto_origen)} <span className="text-xs text-tenue">{l.moneda_origen}</span></td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{tasa(l.tasa_aplicada)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-exito">{Number(l.entrada) ? dinero(l.entrada) : ""}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-peligro">{Number(l.salida) ? dinero(l.salida) : ""}</td>
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums">{dinero(l.saldo_post)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {cuenta && <Paginacion ruta="/portal" sp={sp} total={totalLineas} pagina={pagina} className="mt-3" explicita />}
          <p className="mt-3 text-xs text-tenue">El saldo es el global de su código: las filas en tono claro las registró su operador u otro libro a su nombre; cuentan en el saldo pero no las puede editar.</p>
        </Tarjeta>
      </section>
    </div>
  );
}
