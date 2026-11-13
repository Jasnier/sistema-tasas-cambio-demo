import { boton, botonPeligro, campo, etiqueta } from "@/components/estilos";
import { Encabezado, Tarjeta, Vacio } from "@/components/ui";
import { exigirPermiso } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { alternarPermisoRol, delegarPermiso, retirarPermisoDelegado } from "./actions";

export default async function PaginaRoles() {
  const sesion = await exigirPermiso("GESTIONAR_ROLES");
  const supabase = await crearClienteServidor();
  const [{ data: roles }, { data: permisos }, { data: asignados }, { data: usuarios }, { data: delegados }] =
    await Promise.all([
      supabase.from("rol").select("id, nombre").order("id"),
      supabase.from("permiso").select("codigo, descripcion, solo_superadmin").order("codigo"),
      supabase.from("rol_permiso").select("rol_id, permiso"),
      supabase.from("usuario").select("id, nombre, correo, activo").order("nombre"),
      supabase.from("usuario_permiso").select("usuario_id, permiso, otorgado_en"),
    ]);

  const tiene = new Set((asignados ?? []).map((a) => `${a.rol_id}|${a.permiso}`));
  const nombreUsuario = new Map((usuarios ?? []).map((u) => [u.id, u.nombre]));
  const rolesEditables = (roles ?? []).filter((r) => r.id !== "superadmin");
  const delegables = (permisos ?? []).filter((p) => !p.solo_superadmin || sesion.esSuperadmin);

  return (
    <div className="space-y-6">
      <Encabezado
        titulo="Roles y permisos"
        descripcion="Qué puede hacer cada rol. El superadmin tiene todos los permisos; los marcados con * solo los puede tener el superadmin."
      />

      <Tarjeta titulo="Permisos por rol">
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-borde text-left">
                <th className="px-4 py-2">Permiso</th>
                {rolesEditables.map((r) => <th key={r.id} className="px-2 py-2 text-center whitespace-nowrap">{r.nombre}</th>)}
              </tr>
            </thead>
            <tbody>
              {(permisos ?? []).map((p) => (
                <tr key={p.codigo} className="border-b border-borde/70">
                  <td className="px-4 py-2">
                    <span className="font-mono text-xs">{p.codigo}{p.solo_superadmin ? " *" : ""}</span>
                    <div className="text-xs text-tenue">{p.descripcion}</div>
                  </td>
                  {rolesEditables.map((r) => {
                    const activo = tiene.has(`${r.id}|${p.codigo}`);
                    return (
                      <td key={r.id} className="px-2 py-2 text-center">
                        {p.solo_superadmin ? <span className="text-tenue/60" title="Solo superadmin">—</span> : (
                          <form action={alternarPermisoRol}>
                            <input type="hidden" name="rol" value={r.id} />
                            <input type="hidden" name="permiso" value={p.codigo} />
                            <input type="hidden" name="activo" value={activo ? "1" : "0"} />
                            <button aria-label={`${activo ? "Quitar" : "Dar"} ${p.codigo} a ${r.nombre}`} aria-pressed={activo}
                              className={`h-6 w-6 rounded border text-xs font-semibold transition-colors ${activo
                                ? "border-exito bg-exito text-primario-texto hover:opacity-90"
                                : "border-borde-fuerte bg-superficie hover:bg-superficie-2"}`}>
                              {activo ? "✓" : ""}
                            </button>
                          </form>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      <Tarjeta titulo="Permisos cedidos a personas" className="max-w-3xl">
        <form action={delegarPermiso} className="flex flex-wrap items-end gap-3">
          <label className={etiqueta}>Persona
            <select name="usuario" required className={campo}>
              {(usuarios ?? []).filter((u) => u.activo).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </label>
          <label className={etiqueta}>Permiso
            <select name="permiso" required className={campo}>
              {delegables.map((p) => <option key={p.codigo} value={p.codigo}>{p.codigo}</option>)}
            </select>
          </label>
          <button className={boton}>Ceder</button>
        </form>
        <div className="mt-4">
          {(delegados ?? []).length === 0 ? <Vacio>Ninguno.</Vacio> : (
            <ul className="divide-y divide-borde/70 text-sm">
              {(delegados ?? []).map((d) => (
                <li key={`${d.usuario_id}|${d.permiso}`} className="flex flex-wrap items-center gap-3 py-2">
                  <span>{nombreUsuario.get(d.usuario_id) ?? d.usuario_id}</span>
                  <span className="font-mono text-xs">{d.permiso}</span>
                  <form action={retirarPermisoDelegado} className="ml-auto">
                    <input type="hidden" name="usuario" value={d.usuario_id} />
                    <input type="hidden" name="permiso" value={d.permiso} />
                    <button className={botonPeligro}>Retirar</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Tarjeta>
    </div>
  );
}
