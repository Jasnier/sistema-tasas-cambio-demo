/**
 * Celda de un CSV para Excel en español (separador ";"). Antepone un apóstrofo a lo que Excel tomaría como
 * fórmula (empieza con = + - @), salvo que sea un número, y pone comillas si lleva ; " o salto de línea.
 */
export function celdaCsv(v: string): string {
  const s = /^[=+\-@\t\r]/.test(v) && !/^-?\d+(,\d+)?$/.test(v) ? "'" + v : v;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Fecha de hoy en Colombia (AAAA-MM-DD), para nombres de archivo. */
export function hoyBogota(): string {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}
