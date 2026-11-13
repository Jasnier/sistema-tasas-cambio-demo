/**
 * Pantalla de carga entre páginas: al hacer clic en el menú se ve al instante (Next.js la usa como
 * borde de Suspense), mientras el servidor trae los datos. Imita la forma de una pantalla real:
 * encabezado, filtros y tabla.
 */
export default function Cargando() {
  // Brillo que recorre las barras (en vez de un parpadeo de toda la pantalla)
  const barra = "rounded bg-[linear-gradient(90deg,var(--borde)_25%,var(--superficie-2)_50%,var(--borde)_75%)] bg-[length:200%_100%] motion-safe:animate-brillo";
  return (
    <div className="space-y-5" role="status" aria-live="polite" aria-label="Cargando">
      <div className="space-y-2 border-b border-borde pb-4">
        <div className={`${barra} h-6 w-56`} />
        <div className={`${barra} h-4 w-full max-w-xl`} />
      </div>
      <div className="flex gap-2">
        {[64, 80, 72, 88].map((w) => <div key={w} className={`${barra} h-7 rounded-full`} style={{ width: w }} />)}
      </div>
      <div className="rounded-xl border border-borde bg-superficie shadow-sm">
        <div className="border-b border-borde px-4 py-3"><div className={`${barra} h-4 w-40`} /></div>
        <div className="space-y-3 p-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex gap-4">
              <div className={`${barra} h-4 w-24`} /><div className={`${barra} h-4 flex-1`} /><div className={`${barra} h-4 w-28`} />
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Cargando…</span>
    </div>
  );
}
