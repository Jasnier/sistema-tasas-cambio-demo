import { exigirPermiso } from "@/lib/sesion";
import { sinErrores } from "@/lib/supabase/datos";
import { crearClienteServidor } from "@/lib/supabase/server";
import { Encabezado } from "@/components/ui";
import { Paginacion } from "@/components/Paginacion";
import { leerPagina, rango } from "@/lib/paginacion";

export default async function PaginaAuditoria({ searchParams }: PageProps<"/admin/auditoria">) {
  await exigirPermiso("VER_AUDITORIA");
  const sp = await searchParams;
  const pagina = leerPagina(sp);
  const supabase = await crearClienteServidor();
  // Por páginas: la auditoría crece con cada cambio, solo se trae lo que se ve
  const [{ data: filas, count }, { data: usuarios }] = sinErrores(await Promise.all([
    supabase.from("auditoria").select("id, tabla, registro_id, accion, antes, despues, usuario_id, en", { count: "exact" })
      .order("en", { ascending: false }).order("id", { ascending: false }).range(...rango(pagina)),
    supabase.from("usuario").select("id, nombre"),
  ]));
  const nombre = new Map((usuarios ?? []).map((u) => [u.id, u.nombre]));

  return (
    <div className="space-y-4">
      <Encabezado titulo="Auditoría" descripcion="Todos los cambios hechos en el sistema, del más reciente al más antiguo. Nadie puede editar ni borrar este registro." />
      <Paginacion ruta="/admin/auditoria" sp={sp} total={count ?? 0} pagina={pagina} />
      <div className="overflow-x-auto rounded-lg border border-borde bg-superficie shadow-xs">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-borde text-left">
              <th className="px-2 py-2">Fecha</th><th className="px-2 py-2">Usuario</th>
              <th className="px-2 py-2">Tabla</th><th className="px-2 py-2">Acción</th>
              <th className="px-2 py-2">Registro</th><th className="px-2 py-2">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {(filas ?? []).map((f) => (
              <tr key={f.id} className="border-b border-borde/70 align-top">
                <td className="whitespace-nowrap px-2 py-1">{new Date(f.en).toLocaleString("es-CO", { timeZone: "America/Bogota" })}</td>
                <td className="px-2 py-1">{f.usuario_id ? nombre.get(f.usuario_id) ?? f.usuario_id : "sistema"}</td>
                <td className="px-2 py-1 font-mono text-xs">{f.tabla}</td>
                <td className="px-2 py-1">{f.accion}</td>
                <td className="px-2 py-1 font-mono text-xs">{f.registro_id}</td>
                <td className="px-2 py-1">
                  <details>
                    <summary className="cursor-pointer text-xs text-tenue">ver</summary>
                    <pre className="max-w-xl overflow-x-auto text-xs">{JSON.stringify({ antes: f.antes, despues: f.despues }, null, 2)}</pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Paginacion ruta="/admin/auditoria" sp={sp} total={count ?? 0} pagina={pagina} />
    </div>
  );
}
