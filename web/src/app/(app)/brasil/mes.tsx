import Link from "next/link";
import { botonSuave, chip } from "@/components/estilos";

/**
 * Brasil Paula trabaja por libros mensuales (en Sheets, un libro nuevo cada mes, con sus resúmenes).
 * En la web todo vive junto, pero la carga y los resúmenes se ven por mes: por defecto el mes en curso,
 * con flechas y accesos a los meses con datos; "todos" quita la separación. La bandeja no se divide.
 */
export type Mes = { todos: boolean; mes: string; inicio: string; fin: string; actual: string; esActual: boolean };

export function leerMes(valor: string | string[] | undefined, hoy: string): Mes {
  const v = typeof valor === "string" ? valor : "";
  const actual = hoy.slice(0, 7);
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : actual;
  const fin = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).toISOString().slice(0, 10);
  return { todos: v === "todos", mes, inicio: `${mes}-01`, fin, actual, esActual: mes === actual };
}

/** "2026-11" → "2026-10" (delta −1) */
export function otroMes(mes: string, delta: number): string {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

export function nombreMes(mes: string): string {
  return new Date(`${mes}-15T12:00:00Z`).toLocaleDateString("es-CO", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Valor del parámetro ?mes= (vacío si es el mes en curso, que es el de siempre). */
export function parametroMes(m: Mes): string {
  return m.todos ? "todos" : m.esActual ? "" : m.mes;
}

/** Los últimos 12 meses con registros (y siempre el mes en curso), del más reciente al más antiguo. */
export function mesesConDatos(fechas: string[], m: Mes): string[] {
  return [...new Set([m.actual, ...fechas.map((f) => f.slice(0, 7))])].sort().reverse().slice(0, 12);
}

/**
 * ‹ noviembre de 2026 › · 2026-11 · 2026-10 · … · Todos.
 * `enlace(mes)` arma la URL de otro mes (cada pantalla conserva sus propios parámetros, como el banco).
 */
export function SelectorMes({ m, meses, enlace }: { m: Mes; meses: string[]; enlace: (mes: string) => string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-1">
        {!m.todos && <Link href={enlace(otroMes(m.mes, -1))} className={botonSuave} aria-label="Mes anterior">‹</Link>}
        <h2 className="min-w-44 px-2 text-center text-lg font-semibold first-letter:uppercase">{m.todos ? "Todos los meses" : nombreMes(m.mes)}</h2>
        {!m.todos && m.mes < m.actual && <Link href={enlace(otroMes(m.mes, 1))} className={botonSuave} aria-label="Mes siguiente">›</Link>}
      </div>
      <nav aria-label="Meses" className="flex flex-wrap gap-1.5">
        {meses.map((x) => <Link key={x} href={enlace(x)} className={chip(!m.todos && x === m.mes)}>{x}</Link>)}
        <Link href={enlace("todos")} className={chip(m.todos)}>Todos</Link>
      </nav>
    </div>
  );
}
