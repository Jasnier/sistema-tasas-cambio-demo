import Link from "next/link";
import { Formulario } from "@/components/Formulario";
import { boton, botonSuave, campo } from "@/components/estilos";
import { Encabezado, Insignia, Tarjeta, Vacio, dinero } from "@/components/ui";
import { ahoraMs } from "@/lib/fechas";
import { exigirPermiso } from "@/lib/sesion";
import { sinError } from "@/lib/supabase/datos";
import { crearClienteServidor } from "@/lib/supabase/server";
import { fechaHora, partesBogota } from "../../movimientos/datos";
import { cerrar, reabrir } from "./actions";

type Periodo = { id: string; inicio: string; fin: string; estado: string; cerrado_en: string | null; utilidad_total: number | null;
  total_movimientos: number | null; reabierto_motivo: string | null; aprobados: number; utilidad_actual: number };

/** STW-37: períodos (se crean solos al aprobar, P-34). Cerrar es manual (CERRAR_PERIODO); reabrir, solo superadmin. */
export default async function PaginaPeriodos() {
  const sesion = await exigirPermiso("CERRAR_PERIODO");
  const supabase = await crearClienteServidor();
  const { data } = sinError(await supabase.from("periodo_resumen").select("*").order("id", { ascending: false }).limit(60));
  const periodos = (data ?? []) as Periodo[];
  const hoy = partesBogota(new Date((await ahoraMs())).toISOString()).fecha;

  return (
    <div className="space-y-5">
      <Encabezado titulo="Períodos"
        descripcion="Cada mes es un período y se crea solo con la primera aprobación del mes. Al cerrarlo, la utilidad queda fija y lo que se apruebe después con fecha de ese mes pasa al siguiente período abierto. Solo se pueden cerrar meses que ya terminaron." />
      <Tarjeta>
        {periodos.length === 0 ? <Vacio>Todavía no hay períodos: se crean al aprobar.</Vacio> : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-borde text-left">
                <th className="px-4 py-2">Período</th><th className="px-2 py-2">Estado</th><th className="px-2 py-2 text-right">Aprobados</th>
                <th className="px-2 py-2 text-right">Utilidad</th><th className="px-2 py-2">Cierre</th><th className="px-2 py-2"></th>
              </tr></thead>
              <tbody>
                {periodos.map((p) => {
                  const terminado = p.fin < hoy;
                  return (
                    <tr key={p.id} className="border-b border-borde/70 align-top">
                      <td className="px-4 py-2 font-semibold">{p.id}<span className="block text-xs font-normal text-tenue">{p.inicio} a {p.fin}</span></td>
                      <td className="px-2 py-2">
                        <Insignia tono={p.estado === "CERRADO" ? "neutro" : "exito"}>{p.estado === "CERRADO" ? "Cerrado" : "Abierto"}</Insignia>
                        {p.reabierto_motivo && <span className="block text-xs text-tenue">reabierto: {p.reabierto_motivo}</span>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{p.aprobados}</td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {dinero(p.estado === "CERRADO" && p.utilidad_total != null ? p.utilidad_total : p.utilidad_actual)}
                        {p.estado === "CERRADO" && p.utilidad_total != null && Number(p.utilidad_total) !== Number(p.utilidad_actual) && (
                          <span className="block text-xs text-aviso" title="Hubo ajustes con permiso después del cierre">hoy {dinero(p.utilidad_actual)}</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-xs text-tenue">{p.cerrado_en ? fechaHora(p.cerrado_en) : ""}</td>
                      <td className="px-2 py-2">
                        {p.estado === "ABIERTO" ? (
                          terminado ? (
                            <Formulario accion={cerrar} confirmar={`¿Cerrar ${p.id}? Lo que se apruebe después con fecha de ese mes irá al siguiente período.`}>
                              <input type="hidden" name="id" value={p.id} /><button className={boton}>Cerrar período</button>
                            </Formulario>
                          ) : <span className="text-xs text-tenue">en curso</span>
                        ) : sesion.esSuperadmin && (
                          <details>
                            <summary className="cursor-pointer text-xs text-primario">Reabrir</summary>
                            <Formulario accion={reabrir} className="mt-2 flex items-end gap-2" confirmar={`¿Reabrir ${p.id}?`}>
                              <input type="hidden" name="id" value={p.id} />
                              <input name="motivo" required minLength={3} placeholder="Motivo" aria-label={`Motivo para reabrir ${p.id}`} className={`${campo} w-48`} />
                              <button className={botonSuave}>Reabrir</button>
                            </Formulario>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>
      <p className="text-xs text-tenue">Ver el detalle por cliente en <Link href="/finanzas/resumen-operativo" className="text-primario hover:underline">Resumen operativo</Link>.</p>
    </div>
  );
}
