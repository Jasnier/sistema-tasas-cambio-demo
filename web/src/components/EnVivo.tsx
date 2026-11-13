"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { ESTADO_MOV } from "./ui";

type Fila = { codigo?: string; estado?: string };
type Conexion = "conectando" | "en_vivo" | "sin_conexion";

/**
 * STW-32: la bandeja se actualiza sola cuando cambia un movimiento (Supabase Realtime, migración 2300).
 * Realtime solo avisa de las filas que el usuario puede leer (RLS). Al llegar cambios se espera un momento
 * (una aprobación por lote dispara muchos) y se pide la página otra vez al servidor con router.refresh():
 * los filtros, la selección y el scroll se conservan. Muestra qué cambió y si la conexión está activa.
 */
export function EnVivo({ filtro }: { /** Filtro de Realtime, p. ej. `libro_id=eq.<uuid>` (opcional: la RLS ya filtra) */ filtro?: string }) {
  const router = useRouter();
  const [conexion, setConexion] = useState<Conexion>("conectando");
  const [aviso, setAviso] = useState<string | null>(null);
  const pendientes = useRef<string[]>([]);
  const temporizador = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const supabase = crearClienteNavegador();
    let canal: ReturnType<typeof supabase.channel> | undefined;
    let vivo = true;

    (async () => {
      // Realtime necesita el token de la sesión para aplicar la RLS de este usuario
      const { data } = await supabase.auth.getSession();
      if (!vivo) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (!vivo) return;   // se desmontó mientras se ponía el token: no dejar un canal huérfano
      canal = supabase
        .channel(`en-vivo-movimiento-${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "movimiento", ...(filtro && { filter: filtro }) }, (p) => {
          const n = p.new as Fila, v = p.old as Fila;
          const codigo = n.codigo ?? v.codigo ?? "un movimiento";
          const texto = p.eventType === "INSERT" ? `${codigo} registrado`
            : n.estado ? `${codigo} → ${ESTADO_MOV[n.estado]?.etiqueta ?? n.estado}` : `${codigo} cambió`;
          pendientes.current.push(texto);
          clearTimeout(temporizador.current);
          temporizador.current = setTimeout(() => {
            const lista = pendientes.current.splice(0);
            setAviso(lista.length > 3 ? `${lista.slice(0, 3).join(" · ")} y ${lista.length - 3} más` : lista.join(" · "));
            router.refresh();
          }, 800);
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
  }, [filtro, router]);

  // El aviso se va solo a los 8 segundos
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 8000);
    return () => clearTimeout(t);
  }, [aviso]);

  const punto = conexion === "en_vivo" ? "bg-exito" : conexion === "conectando" ? "bg-aviso" : "bg-peligro";
  const etiqueta = conexion === "en_vivo" ? "En vivo" : conexion === "conectando" ? "Conectando…" : "Sin actualización automática";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-tenue print:hidden" aria-live="polite">
      <span className="inline-flex items-center gap-1.5" title={conexion === "en_vivo" ? "La página se actualiza sola cuando se aprueba, rechaza o registra un movimiento" : "Recargue la página para ver cambios"}>
        <span className={`size-2 rounded-full ${punto}`} aria-hidden /> {etiqueta}
      </span>
      {aviso && <span className="rounded-md bg-primario-suave px-2 py-0.5 text-primario">Actualizado: {aviso}</span>}
    </div>
  );
}
