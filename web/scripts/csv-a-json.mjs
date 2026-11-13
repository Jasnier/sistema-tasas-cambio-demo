#!/usr/bin/env node
// Convierte la carpeta de CSV de dev/diagnostico/exportarCsv.js en los JSON que ya usan los importadores probados:
//   EXPORT_CORE_<marca>.json        → importar-core.mjs
//   EXPORT_MOVIMIENTOS_<marca>.json → importar-historial.mjs, conciliar-saldos.mjs, pruebas-oro.mjs
//   EXPORT_HISTORIAL_<marca>.json   → importar-historial.mjs --historial=
//   EXPORT_BRASIL_<marca>.json      → importar-brasil.mjs
//
//   node scripts/csv-a-json.mjs <carpeta EXPORT_CSV_…>          (deja los JSON en la misma carpeta)
//
// Los tipos se recuperan del propio CSV: entre comillas = texto, sin comillas = número (o TRUE/FALSE), vacío = "".
// Las celdas vacías del final de cada fila se recortan, como las devuelve la API de Sheets, para que los importadores
// vean exactamente lo mismo que con los exports JSON.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { leerCsv } from "./csv.mjs";

const carpeta = process.argv[2];
const salir = (m) => { console.error(`\n✖ ${m}\n`); process.exit(1); };
if (!carpeta || !existsSync(join(carpeta, "MANIFIESTO.json"))) {
  salir("Uso: node scripts/csv-a-json.mjs <carpeta EXPORT_CSV_…> (debe tener MANIFIESTO.json; ¿terminó exportarCsv con \"LISTO\"?)");
}
const man = JSON.parse(readFileSync(join(carpeta, "MANIFIESTO.json"), "utf8"));
if (man.tipo !== "EXPORT_CSV") salir("MANIFIESTO.json no es de exportarCsv.");

function hojasDe(libro) {
  const hojas = {};
  for (const [nombre, h] of Object.entries(libro.hojas)) {
    const ruta = join(carpeta, h.archivo);
    if (!existsSync(ruta)) salir(`Falta el archivo ${h.archivo} (libro ${libro.codigo}). ¿Se descargó la carpeta completa?`);
    const filas = leerCsv(readFileSync(ruta, "utf8"));
    if (Math.max(filas.length - 1, 0) !== h.filas) {
      console.warn(`  OJO ${h.archivo}: el manifiesto dice ${h.filas} filas y el CSV trae ${Math.max(filas.length - 1, 0)}`);
    }
    hojas[nombre] = { nombre_real: h.nombre_real, filas };
  }
  return hojas;
}
const libroJson = (l) => ({ titulo: l.titulo, zona_horaria: l.zona_horaria, hojas: hojasDe(l), faltantes: l.faltantes ?? [] });

const libros = Object.values(man.libros);
const core = libros.find((l) => l.grupo === "core");
const motor = libros.find((l) => l.grupo === "motor");
if (!core) salir("El export no trae el CORE.");
if (!motor) salir("El export no trae el MOTOR.");
const marca = (man.generado ?? new Date().toISOString()).replace(/[-:]/g, "").replace("T", "_").slice(0, 13);
const escribir = (nombre, obj) => { const r = join(carpeta, nombre); writeFileSync(r, JSON.stringify(obj)); console.log("✔", r); return r; };

const coreJ = libroJson(core);
escribir(`EXPORT_CORE_${marca}.json`, {
  tipo: "EXPORT_CORE", generado: man.generado, libro: coreJ.titulo, zona_horaria: coreJ.zona_horaria, hojas: coreJ.hojas, faltantes: coreJ.faltantes,
});
escribir(`EXPORT_MOVIMIENTOS_${marca}.json`, { tipo: "EXPORT_MOVIMIENTOS", generado: man.generado, motor: libroJson(motor), core: coreJ });

const hist = libros.filter((l) => l.grupo === "historial");
if (hist.length) {
  escribir(`EXPORT_HISTORIAL_${marca}.json`, {
    tipo: "EXPORT_HISTORIAL", generado: man.generado,
    libros: Object.fromEntries(hist.map((l) => [l.codigo, { tipo: l.tipo, ...libroJson(l) }])),
    errores: man.errores ?? [],
  });
}
const paula = libros.filter((l) => l.grupo === "paula");
const operadoresBr = libros.find((l) => l.grupo === "brasil_operadores");
if (paula.length) {
  escribir(`EXPORT_BRASIL_${marca}.json`, {
    tipo: "EXPORT_BRASIL", generado: man.generado,
    // En el orden del manifiesto (del mes más antiguo al más reciente): el primero aporta el saldo inicial
    libros: paula.map((l) => ({ mes: l.mes, ...libroJson(l) })),
    // Brasil Operadores (APLICADOS, BANDEJA_BRASIL): qué se apropió y con qué BRS-; puede faltar
    operadores: operadoresBr ? libroJson(operadoresBr) : null,
  });
}
if (man.errores?.length) console.warn(`\nOJO: exportarCsv tuvo errores en: ${man.errores.map((e) => e.libro).join(", ")}`);
