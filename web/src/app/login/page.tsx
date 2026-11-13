"use client";

import { useActionState } from "react";
import { boton, campo } from "@/components/estilos";
import { Icono, Marca } from "@/components/Iconos";
import { SelectorTema } from "@/components/SelectorTema";
import { iniciarSesion, type EstadoLogin } from "./actions";

// Lo que hace el sistema, en el orden del flujo de un movimiento
const PASOS = [
  { icono: "registrar", titulo: "Registro", texto: "Operadores y clientes grandes registran cada movimiento con su comprobante." },
  { icono: "conciliacion", titulo: "Verificación", texto: "Se revisa y se bloquea antes de pasar a aprobación." },
  { icono: "aprobacion", titulo: "Aprobación", texto: "Al aprobar, la tasa se aplica y el saldo queda al día." },
] as const;

export default function PaginaLogin() {
  const [estado, accion, enviando] = useActionState<EstadoLogin, FormData>(iniciarSesion, {});

  return (
    <main className="grid min-h-dvh flex-1 bg-fondo lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Panel de marca (solo en pantallas anchas): azul profundo en ambos temas */}
      <aside className="relative hidden overflow-hidden bg-[#14275f] text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(48rem_32rem_at_0%_0%,rgb(86_128_255/0.55),transparent_60%),radial-gradient(40rem_28rem_at_100%_100%,rgb(20_170_150/0.28),transparent_60%)]" />
        <div aria-hidden className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:3rem_3rem] [mask-image:radial-gradient(ellipse_at_30%_20%,black,transparent_75%)]" />
        <div className="relative flex items-center gap-3">
          <span aria-hidden className="grid size-10 place-items-center rounded-xl bg-white/12 ring-1 ring-inset ring-white/25 backdrop-blur">
            <Icono nombre="cambio" className="size-5" />
          </span>
          <p className="text-lg font-semibold tracking-tight">Sistema de Tasas</p>
        </div>
        <div className="relative max-w-md space-y-8">
          <h2 className="text-[2.1rem] font-semibold leading-[1.15] tracking-tight">Cambios, saldos y aprobaciones en un solo lugar.</h2>
          <ul className="space-y-5">
            {PASOS.map((p) => (
              <li key={p.titulo} className="flex gap-3.5">
                <span aria-hidden className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-white/10 ring-1 ring-inset ring-white/15">
                  <Icono nombre={p.icono} className="size-[18px]" />
                </span>
                <div>
                  <p className="font-medium">{p.titulo}</p>
                  <p className="text-sm leading-relaxed text-white/70">{p.texto}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/55">Acceso solo para usuarios invitados.</p>
      </aside>

      <section className="relative flex items-center justify-center px-4 py-16
        bg-[radial-gradient(50rem_26rem_at_50%_-10%,var(--primario-suave),transparent)] lg:bg-none">
        <SelectorTema className="absolute right-4 top-4 w-56" />
        <div className="w-full max-w-[23rem] space-y-6 motion-safe:animate-aparecer">
          <div className="flex flex-col items-center gap-3 text-center lg:hidden">
            <Marca className="size-12 rounded-xl" />
            <div>
              <p className="text-lg font-semibold tracking-tight">Sistema de Tasas</p>
              <p className="text-sm text-tenue">Registro, verificación y aprobación de movimientos</p>
            </div>
          </div>
          <form action={accion} className="space-y-5 rounded-xl border border-borde bg-superficie p-7 shadow-lg">
            <div className="space-y-1">
              <h1 className="text-xl font-semibold">Ingresar</h1>
              <p className="text-sm text-tenue">Usa el correo y la contraseña de tu usuario.</p>
            </div>
            <label className="block space-y-1.5 text-sm font-medium">
              <span>Correo</span>
              <input name="correo" type="email" autoComplete="email" required autoFocus placeholder="nombre@empresa.com" className={`${campo} min-h-10 w-full`} />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              <span>Contraseña</span>
              <input name="clave" type="password" autoComplete="current-password" required className={`${campo} min-h-10 w-full`} />
            </label>
            {estado.error && (
              <p role="alert" className="flex items-start gap-2 rounded-md border border-peligro/25 bg-peligro-suave px-3 py-2 text-sm text-peligro">
                <Icono nombre="alerta" className="mt-0.5 size-4" /><span>{estado.error}</span>
              </p>
            )}
            <button type="submit" disabled={enviando} className={`${boton} min-h-10 w-full`}>
              {enviando ? "Ingresando…" : "Ingresar"}
            </button>
          </form>
          <p className="text-center text-xs text-tenue lg:hidden">Acceso solo para usuarios invitados.</p>
        </div>
      </section>
    </main>
  );
}
