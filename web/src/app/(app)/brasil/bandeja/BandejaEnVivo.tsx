"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/client";

type Fila = { codigo?: string; estado?: string };
type Conexion = "conectando" | "en_vivo" | "sin_conexion";

const ESTADOS: Record<string, string> = {
  PENDIENTE: "pendiente", EN_PROCESO: "lo tomó alguien", APLICADO: "apropiado", ERROR: "con error", ANULADO: "anulado",
};

/**
 * La bandeja de Brasil se actualiza sola (migración 2400): cuando Paula guarda un comprobante, o alguien
 * toma / libera / apropia uno, la página se pide otra vez al servidor. No hay que "llamar" ni recargar.
 * Mismo patrón que EnVivo (STW-32), pero escuchando comprobante_brasil.
 */
export function BandejaEnVivo() {
  const router = useRouter();
  const [conexion, setConexion] = useState<Conexion>("conectando");
  const [aviso, setAviso] = useState<string | null>(null);
  const pendientes = useRef<string[]>([]);
  const temporizador = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const supabase = crearClienteNavegador();
    let canal: ReturnType<typeof supabase.channel> | undefined;
    let vivo = true;
    // Junta varios cambios seguidos (p. ej. liberar anula el movimiento y devuelve el comprobante) en un solo refresco
    const avisar = (texto: string) => {
      pendientes.current.push(texto);
      clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => {
        const lista = pendientes.current.splice(0);
        setAviso(lista.length > 3 ? `${lista.slice(0, 3).join(" · ")} y ${lista.length - 3} más` : lista.join(" · "));
        router.refresh();
      }, 800);
    };
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!vivo) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (!vivo) return;   // se desmontó mientras se ponía el token: no dejar un canal huérfano
      canal = supabase
        .channel(`bandeja-brasil-${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "comprobante_brasil" }, (p) => {
          const n = p.new as Fila, v = p.old as Fila;
          const codigo = n.codigo ?? v.codigo ?? "un comprobante";
          avisar(p.eventType === "INSERT" ? `${codigo} nuevo` : `${codigo} ${ESTADOS[n.estado ?? ""] ?? "cambió"}`);
        })
        // Solicitudes de liberación (2600): le llegan a quien apropió; a quien pidió, la respuesta
        .on("postgres_changes", { event: "*", schema: "public", table: "solicitud_liberacion" }, (p) => {
          const n = p.new as { estado?: string };
          avisar(p.eventType === "INSERT" ? "nueva solicitud de liberación"
            : n.estado === "ACEPTADA" ? "le liberaron un comprobante" : n.estado === "RECHAZADA" ? "rechazaron una solicitud" : "solicitud actualizada");
        })
        .subscribe((estado) => {
          if (!vivo) return;
          setConexion(estado === "SUBSCRIBED" ? "en_vivo" : estado === "CHANNEL_ERROR" || estado === "TIMED_OUT" || estado === "CLOSED" ? "sin_conexion" : "conectando");
        });
    })();
    return () => {
      vivo = false;
      clearTimeout(temporizador.current);
      if (canal) void supabase.removeChannel(canal);
    };
  }, [router]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 8000);
    return () => clearTimeout(t);
  }, [aviso]);

  const punto = conexion === "en_vivo" ? "bg-exito" : conexion === "conectando" ? "bg-aviso" : "bg-peligro";
  const etiqueta = conexion === "en_vivo" ? "En vivo" : conexion === "conectando" ? "Conectando…" : "Sin actualización automática";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-tenue print:hidden" aria-live="polite">
      <span className="inline-flex items-center gap-1.5"
        title={conexion === "en_vivo" ? "Los comprobantes que carga Paula aparecen solos, sin recargar" : "Recargue la página para ver lo nuevo"}>
        <span className={`size-2 rounded-full ${punto}`} aria-hidden /> {etiqueta}
      </span>
      {aviso && <span className="rounded-md bg-primario-suave px-2 py-0.5 text-primario">Actualizado: {aviso}</span>}
    </div>
  );
}
