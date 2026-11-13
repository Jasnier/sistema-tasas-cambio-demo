import Link from "next/link";
import { Aviso, Cifra, Encabezado, ESTADO_MOV, Tarjeta } from "@/components/ui";
import { ahoraMs } from "@/lib/fechas";
import { obtenerSesion } from "@/lib/sesion";
import { GRUPOS, GRUPOS_PLEGADOS, menuPara } from "@/lib/menu";
import { boton } from "@/components/estilos";
import { Icono, IconoRuta } from "@/components/Iconos";
import { sinError } from "@/lib/supabase/datos";
import { crearClienteServidor } from "@/lib/supabase/server";

export default async function Inicio({ searchParams }: PageProps<"/">) {
  const sesion = await obtenerSesion();
  const { sin_permiso } = await searchParams;
  const visibles = menuPara(sesion.permisos).filter((m) => m.href !== "/");
  const listos = visibles.filter((m) => !m.sprint);
  const proximos = visibles.filter((m) => m.sprint);

  // Movimientos por estado (solo los de sus libros: RLS)
  let conteo: Record<string, number> = {};
  if (sesion.permisos.has("VER_MOVIMIENTOS")) {
    const supabase = await crearClienteServidor();
    const { data } = sinError(await supabase.from("movimiento_conteo").select("estado, total"));
    conteo = Object.fromEntries((data ?? []).map((r) => [r.estado as string, r.total as number]));
  }
  // Brasil (2600): solicitudes de liberación que esperan su respuesta (la administración ve todas las abiertas)
  let solicitudesBrasil = 0;
  if (sesion.permisos.has("BRASIL_APROPIAR")) {
    const supabase = await crearClienteServidor();
    const { data } = sinError(await supabase.rpc("solicitudes_liberacion"));
    solicitudesBrasil = ((data ?? []) as { estado: string; dirigida_a: string | null; solicitado_por: string }[])
      .filter((x) => x.estado === "PENDIENTE" && (x.dirigida_a === sesion.id || (sesion.permisos.has("APROBAR_MOVIMIENTO") && x.solicitado_por !== sesion.id))).length;
  }
  const ahora = new Date((await ahoraMs()));
  const hora = Number(ahora.toLocaleString("en-US", { timeZone: "America/Bogota", hour: "numeric", hour12: false }));
  const saludo = hora < 12 ? "Buenos días" : hora < 19 ? "Buenas tardes" : "Buenas noches";
  const nombre = sesion.nombre.replace(/\s*\(.*\)$/, "").split(/\s+/)[0];
  const fecha = ahora.toLocaleDateString("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long" });
  const puedeAprobar = sesion.permisos.has("APROBAR_MOVIMIENTO");
  // Contadores en el orden del flujo; para quien aprueba, "Verificado" es lo que tiene por aprobar
  const cifras = [
    { e: "BORRADOR", etiqueta: "Borradores", href: "/movimientos?estado=BORRADOR" },
    { e: "VERIFICADO", etiqueta: puedeAprobar ? "Por aprobar" : "Verificados", href: puedeAprobar ? "/aprobacion" : "/movimientos?estado=VERIFICADO" },
    { e: "RECHAZADO", etiqueta: "Rechazados", href: "/movimientos?estado=RECHAZADO" },
    { e: "APROBADO", etiqueta: "Aprobados", href: "/movimientos?estado=APROBADO" },
  ] as const;
  // Los grupos que el menú pliega (poco usados) van al final
  const grupos = GRUPOS.filter((g) => listos.some((m) => m.grupo === g))
    .sort((x, y) => Number(GRUPOS_PLEGADOS.includes(x)) - Number(GRUPOS_PLEGADOS.includes(y)));

  return (
    <div className="space-y-5">
      {sin_permiso && <Aviso>No tienes el permiso {String(sin_permiso)} para esa página.</Aviso>}
      {solicitudesBrasil > 0 && (
        <Aviso>
          {solicitudesBrasil === 1 ? "Le piden liberar un comprobante de Brasil" : `Le piden liberar ${solicitudesBrasil} comprobantes de Brasil`}.{" "}
          <Link href="/brasil/bandeja" className="font-medium underline">Responder en la bandeja →</Link>
        </Aviso>
      )}
      <Encabezado
        titulo={`${saludo}, ${nombre}`}
        detalle={<span className="first-letter:uppercase">{fecha} · {sesion.roles.join(", ") || "sin rol"}</span>}
        acciones={sesion.permisos.has("REGISTRAR_MOVIMIENTO") && !puedeAprobar && (
          <Link href="/movimientos/nuevo" className={boton}>+ Registrar movimiento</Link>
        )}
      />

      {sesion.permisos.has("VER_MOVIMIENTOS") && (
        <section aria-label="Movimientos por estado" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {cifras.map((c) => (
            <Cifra key={c.e} etiqueta={c.etiqueta} valor={(conteo[c.e] ?? 0).toLocaleString("es-CO")}
              tono={ESTADO_MOV[c.e].tono} detalle={ESTADO_MOV[c.e].ayuda} href={c.href} />
          ))}
        </section>
      )}

      <Tarjeta titulo="Accesos">
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
          {grupos.map((g) => (
            <div key={g}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-tenue">{g}</p>
              <ul className="grid grid-cols-2 gap-1.5 text-sm">
                {listos.filter((m) => m.grupo === g).map((m) => (
                  <li key={m.href}>
                    <Link href={m.href}
                      className="group flex min-h-10 items-center gap-2 rounded-lg border border-borde bg-superficie px-2.5 py-1.5 transition-[border-color,background-color,box-shadow] duration-150 hover:border-primario/45 hover:bg-primario-suave hover:text-primario hover:shadow-xs">
                      <IconoRuta href={m.href} className="size-4 text-tenue transition-colors group-hover:text-primario" />
                      <span className="min-w-0 flex-1 truncate">{m.etiqueta}</span>
                      <Icono nombre="flecha" className="size-3.5 text-tenue opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Tarjeta>

      {proximos.length > 0 && (
        <Tarjeta titulo="Módulos en construcción">
          <ul className="space-y-1 text-sm">
            {proximos.map((m) => (
              <li key={m.href} className="flex justify-between"><span>{m.etiqueta}</span><span className="text-tenue">Sprint {m.sprint}</span></li>
            ))}
          </ul>
        </Tarjeta>
      )}
      <details className="text-xs text-tenue">
        <summary className="cursor-pointer select-none hover:text-texto">Ver mis permisos ({sesion.permisos.size})</summary>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {[...sesion.permisos].sort().map((p) => (
            <li key={p} className="rounded bg-superficie-2 px-2 py-0.5 font-mono">{p}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
