"use client";

/** Casilla del encabezado: marca o desmarca todas las filas del formulario (T-12, selección múltiple). */
export function SeleccionarTodo() {
  return (
    <input
      type="checkbox"
      aria-label="Seleccionar todos"
      className="size-4 accent-[var(--primario)]"
      onChange={(e) => {
        const form = e.currentTarget.form;
        form?.querySelectorAll<HTMLInputElement>('input[name="ids"]:not(:disabled)').forEach((c) => { c.checked = e.currentTarget.checked; });
      }}
    />
  );
}
