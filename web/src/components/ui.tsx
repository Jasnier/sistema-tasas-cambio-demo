import Link from "next/link";
import { AltoEncabezado } from "./AltoEncabezado";
import { Ayuda } from "./Ayuda";
import { Icono } from "./Iconos";

/** Piezas comunes de las pantallas (STW-63). Sin estado: sirven en Server y Client Components. */

/**
 * Título de la pantalla. `descripcion` (qué es y cómo funciona) ya no va como párrafo bajo el título: se lee en el
 * ícono ⓘ junto a él. `detalle` es una línea corta de DATOS de contexto (fecha, código, libro) que sí se ve.
 */
export function Encabezado({ titulo, descripcion, detalle, acciones, migas }: {
  titulo: string;
  descripcion?: React.ReactNode;
  detalle?: React.ReactNode;
  acciones?: React.ReactNode;
  migas?: { href: string; etiqueta: string }[];
}) {
  return (
    // Fijo arriba al desplazarse (en escritorio): siempre se ve en qué pantalla está y qué hace.
    // -mt-5/pt-5 cubre el margen superior de <main> para que el contenido no asome por encima.
    // Fondo casi opaco con desenfoque: lo que pasa por debajo se intuye sin estorbar la lectura.
    <header className="z-20 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b border-borde bg-fondo pb-4 lg:sticky lg:top-0 lg:-mt-5 lg:bg-fondo/90 lg:pt-5 lg:backdrop-blur-md print:static">
      <div className="min-w-0 space-y-1">
        {migas && (
          <nav aria-label="Ruta" className="flex flex-wrap items-center gap-1 text-xs text-tenue">
            {migas.map((m) => (
              <span key={m.href} className="flex items-center gap-1">
                <Link href={m.href} className="rounded transition-colors hover:text-primario hover:underline">{m.etiqueta}</Link>
                <Icono nombre="flecha" className="size-3 opacity-60" />
              </span>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-1.5">
          <h1 className="text-2xl font-semibold text-texto">{titulo}</h1>
          {descripcion && <Ayuda>{descripcion}</Ayuda>}
        </div>
        {detalle && <p className="text-sm text-tenue">{detalle}</p>}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
      <AltoEncabezado />
    </header>
  );
}

export function Tarjeta({ titulo, acciones, children, className = "" }: {
  titulo?: React.ReactNode;
  acciones?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-borde bg-superficie shadow-sm ${className}`}>
      {(titulo || acciones) && (
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-borde px-4 py-2">
          {titulo && <h2 className="text-sm font-semibold text-texto">{titulo}</h2>}
          {acciones}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export type Tono = "neutro" | "primario" | "exito" | "aviso" | "peligro" | "info";

const TONOS: Record<Tono, string> = {
  neutro: "bg-superficie-2 text-tenue border-borde",
  primario: "bg-primario-suave text-primario border-primario/25",
  exito: "bg-exito-suave text-exito border-exito/25",
  aviso: "bg-aviso-suave text-aviso border-aviso/25",
  peligro: "bg-peligro-suave text-peligro border-peligro/25",
  info: "bg-info-suave text-info border-info/25",
};

export function Insignia({ tono = "neutro", children, title, punto }: {
  tono?: Tono; children: React.ReactNode; title?: string;
  /** Punto de color delante del texto: para estados (se reconocen de un vistazo en una columna). */
  punto?: boolean;
}) {
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-px text-xs font-medium leading-5 ${TONOS[tono]}`}>
      {punto && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Estado de un movimiento: nombre y color iguales en todas las pantallas. */
export const ESTADO_MOV: Record<string, { etiqueta: string; tono: Tono; ayuda: string }> = {
  BORRADOR: { etiqueta: "Borrador", tono: "neutro", ayuda: "Lo puede corregir el operador" },
  ENVIADO_OPERADOR: { etiqueta: "Enviado", tono: "info", ayuda: "El operador lo envió desde el libro del cliente; falta verificar" },
  VERIFICADO: { etiqueta: "Verificado", tono: "primario", ayuda: "Bloqueado: listo para aprobación (Motor)" },
  APROBADO: { etiqueta: "Aprobado", tono: "exito", ayuda: "Aplicado al saldo: solo corrección auditada" },
  RECHAZADO: { etiqueta: "Rechazado", tono: "peligro", ayuda: "Rechazado con motivo" },
  ANULADO: { etiqueta: "Anulado", tono: "neutro", ayuda: "No cuenta; queda como historial" },
};

export function EstadoMovimiento({ estado }: { estado: string }) {
  const e = ESTADO_MOV[estado] ?? { etiqueta: estado, tono: "neutro" as Tono, ayuda: "" };
  return <Insignia tono={e.tono} title={e.ayuda} punto>{e.etiqueta}</Insignia>;
}

export function Vacio({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-borde-fuerte bg-superficie-2/40 px-4 py-8 text-center text-sm text-tenue">
      <span aria-hidden className="grid size-9 place-items-center rounded-full bg-superficie-2 text-tenue/80 ring-1 ring-borde">
        <Icono nombre="vacio" className="size-[18px]" />
      </span>
      <p className="max-w-prose">{children}</p>
    </div>
  );
}

const ICONO_AVISO: Record<Tono, "info" | "alerta" | "check"> = {
  neutro: "info", primario: "info", info: "info", aviso: "alerta", peligro: "alerta", exito: "check",
};

export function Aviso({ tono = "aviso", children }: { tono?: Tono; children: React.ReactNode }) {
  return (
    <div role="note" className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${TONOS[tono]}`}>
      <Icono nombre={ICONO_AVISO[tono]} className="mt-0.5 size-4" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Cifra destacada para tableros. */
export function Cifra({ etiqueta, valor, href, tono = "neutro", detalle }: {
  etiqueta: string; valor: React.ReactNode; href?: string; tono?: Tono; detalle?: string;
}) {
  const punto: Record<Tono, string> = {
    neutro: "bg-borde-fuerte", primario: "bg-primario", exito: "bg-exito", aviso: "bg-aviso", peligro: "bg-peligro", info: "bg-info",
  };
  const cuerpo = (
    <div className={`group/cifra relative h-full overflow-hidden rounded-xl border border-borde bg-superficie px-4 py-3.5 shadow-sm transition-[border-color,box-shadow,transform] duration-150 ${href ? "hover:-translate-y-0.5 hover:border-primario/45 hover:shadow-md" : ""}`}>
      <span aria-hidden className={`absolute inset-x-0 top-0 h-0.5 ${punto[tono]}`} />
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-tenue">
        <span aria-hidden className={`size-2 rounded-full ${punto[tono]}`} />
        <span className="min-w-0 flex-1 truncate">{etiqueta}</span>
        {href && <Icono nombre="flecha" className="size-3.5 opacity-0 transition-opacity group-hover/cifra:opacity-100" />}
      </p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums text-texto">{valor}</p>
      {detalle && <p className="mt-1 text-xs text-tenue">{detalle}</p>}
    </div>
  );
  return href ? <Link href={href} className="block rounded-xl">{cuerpo}</Link> : cuerpo;
}

export const dinero = (n: number | string | null | undefined) =>
  n == null ? "" : Number(n).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
