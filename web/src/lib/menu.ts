/** Menú principal: cada entrada se muestra solo si el usuario tiene el permiso. */
export type EntradaMenu = {
  href: string; etiqueta: string; permiso?: string; sprint?: number; grupo: GrupoMenu;
  /** Trabajo diario de otro rol: para la administración va plegado en "Otras tareas". */
  deOtroRol?: boolean;
};
export type GrupoMenu = "General" | "Operación" | "Brasil" | "Configuración" | "Informes" | "Administración" | "Otras tareas";

export const GRUPOS: GrupoMenu[] = ["General", "Operación", "Brasil", "Informes", "Configuración", "Administración", "Otras tareas"];
/** Grupos que empiezan plegados (cada quien los abre y el navegador lo recuerda). */
export const GRUPOS_PLEGADOS: GrupoMenu[] = ["Configuración", "Administración", "Otras tareas"];
/** Con pocas opciones (operador, cliente, Brasil) el menú no se pliega. */
export const MINIMO_PARA_PLEGAR = 9;

/** Arma el menú de una persona: lo que su permiso deja ver; a la administración le pliega lo de otros roles. */
export function menuPara(permisos: Set<string>): EntradaMenu[] {
  const visibles = MENU.filter((m) => !m.permiso || permisos.has(m.permiso));
  if (!permisos.has("APROBAR_MOVIMIENTO")) return visibles;
  return visibles.map((m) => (m.deOtroRol ? { ...m, grupo: "Otras tareas" as GrupoMenu } : m));
}

export const MENU: EntradaMenu[] = [
  { href: "/", etiqueta: "Inicio", grupo: "General" },
  { href: "/portal", etiqueta: "Mi cuenta", permiso: "PORTAL_CLIENTE", grupo: "General" },
  { href: "/movimientos", etiqueta: "Movimientos", permiso: "VER_MOVIMIENTOS", grupo: "Operación" },
  { href: "/movimientos/nuevo", etiqueta: "Registrar movimiento", permiso: "REGISTRAR_MOVIMIENTO", grupo: "Operación", deOtroRol: true },
  { href: "/aprobacion", etiqueta: "Aprobación", permiso: "APROBAR_MOVIMIENTO", grupo: "Operación" },
  { href: "/brasil", etiqueta: "Carga Brasil", permiso: "BRASIL_CARGAR", grupo: "Brasil", deOtroRol: true },
  { href: "/brasil/bandeja", etiqueta: "Bandeja", permiso: "BRASIL_APROPIAR", grupo: "Brasil" },
  { href: "/brasil/resumen", etiqueta: "Resumen", permiso: "BRASIL_CARGAR", grupo: "Brasil" },
  { href: "/tasas", etiqueta: "Tasas", permiso: "GESTIONAR_TASAS", grupo: "Configuración" },
  { href: "/beneficios", etiqueta: "Beneficios", permiso: "GESTIONAR_CATALOGOS", grupo: "Configuración" },
  { href: "/catalogos", etiqueta: "Catálogos", permiso: "GESTIONAR_CATALOGOS", grupo: "Configuración" },
  { href: "/admin/clientes", etiqueta: "Clientes grandes", permiso: "GESTIONAR_CATALOGOS", grupo: "Configuración" },
  { href: "/saldos", etiqueta: "Saldos", permiso: "VER_REPORTES", grupo: "Operación" },
  { href: "/estado-cuenta", etiqueta: "Estado de cuenta", permiso: "VER_REPORTES", grupo: "Operación" },
  { href: "/ganancias", etiqueta: "Ganancias", permiso: "VER_GANANCIAS", grupo: "Informes", deOtroRol: true },
  { href: "/finanzas/resumen-operativo", etiqueta: "Resumen operativo", permiso: "FINANZAS", grupo: "Informes" },
  { href: "/finanzas/estado-resultados", etiqueta: "Estado de resultados", permiso: "FINANZAS", grupo: "Informes" },
  { href: "/finanzas/gastos", etiqueta: "Gastos", permiso: "FINANZAS", grupo: "Informes" },
  { href: "/finanzas/negociaciones", etiqueta: "Negociaciones", permiso: "FINANZAS", grupo: "Otras tareas" },
  { href: "/admin/utilidad", etiqueta: "Ajustar utilidad", permiso: "AJUSTAR_UTILIDAD", grupo: "Administración" },
  { href: "/admin/periodos", etiqueta: "Períodos", permiso: "CERRAR_PERIODO", grupo: "Administración" },
  { href: "/admin/roles", etiqueta: "Roles y permisos", permiso: "GESTIONAR_ROLES", grupo: "Administración" },
  { href: "/admin/auditoria", etiqueta: "Auditoría", permiso: "VER_AUDITORIA", grupo: "Administración" },
];
