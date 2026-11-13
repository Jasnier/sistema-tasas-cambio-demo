/**
 * Íconos de línea (24 × 24, trazo 1,75) dibujados aquí mismo: sin dependencias y con el color del texto.
 * Sin estado ni "use client": sirven en Server y Client Components.
 */
type Nombre =
  | "inicio" | "cuenta" | "movimientos" | "registrar" | "aprobacion" | "subir" | "bandeja" | "barras"
  | "conciliacion" | "tasas" | "beneficios" | "catalogos" | "clientes" | "saldos" | "documento" | "ganancias"
  | "tablero" | "resultados" | "gastos" | "negociaciones" | "ajustes" | "calendario" | "escudo" | "lupa"
  | "sol" | "luna" | "pantalla" | "salir" | "flecha" | "cambio" | "info" | "alerta" | "check" | "vacio";

const TRAZOS: Record<Nombre, React.ReactNode> = {
  inicio: <><path d="m3 10.5 9-7.5 9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" /></>,
  cuenta: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  movimientos: <><path d="M4 7h16" /><path d="m16 3 4 4-4 4" /><path d="M20 17H4" /><path d="m8 13-4 4 4 4" /></>,
  registrar: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>,
  aprobacion: <><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></>,
  subir: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>,
  bandeja: <><path d="M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6l2-8Z" /><path d="M3 13h5l1.5 3h5l1.5-3h5" /></>,
  barras: <><path d="M3 20h18" /><path d="M6 20v-8M12 20V5M18 20v-11" /></>,
  conciliacion: <><path d="M4 7h16M4 12h9M4 17h6" /><path d="m14.5 16.5 2 2 4-4.5" /></>,
  tasas: <><path d="M19 5 5 19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></>,
  beneficios: <path d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9l-5.4 2.9 1.1-6.1-4.5-4.3 6.1-.8L12 3Z" />,
  catalogos: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" strokeWidth="2.6" /></>,
  clientes: <><path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16" /><path d="M14 9h5a1 1 0 0 1 1 1v11" /><path d="M2 21h20M8 8h2M8 12h2M8 16h2" /></>,
  saldos: <><path d="M19 8V7a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7" /><path d="M16.5 14h.01" strokeWidth="2.6" /></>,
  documento: <><path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
  ganancias: <><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  tablero: <><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></>,
  resultados: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10" /></>,
  gastos: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20M6 15h4" /></>,
  negociaciones: <path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12Z" />,
  ajustes: <><path d="M4 6h8M16 6h4M4 12h2M10 12h10M4 18h10M18 18h2" /><circle cx="14" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="16" cy="18" r="2" /></>,
  calendario: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  escudo: <><path d="m12 3 8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6l8-3Z" /><path d="m9 12 2 2 4-4" /></>,
  lupa: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  sol: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  luna: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  pantalla: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  salir: <><path d="M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" /><path d="M14 8l4 4-4 4M18 12H9" /></>,
  flecha: <path d="m9 6 6 6-6 6" />,
  cambio: <><path d="M4 8h13" /><path d="m14 4.5 3.5 3.5L14 11.5" /><path d="M20 16H7" /><path d="M10 12.5 6.5 16l3.5 3.5" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7.5h.01" strokeWidth="2.6" /></>,
  alerta: <><path d="M12 4 2.5 20h19L12 4Z" /><path d="M12 10v4.5" /><path d="M12 17.2h.01" strokeWidth="2.6" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  vacio: <><path d="M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6l2-8Z" /><path d="M3 13h5l1.5 3h5l1.5-3h5" /></>,
};

export function Icono({ nombre, className = "size-4" }: { nombre: Nombre; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden className={`shrink-0 ${className}`}>
      {TRAZOS[nombre]}
    </svg>
  );
}

/** Ícono de cada entrada del menú, por su ruta (el mismo en la barra lateral y en los accesos del inicio). */
const POR_RUTA: Record<string, Nombre> = {
  "/": "inicio",
  "/portal": "cuenta",
  "/movimientos": "movimientos",
  "/movimientos/nuevo": "registrar",
  "/aprobacion": "aprobacion",
  "/brasil": "subir",
  "/brasil/bandeja": "bandeja",
  "/brasil/resumen": "barras",
  "/tasas": "tasas",
  "/beneficios": "beneficios",
  "/catalogos": "catalogos",
  "/admin/clientes": "clientes",
  "/saldos": "saldos",
  "/estado-cuenta": "documento",
  "/ganancias": "ganancias",
  "/finanzas/resumen-operativo": "tablero",
  "/finanzas/estado-resultados": "resultados",
  "/finanzas/gastos": "gastos",
  "/finanzas/negociaciones": "negociaciones",
  "/admin/utilidad": "ajustes",
  "/admin/periodos": "calendario",
  "/admin/roles": "escudo",
  "/admin/auditoria": "lupa",
};

export function IconoRuta({ href, className }: { href: string; className?: string }) {
  return <Icono nombre={POR_RUTA[href] ?? "flecha"} className={className} />;
}

/** Marca del sistema: el cuadro azul con las flechas de cambio. */
export function Marca({ className = "size-8 rounded-lg" }: { className?: string }) {
  return (
    <span aria-hidden
      className={`grid shrink-0 place-items-center bg-linear-to-br from-primario to-primario-hover text-primario-texto shadow-sm ring-1 ring-inset ring-white/15 ${className}`}>
      <Icono nombre="cambio" className="size-[58%]" />
    </span>
  );
}
