// Este módulo NO es "use client": las páginas del servidor importan estos textos y los combinan
// (`${campo} w-64`). Si vivieran en Formulario.tsx ("use client") llegarían como referencias de
// cliente y el estilo se perdería.
// Estilos de controles (STW-63): todas las pantallas los usan, así el diseño cambia en un solo lugar.
// Medidas: campos y botones de 2,25rem (≈32 px) para que se alineen en una misma fila; letra 13 px.
// Los botones suaves (secundarios) y de peligro miden lo mismo; las acciones dentro de una fila de
// tabla quedan igual de altas que un campo, lo que da un objetivo cómodo para el clic (WCAG 2.5.8).
const base =
  "inline-flex min-h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium " +
  "transition-[background-color,border-color,box-shadow,transform] duration-150 active:translate-y-px " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primario/40 focus-visible:ring-offset-1 focus-visible:ring-offset-superficie " +
  "disabled:cursor-not-allowed disabled:opacity-55 disabled:active:translate-y-0";

// Brillo fino en el borde superior de los botones sólidos: les da relieve sin recurrir a degradados
const relieve = "shadow-[inset_0_1px_0_rgb(255_255_255/0.18),var(--sombra-sm)]";

export const campo =
  "min-h-9 rounded-md border border-borde-fuerte bg-superficie px-2.5 py-1 text-sm text-texto shadow-xs placeholder:text-tenue/70 " +
  "transition-[border-color,box-shadow] duration-150 hover:border-tenue/60 focus:border-primario focus:outline-none focus:ring-[3px] focus:ring-primario/15 " +
  "disabled:bg-superficie-2 disabled:text-tenue";
export const boton = `${base} bg-primario text-primario-texto ${relieve} hover:bg-primario-hover`;
export const botonSuave = `${base} border border-borde-fuerte bg-superficie text-texto shadow-xs hover:border-tenue/50 hover:bg-superficie-2`;
export const botonPeligro = `${base} border border-peligro/35 bg-superficie text-peligro shadow-xs hover:border-peligro/60 hover:bg-peligro-suave`;
/** Rojo sólido: solo para confirmar una acción que no se deshace (rechazar, anular) dentro de su ventana. */
export const botonPeligroSolido = `${base} bg-peligro text-sobre ${relieve} hover:brightness-110`;
export const etiqueta = "flex flex-col gap-1 text-xs font-medium text-tenue";

/** Filtro o pestaña tipo píldora (estados, bancos, períodos, vistas): el mismo en todas las pantallas. */
export const chip = (activo: boolean) =>
  "inline-flex min-h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors duration-150 " +
  (activo
    ? "border-primario bg-primario text-primario-texto shadow-sm"
    : "border-borde-fuerte bg-superficie text-texto hover:border-primario/45 hover:bg-primario-suave hover:text-primario");
