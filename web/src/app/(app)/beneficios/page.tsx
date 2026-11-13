import { Formulario } from "@/components/Formulario";
import { boton, botonSuave, campo } from "@/components/estilos";
import { ahoraMs, leerRango, mostrarFecha, vigenteEn } from "@/lib/fechas";
import { exigirPermiso } from "@/lib/sesion";
import { sinErrores } from "@/lib/supabase/datos";
import { crearClienteServidor } from "@/lib/supabase/server";
import { cambiarBeneficio, terminarBeneficio } from "./actions";
import { Encabezado } from "@/components/ui";

type Ajuste = { id: string; contraparte_id: string; moneda_origen: string; moneda_destino: string;
  beneficio: number; activo: boolean; vigencia: string };

export default async function PaginaBeneficios() {
  await exigirPermiso("GESTIONAR_CATALOGOS");
  const supabase = await crearClienteServidor();
  const [{ data: ajustes }, { data: clientes }, { data: monedas }] = sinErrores(await Promise.all([
    supabase.from("ajuste_cliente").select("*").order("contraparte_id").order("vigencia", { ascending: false }),
    supabase.from("contraparte").select("id, nombre").eq("activo", true).order("id"),
    supabase.from("moneda").select("nombre").eq("activo", true).order("orden"),
  ]));
  const nombre = new Map((clientes ?? []).map((c) => [c.id, c.nombre]));
  const ahora = (await ahoraMs());

  return (
    <div className="space-y-6">
      <Encabezado
        titulo="Beneficios por cliente"
        descripcion="Pesos extra por unidad que se suman a la tasa del cliente (y bajan la utilidad). Cambiar un beneficio crea uno nuevo desde la fecha que indique; lo ya aprobado no cambia."
      />

      <section className="space-y-3 rounded-xl border border-borde bg-superficie p-4 shadow-sm">
        <h2 className="font-semibold">Asignar o cambiar beneficio</h2>
        <Formulario accion={cambiarBeneficio} limpiar className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col">Cliente
            <select name="contraparte" required className={campo}>
              {(clientes ?? []).map((c) => <option key={c.id} value={c.id}>{c.id} · {c.nombre}</option>)}
            </select>
          </label>
          <label className="flex flex-col">Origen
            <select name="moneda_origen" required className={campo}>{(monedas ?? []).map((m) => <option key={m.nombre}>{m.nombre}</option>)}</select>
          </label>
          <label className="flex flex-col">Destino
            <select name="moneda_destino" required className={campo} defaultValue="COP">{(monedas ?? []).map((m) => <option key={m.nombre}>{m.nombre}</option>)}</select>
          </label>
          <label className="flex flex-col">Beneficio<input name="beneficio" required inputMode="decimal" className={`${campo} w-24`} /></label>
          <label className="flex flex-col">Desde (vacío = ahora)<input type="datetime-local" name="desde" className={campo} /></label>
          <button className={boton}>Guardar</button>
        </Formulario>
      </section>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-borde text-left">
              <th className="px-2 py-2">ID</th><th className="px-2 py-2">Cliente</th><th className="px-2 py-2">Par</th>
              <th className="px-2 py-2 text-right">Beneficio</th><th className="px-2 py-2">Vigencia</th><th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {((ajustes ?? []) as Ajuste[]).map((a) => {
              const { desde, hasta } = leerRango(a.vigencia);
              const vigente = a.activo && vigenteEn(desde, hasta, ahora);
              return (
                <tr key={a.id} className={`border-b border-borde/70 ${vigente ? "" : "text-tenue"}`}>
                  <td className="px-2 py-1 font-mono text-xs">{a.id}</td>
                  <td className="px-2 py-1">{`${a.contraparte_id} · ${nombre.get(a.contraparte_id) ?? ""}`}</td>
                  <td className="px-2 py-1">{`${a.moneda_origen} → ${a.moneda_destino}`}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{Number(a.beneficio).toLocaleString("es-CO")}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{mostrarFecha(desde)} — {mostrarFecha(hasta)}{vigente ? " · vigente" : ""}</td>
                  <td className="px-2 py-1">
                    {vigente && (
                      <Formulario accion={terminarBeneficio} confirmar={`¿Terminar el beneficio ${a.id}? Deja de aplicar desde ahora.`}>
                        <input type="hidden" name="id" value={a.id} />
                        <button className={botonSuave}>Terminar</button>
                      </Formulario>
                    )}
                  </td>
                </tr>
              );
            })}
            {(ajustes ?? []).length === 0 && <tr><td colSpan={6} className="px-2 py-4 text-tenue">Sin beneficios.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
