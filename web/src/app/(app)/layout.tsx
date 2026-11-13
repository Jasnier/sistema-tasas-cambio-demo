import { Icono } from "@/components/Iconos";
import { Navegacion } from "@/components/Navegacion";
import { obtenerSesion } from "@/lib/sesion";
import { menuPara } from "@/lib/menu";
import { cerrarSesion } from "../login/actions";

// Todas las páginas internas dependen del usuario y de datos de dinero que deben estar siempre al día:
// se renderizan en cada petición (sin shell estático ni caché de datos).
export const instant = false;

export default async function LayoutApp({ children }: LayoutProps<"/">) {
  const sesion = await obtenerSesion();
  const visibles = menuPara(sesion.permisos);

  return (
    <div className="flex min-h-dvh flex-1 flex-col lg:flex-row">
      <Navegacion
        entradas={visibles}
        nombre={sesion.nombre}
        roles={sesion.roles}
        salir={
          <form action={cerrarSesion}>
            <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-medium transition-colors hover:bg-peligro-suave hover:text-peligro">
              <Icono nombre="salir" className="size-4" />Cerrar sesión
            </button>
          </form>
        }
      />
      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl motion-safe:animate-aparecer">{children}</div>
      </main>
    </div>
  );
}
