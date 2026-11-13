import Link from "next/link";
import { Formulario } from "@/components/Formulario";
import { boton, botonSuave, campo, chip } from "@/components/estilos";
import { aInputBogota, ahoraMs, leerRango, mostrarFecha, vigenteEn } from "@/lib/fechas";
import { exigirPermiso } from "@/lib/sesion";
import { sinErrores } from "@/lib/supabase/datos";
import { crearClienteServidor } from "@/lib/supabase/server";
import { borrarBorrador, cambiarHasta, crearTasa, publicarTasa } from "./actions";
import { Encabezado } from "@/components/ui";
import { Paginacion } from "@/components/Paginacion";
import { leerPagina, rango } from "@/lib/paginacion";

type FilaTasa = {
  id: string; moneda_origen: string; moneda_destino: string; modalidad?: string; vigencia: string;
  valor?: number; puntos_efectivo?: number; puntos_transferencia?: number; estado: "MODIFICABLE" | "CERRADO";
};

// Todos los decimales: las tasas inversas (COP→SOL) tienen muchos y redondearlas cambia la conversión
const num = (n?: number) => (n == null ? "" : Number(n).toLocaleString("es-CO", { maximumFractionDigits: 20 }));

export default async function PaginaTasas({ searchParams }: PageProps<"/tasas">) {
  await exigirPermiso("GESTIONAR_TASAS");
  const sp = await searchParams;
  const esUtilidad = sp.t === "utilidad";
  const tabla = esUtilidad ? "tasa_utilidad" : "tasa_cliente";
  const estado = typeof sp.estado === "string" ? sp.estado : "todas";

  const supabase = await crearClienteServidor();
  const pagina = leerPagina(sp);
  let q = supabase.from(tabla).select("*", { count: "exact" }).order("moneda_origen").order("moneda_destino").order("vigencia", { ascending: false }).order("id").range(...rango(pagina));
  if (estado === "borradores") q = q.eq("estado", "MODIFICABLE");
  if (estado === "publicadas") q = q.eq("estado", "CERRADO");
  const [{ data, count }, { data: monedas }] = sinErrores(await Promise.all([
    q, supabase.from("moneda").select("nombre").eq("activo", true).order("orden"),
  ]));
  const filas = (data ?? []) as FilaTasa[];
  const listaMonedas = (monedas ?? []).map((m) => m.nombre as string);
  const ahora = (await ahoraMs());

  const filtro = (clave: string, etiqueta: string) => (
    <Link href={`/tasas?t=${esUtilidad ? "utilidad" : "cliente"}&estado=${clave}`}
      className={`rounded px-2 py-0.5 ${estado === clave ? "bg-superficie-2" : ""}`}>{etiqueta}</Link>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Encabezado titulo="Tasas" />
        <nav className="flex flex-wrap gap-2 text-sm">
          <Link href="/tasas" className={chip(!esUtilidad)}>Tasas cliente</Link>
          <Link href="/tasas?t=utilidad" className={chip(esUtilidad)}>Tabla de utilidad (puntos)</Link>
        </nav>
        <p className="max-w-3xl text-sm text-tenue">
          {esUtilidad
            ? "Margen de la casa en puntos por par de monedas. Solo lo ve la administración."
            : "Tasa base al cliente por par y modalidad. Se elige por la fecha y hora de la operación (P-8)."}
          {" "}Se crea como borrador; al publicarla se valida que no se cruce con otra publicada.
          Una publicada solo permite cambiar su fecha de fin. Horas en hora de Bogotá.
        </p>
      </div>

      <section className="space-y-3 rounded-xl border border-borde bg-superficie p-4 shadow-sm">
        <h2 className="font-semibold">Nuevo borrador</h2>
        <Formulario accion={crearTasa} limpiar className="flex flex-wrap items-end gap-2 text-sm">
          <input type="hidden" name="tabla" value={tabla} />
          <label className="flex flex-col">Origen
            <select name="moneda_origen" required className={campo}>{listaMonedas.map((m) => <option key={m}>{m}</option>)}</select>
          </label>
          <label className="flex flex-col">Destino
            <select name="moneda_destino" required className={campo} defaultValue="COP">{listaMonedas.map((m) => <option key={m}>{m}</option>)}</select>
          </label>
          {!esUtilidad && (
            <label className="flex flex-col">Modalidad
              <select name="modalidad" className={campo}><option>TRANSFERENCIA</option><option>EFECTIVO</option></select>
            </label>
          )}
          <label className="flex flex-col">Desde<input type="datetime-local" name="desde" required className={campo} /></label>
          <label className="flex flex-col">Hasta (vacío = sin fin)<input type="datetime-local" name="hasta" className={campo} /></label>
          {esUtilidad ? (
            <>
              <label className="flex flex-col">Puntos efectivo<input name="puntos_efectivo" required inputMode="decimal" className={`${campo} w-28`} /></label>
              <label className="flex flex-col">Puntos transferencia<input name="puntos_transferencia" required inputMode="decimal" className={`${campo} w-28`} /></label>
            </>
          ) : (
            <label className="flex flex-col">Valor<input name="valor" required inputMode="decimal" className={`${campo} w-28`} /></label>
          )}
          <button className={boton}>Crear borrador</button>
        </Formulario>
        {listaMonedas.length === 0 && <p className="text-sm text-aviso">Primero crea las monedas en Catálogos.</p>}
      </section>

      <section className="space-y-3 rounded-xl border border-borde bg-superficie p-4 shadow-sm">
        <div className="flex gap-2 text-sm">{filtro("todas", "Todas")}{filtro("borradores", "Borradores")}{filtro("publicadas", "Publicadas")}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-borde text-left">
                <th className="px-2 py-2">ID</th><th className="px-2 py-2">Par</th>
                {!esUtilidad && <th className="px-2 py-2">Modalidad</th>}
                <th className="px-2 py-2 text-right">{esUtilidad ? "Efectivo / Transf." : "Valor"}</th>
                <th className="px-2 py-2">Vigencia</th><th className="px-2 py-2">Estado</th><th className="px-2 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const { desde, hasta } = leerRango(f.vigencia);
                const vigenteAhora = f.estado === "CERRADO" && vigenteEn(desde, hasta, ahora);
                return (
                  <tr key={f.id} className="border-b border-borde/70 align-top">
                    <td className="px-2 py-1 font-mono text-xs">{f.id}</td>
                    <td className="px-2 py-1">{`${f.moneda_origen} → ${f.moneda_destino}`}</td>
                    {!esUtilidad && <td className="px-2 py-1">{f.modalidad}</td>}
                    <td className="px-2 py-1 text-right tabular-nums">
                      {esUtilidad ? `${num(f.puntos_efectivo)} / ${num(f.puntos_transferencia)}` : num(f.valor)}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">{mostrarFecha(desde)} — {mostrarFecha(hasta)}</td>
                    <td className="px-2 py-1">
                      {f.estado === "CERRADO" ? (vigenteAhora ? "Publicada · vigente" : "Publicada") : "Borrador"}
                    </td>
                    <td className="px-2 py-1">
                      {f.estado === "MODIFICABLE" ? (
                        <div className="flex flex-wrap gap-2">
                          <Formulario accion={publicarTasa} className="flex items-center gap-2"
                            confirmar={`¿Publicar ${f.id}? Después solo se podrá cambiar su fecha de fin.`}>
                            <input type="hidden" name="tabla" value={tabla} /><input type="hidden" name="id" value={f.id} />
                            <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="recortar" defaultChecked />recortar la anterior</label>
                            <button className={boton}>Publicar</button>
                          </Formulario>
                          <Formulario accion={borrarBorrador} confirmar={`¿Eliminar el borrador ${f.id}?`}>
                            <input type="hidden" name="tabla" value={tabla} /><input type="hidden" name="id" value={f.id} />
                            <button className={`${botonSuave} text-peligro`}>Eliminar</button>
                          </Formulario>
                        </div>
                      ) : (
                        <Formulario accion={cambiarHasta} className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="tabla" value={tabla} /><input type="hidden" name="id" value={f.id} />
                          <input type="datetime-local" name="hasta" defaultValue={aInputBogota(hasta)} className={campo} aria-label={`Nueva fecha fin de ${f.id}`} />
                          <button className={botonSuave}>Cambiar fin</button>
                        </Formulario>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filas.length === 0 && <tr><td colSpan={7} className="px-2 py-4 text-tenue">Sin registros.</td></tr>}
            </tbody>
          </table>
        </div>
        <Paginacion ruta="/tasas" sp={sp} total={count ?? 0} pagina={pagina} className="mt-3" />
      </section>
    </div>
  );
}
