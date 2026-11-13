/**
 * Convierte lo que escribe el usuario en un número, sin adivinar en los casos ambiguos.
 *
 * Acepta:  "4100"  "4100.5"  "4100,5"  "4.100,50"  "1.080.000,25"  "0.25"  "-3"
 * Rechaza: "4.100", "1.080", "0.250", "1.080.000" (solo puntos, en grupos de 3 cifras).
 *   En Colombia "4.100" casi siempre es cuatro mil cien; en otros formatos es 4,1. Una tasa
 *   guardada mil veces más baja no da error en ningún lado, así que se pide escribirlo sin
 *   ambigüedad: "4100" o "4,1".
 */
export function parsearNumero(entrada: string, campo = "valor"): number {
  const crudo = entrada.replace(/\s/g, "");
  if (!crudo) throw new Error(`"${campo}" es obligatorio`);

  let normal: string;
  if (crudo.includes(",")) {
    // Coma = decimal; los puntos, si hay, son separadores de miles y deben estar bien agrupados
    if ((crudo.match(/,/g) ?? []).length > 1) throw new Error(`"${campo}": "${entrada}" tiene más de una coma`);
    const [entera] = crudo.split(",");
    if (entera.includes(".") && !/^-?\d{1,3}(\.\d{3})+$/.test(entera)) {
      throw new Error(`"${campo}": "${entrada}" tiene los puntos de miles mal ubicados`);
    }
    normal = crudo.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(crudo)) {
    throw new Error(
      `"${campo}": "${entrada}" es ambiguo (¿miles o decimales?). Escríbelo sin puntos de miles ` +
        `(por ejemplo 4100) o con coma decimal (por ejemplo 4,1).`,
    );
  } else {
    normal = crudo;
  }

  if (!/^-?\d+(\.\d+)?$/.test(normal)) throw new Error(`"${campo}" debe ser un número`);
  const n = Number(normal);
  if (!Number.isFinite(n)) throw new Error(`"${campo}" debe ser un número`);
  return n;
}
