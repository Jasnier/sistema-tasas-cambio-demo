import Link from "next/link";
import { Formulario } from "@/components/Formulario";
import { boton, botonSuave, campo, chip } from "@/components/estilos";
import { exigirPermiso } from "@/lib/sesion";
import { sinErrores } from "@/lib/supabase/datos";
import { crearClienteServidor } from "@/lib/supabase/server";
import { alternarActivo, crearItem, editarItem } from "./actions";
import { CATALOGOS, catalogoPorTabla } from "./config";
import { Encabezado } from "@/components/ui";
import { Paginacion } from "@/components/Paginacion";
import { cortar, leerPagina } from "@/lib/paginacion";

type Fila = { id: string; nombre: string; activo: boolean; orden?: number | null; tipo?: string;
  descuento_fijo?: number; descuento_moneda?: string | null };

export default async function PaginaCatalogos({ searchParams }: PageProps<"/catalogos">) {
  await exigirPermiso("GESTIONAR_CATALOGOS");
  const sp = await searchParams;
  const pagina = leerPagina(sp);   // la tabla se pinta por páginas; los totales suman todo
  const { t } = sp;
  const cat = catalogoPorTabla(typeof t === "string" ? t : undefined);
  const supabase = await crearClienteServidor();
  const [{ data }, { data: monedas }, { data: siguiente }] = sinErrores(await Promise.all([
    supabase.from(cat.tabla).select("*").order(cat.conOrden ? "orden" : "id", { nullsFirst: false }),
    cat.conDescuento ? supabase.from("moneda").select("nombre").eq("activo", true).order("orden") : Promise.resolve({ data: [] }),
    supabase.rpc("siguiente_codigo_catalogo", { p_tabla: cat.tabla }),
  ]));
  const ayudaCodigo = siguiente ? `Automático (${siguiente})` : "Automático (del nombre)";
  const filas = (data ?? []) as Fila[];
  const nombresMoneda = (monedas ?? []).map((m: { nombre: string }) => m.nombre);

  const camposExtra = (f?: Fila) => (
    <>
      {cat.conOrden && (
        <input name="orden" defaultValue={f?.orden ?? ""} placeholder="Orden" inputMode="numeric" className={`${campo} w-20`} aria-label="Orden" />
      )}
      {cat.conTipo && (
        <select name="tipo" defaultValue={f?.tipo ?? "CLIENTE"} className={campo} aria-label="Tipo">
          <option>CLIENTE</option><option>ALIADO</option>
        </select>
      )}
      {cat.conDescuento && (
        <>
          <input name="descuento_fijo" defaultValue={f?.descuento_fijo ?? ""} placeholder="Descuento fijo" inputMode="decimal" className={`${campo} w-28`} aria-label="Descuento fijo" />
          <select name="descuento_moneda" defaultValue={f?.descuento_moneda ?? ""} className={campo} aria-label="Moneda del descuento">
            <option value="">cualquier moneda</option>
            {nombresMoneda.map((m) => <option key={m}>{m}</option>)}
          </select>
        </>
      )}
    </>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Encabezado titulo="Catálogos" />
        <nav className="flex flex-wrap gap-2 text-sm">
          {CATALOGOS.map((c) => (
            <Link key={c.tabla} href={`/catalogos?t=${c.tabla}`}
              className={chip(c.tabla === cat.tabla)}>
              {c.titulo}
            </Link>
          ))}
        </nav>
      </div>

      <section className="space-y-3 rounded-xl border border-borde bg-superficie p-4 shadow-sm">
        <h2 className="font-semibold">{cat.titulo}</h2>
        <p className="text-sm text-tenue">{cat.ayuda} Los textos se guardan en mayúsculas. Nada se borra: se desactiva.</p>
        <Formulario accion={crearItem} limpiar className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="tabla" value={cat.tabla} />
          <input name="id" placeholder={ayudaCodigo} title="Déjelo vacío y el código se asigna solo. Escríbalo solo si debe coincidir con uno que ya existe en Sheets."
            className={`${campo} w-48`} aria-label="Código (opcional)" />
          <input name="nombre" placeholder="Nombre" required className={`${campo} w-56`} aria-label="Nombre" />
          {camposExtra()}
          <button className={boton}>Agregar</button>
        </Formulario>
      </section>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-borde text-left">
              <th className="px-2 py-2">Código</th><th className="px-2 py-2">Datos</th><th className="px-2 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {cortar(filas, pagina).map((f) => (
              <tr key={f.id} className={`border-b border-borde/70 ${f.activo ? "" : "text-tenue"}`}>
                <td className="px-2 py-1 font-mono text-xs">{f.id}</td>
                <td className="px-2 py-1">
                  <Formulario accion={editarItem} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="tabla" value={cat.tabla} />
                    <input type="hidden" name="id" value={f.id} />
                    <input name="nombre" defaultValue={f.nombre} required className={`${campo} w-56`} aria-label={`Nombre de ${f.id}`} />
                    {camposExtra(f)}
                    <button className={botonSuave}>Guardar</button>
                  </Formulario>
                </td>
                <td className="px-2 py-1">
                  <Formulario accion={alternarActivo}>
                    <input type="hidden" name="tabla" value={cat.tabla} />
                    <input type="hidden" name="id" value={f.id} />
                    <input type="hidden" name="activo" value={f.activo ? "1" : "0"} />
                    <button className={botonSuave}>{f.activo ? "Activo · desactivar" : "Inactivo · activar"}</button>
                  </Formulario>
                </td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={3} className="px-2 py-4 text-tenue">Sin registros.</td></tr>}
          </tbody>
        </table>
      </div>
      <Paginacion ruta="/catalogos" sp={sp} total={filas.length} pagina={pagina} className="mt-3" />
    </div>
  );
}
