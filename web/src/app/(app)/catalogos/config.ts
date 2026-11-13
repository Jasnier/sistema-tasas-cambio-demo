/** Definición de cada catálogo editable (tablas de la migración 0400). */
export type Catalogo = {
  tabla: "moneda" | "empresa" | "recibido_en" | "contraparte" | "banco_brasil";
  titulo: string;
  ayuda: string;
  conOrden: boolean;
  conTipo?: boolean;      // contraparte: CLIENTE / ALIADO
  conDescuento?: boolean; // recibido_en: descuento fijo + moneda (BCP)
};

export const CATALOGOS: Catalogo[] = [
  { tabla: "moneda", titulo: "Monedas", ayuda: "El nombre es el que usan tasas y movimientos (COP, USD, SOL, REAL…).", conOrden: true },
  { tabla: "contraparte", titulo: "Clientes y aliados", ayuda: "Código CT-nn. El saldo se agrupa por este código (P-32).", conOrden: false, conTipo: true },
  { tabla: "recibido_en", titulo: "Recibido en", ayuda: "Bancos o cuentas donde se recibe. AGENTE BCP resta 15 solo en SOL (P-4, P-36).", conOrden: true, conDescuento: true },
  { tabla: "empresa", titulo: "Empresas", ayuda: "Empresas que operan los movimientos.", conOrden: true },
  { tabla: "banco_brasil", titulo: "Bancos Brasil", ayuda: "Cuentas de Brasil donde Paula recibe comprobantes. Lista oficial pendiente (P-17).", conOrden: true },
];

export function catalogoPorTabla(t: string | undefined): Catalogo {
  return CATALOGOS.find((c) => c.tabla === t) ?? CATALOGOS[0];
}
