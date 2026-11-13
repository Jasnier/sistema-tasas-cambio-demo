import { Formulario } from "@/components/Formulario";
import { boton, botonSuave, campo, etiqueta } from "@/components/estilos";
import { Encabezado, Tarjeta } from "@/components/ui";
import { traerTodo } from "@/lib/paginar";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { crearCliente, guardarCliente } from "./actions";

type Libro = { id: string; nombre: string; prefijo: string; tipo: string; operador_id: string | null; contraparte_id: string | null; usa_ganancias: boolean; usa_retiros: boolean };

/** P-1 / P-25: qué operador atiende a cada cliente grande, su código CT y si tiene ganancias. */
export default async function PaginaClientes() {
  await exigirPermiso("GESTIONAR_CATALOGOS");
  const supabase = await crearClienteServidor();
  const [librosR, { data: cts }] = await Promise.all([
    supabase.from("libro").select("id, nombre, prefijo, tipo, operador_id, contraparte_id, usa_ganancias, usa_retiros").in("tipo", ["operador", "cliente_grande"]).eq("activo", true).order("nombre"),
    traerTodo<{ id: string; nombre: string }>((d, h) => supabase.from("contraparte").select("id, nombre").eq("activo", true).order("nombre").order("id").range(d, h)),
  ]);
  const libros = (librosR.data ?? []) as Libro[];
  const operadores = libros.filter((l) => l.tipo === "operador");
  const clientes = libros.filter((l) => l.tipo === "cliente_grande");
  // Un código CT pertenece a un solo cliente grande activo (migración 2000): los ya tomados se muestran deshabilitados
  const dueno = new Map(clientes.filter((c) => c.contraparte_id).map((c) => [c.contraparte_id as string, c]));
  const opcionesCt = (propio: string | null) => cts.map((k) => {
    const otro = dueno.get(k.id);
    const tomado = Boolean(otro && k.id !== propio);
    return <option key={k.id} value={k.id} disabled={tomado}>{k.id} · {k.nombre}{tomado ? ` (ya es de ${otro!.nombre})` : ""}</option>;
  });

  return (
    <div className="space-y-5">
      <Encabezado titulo="Clientes grandes"
        descripcion="Aquí se crean los clientes grandes y se elige a qué cliente van sus movimientos, qué operador los atiende y si usan ganancias y retiros. El cliente no escoge su código: su formulario ya lo trae." />
      <Tarjeta titulo="Nuevo cliente grande">
        <Formulario accion={crearCliente} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className={`${etiqueta} lg:col-span-2`}>Nombre<input name="nombre" required maxLength={80} placeholder="Ej. Turismo JG" className={campo} /></label>
          <label className={etiqueta}>Prefijo<input name="prefijo" required maxLength={5} pattern="[A-Za-z]{2,5}" placeholder="TJG" className={`${campo} font-mono uppercase`} /></label>
          <label className={`${etiqueta} lg:col-span-3`}>Código CT (a qué cliente van sus movimientos)
            <select name="contraparte_id" required defaultValue="" className={campo}>
              <option value="" disabled>Elija…</option>{opcionesCt(null)}
            </select>
          </label>
          <label className={`${etiqueta} lg:col-span-2`}>Operador que lo atiende
            <select name="operador_id" defaultValue="" className={campo}>
              <option value="">— sin operador —</option>{operadores.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap items-end gap-4 lg:col-span-4">
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="usa_ganancias" className="size-4" /> Ganancias</label>
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="usa_retiros" className="size-4" /> Retiros</label>
            <button className={boton}>Crear cliente grande</button>
            <span className="text-xs text-tenue">Después asígnele su usuario de acceso.</span>
          </div>
        </Formulario>
      </Tarjeta>
      <Tarjeta>
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-borde text-left">
              <th className="px-4 py-2">Cliente</th><th className="px-2 py-2">Operador</th><th className="px-2 py-2">Código CT</th><th className="px-2 py-2">Módulos</th><th className="px-2 py-2"></th>
            </tr></thead>
            <tbody>
              {clientes.map((c) => (
                <tr key={c.id} className="border-b border-borde/70">
                  <td className="px-4 py-2">{c.nombre}<span className="block text-xs text-tenue">prefijo {c.prefijo}</span></td>
                  <td className="px-2 py-2" colSpan={4}>
                    <Formulario accion={guardarCliente} className="flex flex-wrap items-center gap-3">
                      <input type="hidden" name="id" value={c.id} />
                      <select name="operador_id" defaultValue={c.operador_id ?? ""} aria-label={`Operador de ${c.nombre}`} className={`${campo} w-40`}>
                        <option value="">— sin operador —</option>{operadores.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                      </select>
                      <select name="contraparte_id" defaultValue={c.contraparte_id ?? ""} aria-label={`Código de ${c.nombre}`} className={`${campo} w-56`}>
                        <option value="">— sin código —</option>{opcionesCt(c.contraparte_id)}
                      </select>
                      <label className="flex items-center gap-1.5"><input type="checkbox" name="usa_ganancias" defaultChecked={c.usa_ganancias} className="size-4" /> Ganancias</label>
                      <label className="flex items-center gap-1.5"><input type="checkbox" name="usa_retiros" defaultChecked={c.usa_retiros} className="size-4" /> Retiros</label>
                      <button className={botonSuave}>Guardar</button>
                    </Formulario>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>
    </div>
  );
}
