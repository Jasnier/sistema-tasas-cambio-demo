// Lector y escritor de los CSV de dev/diagnostico/exportarCsv.js (se prueba en scripts/csv.test.mjs).
// Formato: coma, UTF-8; texto SIEMPRE entre comillas, número sin comillas con punto decimal, TRUE/FALSE sin comillas.

/** CSV → filas con tipos. Admite comillas, comillas dobles escapadas y saltos de línea dentro de un texto. */
export function leerCsv(texto) {
  const filas = [];
  let fila = [], i = 0;
  const n = texto.length;
  if (texto.charCodeAt(0) === 0xfeff) i = 1;   // BOM
  while (i < n) {
    let valor;
    if (texto[i] === '"') {
      let s = "";
      i++;
      for (;;) {
        if (i >= n) throw new Error("CSV mal formado: comilla sin cerrar");
        if (texto[i] === '"') {
          if (texto[i + 1] === '"') { s += '"'; i += 2; continue; }
          i++; break;
        }
        s += texto[i++];
      }
      valor = s;   // texto
    } else {
      let j = i;
      while (j < n && texto[j] !== "," && texto[j] !== "\r" && texto[j] !== "\n") j++;
      const crudo = texto.slice(i, j);
      i = j;
      if (crudo === "") valor = "";
      else if (crudo === "TRUE" || crudo === "FALSE") valor = crudo === "TRUE";
      else {
        const num = Number(crudo);
        if (!Number.isFinite(num)) throw new Error(`CSV mal formado: valor sin comillas que no es número: ${crudo.slice(0, 40)}`);
        valor = num;
      }
    }
    fila.push(valor);
    if (texto[i] === ",") { i++; if (i === n) fila.push(""); continue; }
    if (texto[i] === "\r") i++;
    if (texto[i] === "\n") i++;
    filas.push(fila);
    fila = [];
  }
  if (fila.length) filas.push(fila);
  // Como la API de Sheets: sin celdas vacías al final de cada fila
  for (const f of filas) while (f.length && f[f.length - 1] === "") f.pop();
  while (filas.length && filas[filas.length - 1].length === 0) filas.pop();
  return filas;
}

/** Lo mismo que aCsv_ de exportarCsv.js (Apps Script): sirve para la prueba de ida y vuelta. */
export function aCsv(filas) {
  const ancho = filas.reduce((m, f) => Math.max(m, f.length), 0);
  return filas.map((f) => {
    const celdas = [];
    for (let i = 0; i < ancho; i++) {
      const v = f[i];
      if (v === undefined || v === null || v === "") celdas.push("");
      else if (typeof v === "number") celdas.push(String(v));
      else if (typeof v === "boolean") celdas.push(v ? "TRUE" : "FALSE");
      else celdas.push('"' + String(v).replace(/"/g, '""') + '"');
    }
    return celdas.join(",");
  }).join("\r\n");
}
