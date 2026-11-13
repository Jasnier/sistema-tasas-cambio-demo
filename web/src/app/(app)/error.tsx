"use client";

import Link from "next/link";
import { useEffect } from "react";
import { boton, botonSuave } from "@/components/estilos";
import { Icono } from "@/components/Iconos";

/**
 * Lo que se ve cuando una página no pudo cargar sus datos (ver lib/supabase/datos.ts). Antes un fallo de la
 * consulta se pintaba como "0,00" o "sin datos"; ahora se dice que falló y se ofrece reintentar.
 * En producción Next oculta el mensaje interno: se muestra el código (digest) para buscarlo en los registros.
 */
export default function ErrorDePagina({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div role="alert" className="mx-auto mt-10 flex max-w-lg flex-col items-center gap-3 rounded-xl border border-peligro/25 bg-superficie px-6 py-8 text-center shadow-sm">
      <span aria-hidden className="grid size-11 place-items-center rounded-full bg-peligro-suave text-peligro">
        <Icono nombre="alerta" className="size-5" />
      </span>
      <h1 className="text-lg font-semibold">No se pudo cargar esta pantalla</h1>
      <p className="text-sm text-tenue">
        Los datos no llegaron, así que no se muestra nada para no dar cifras incompletas. Suele ser pasajero: intente de nuevo.
      </p>
      {error.digest && <p className="font-mono text-xs text-tenue">Código: {error.digest}</p>}
      <div className="mt-1 flex gap-2">
        <button type="button" onClick={reset} className={boton}>Reintentar</button>
        <Link href="/" className={botonSuave}>Ir al inicio</Link>
      </div>
    </div>
  );
}
