// STW-27: pruebas de oro del cálculo. Recalcula cada movimiento aprobado del Motor (hoja MOVIMIENTOS)
// con la MISMA función de la base que usa la web (calcular_movimiento) y compara con lo que guardó el Motor.
//
// Uso (Supabase local encendido):
//   node scripts/pruebas-oro.mjs ../dev/datos/EXPORT_MOVIMIENTOS_....json
//   node scripts/pruebas-oro.mjs scripts/fixtures/movimientos-ejemplo.json      (ejemplo inventado)
// Deja el detalle de las diferencias en un CSV junto al archivo de entrada (dev/datos/ está fuera de git).
//
// Entradas de cada fila, tomadas del propio Motor (doc 02 §1.1): la tasa por su id (AF → TASAS_CLIENTE.G),
// la utilidad por su id (AI → UTILIDAD.D/E según modalidad), el beneficio por su id (AG → AJUSTES_CLIENTES.I),
// el descuento ×0,95 (AH), el −15 de AGENTE BCP en SOL (I) y el saldo anterior = saldo (V) de la fila
// anterior del mismo bucket (orden físico = orden de aprobación). Así cada fila se prueba por sí sola.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";

const archivo = process.argv[2];
if (!archivo) { console.error("Uso: node scripts/pruebas-oro.mjs <EXPORT_MOVIMIENTOS.json>"); process.exit(2); }
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const sb = createClient("http://127.0.0.1:54321", KEY, { auth: { persistSession: false } });
const { error: errLogin } = await sb.auth.signInWithPassword({ email: "admin@tasas.local", password: "Local123!" });
if (errLogin) { console.error("No se pudo entrar a Supabase LOCAL (¿npm run db:start?):", errLogin.message); process.exit(2); }

const exp = JSON.parse(readFileSync(archivo, "utf8"));
const hoja = (libro, n) => exp[libro]?.hojas?.[n]?.filas ?? [];
const MOV = hoja("motor", "MOVIMIENTOS");
if (MOV.length < 2) { console.error("El archivo no trae la hoja MOVIMIENTOS."); process.exit(2); }

const txt = (v) => (v == null ? "" : String(v).trim());
const num = (v) => {
  if (typeof v === "number") return v;
  const s = txt(v).replace(/\s/g, "");
  if (!s) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
};
const bool = (v) => v === true || /^(true|verdadero|si|sí|1)$/i.test(txt(v));
const porId = (filas, col = 0) => new Map(filas.slice(1).filter((f) => txt(f[col])).map((f) => [txt(f[col]), f]));

const tasas = porId(hoja("core", "TASAS_CLIENTE"));
const utilidades = porId(hoja("core", "UTILIDAD"));
const ajustes = porId(hoja("core", "AJUSTES_CLIENTES"));

// Columnas de MOVIMIENTOS (índice desde 0), doc 02 §1.1
const C = { id: 0, tipo: 3, modalidad: 7, recibido: 8, ct: 12, mo: 14, md: 15, monto: 16, tasa: 17, cop: 18, saldo: 21,
  tadq: 26, vadq: 27, util: 28, idTasa: 31, idBen: 32, desc: 33, idUtil: 34 };
const MARCAS = new Set(["UTILIDAD N/A", "CAMBIADA POR EL ADMIN"]);

const casos = [];
const ultimoSaldo = new Map();
const omitidas = { vacias: 0, sin_tasa: 0, sin_utilidad: 0 };
for (let i = 1; i < MOV.length; i++) {
  const f = MOV[i];
  if (!txt(f[C.id])) { omitidas.vacias++; continue; }
  const bucket = `${txt(f[C.ct])}|${txt(f[C.md]).toUpperCase()}|${txt(f[C.modalidad]).toUpperCase()}`;
  const saldoAnterior = ultimoSaldo.get(bucket) ?? 0;
  ultimoSaldo.set(bucket, num(f[C.saldo]) ?? saldoAnterior);

  const t = tasas.get(txt(f[C.idTasa]));
  const marca = txt(f[C.idUtil]).toUpperCase();
  const u = MARCAS.has(marca) ? null : utilidades.get(txt(f[C.idUtil]));
  const ben = ajustes.get(txt(f[C.idBen]));
  const caso = { fila: i + 1, id: txt(f[C.id]), f, saldoAnterior, marca: MARCAS.has(marca) ? marca : "" };
  if (!t) { omitidas.sin_tasa++; caso.sinTasa = txt(f[C.idTasa]) || "(vacío)"; casos.push(caso); continue; }
  const modalidad = txt(f[C.modalidad]).toUpperCase();
  caso.args = {
    p_tipo: txt(f[C.tipo]).toUpperCase(), p_monto_origen: num(f[C.monto]), p_moneda_origen: txt(f[C.mo]).toUpperCase(),
    p_moneda_destino: txt(f[C.md]).toUpperCase(),
    p_descuento_fijo: txt(f[C.recibido]).toUpperCase() === "AGENTE BCP" && txt(f[C.mo]).toUpperCase() === "SOL" ? 15 : 0,
    p_tasa_base: num(t[6]), p_beneficio: ben ? num(ben[8]) ?? 0 : 0,
    // Con marca de utilidad (corrección manual) se usa U = 0: la tasa, el monto y el saldo igual se comparan
    p_utilidad: u ? num(modalidad === "EFECTIVO" ? u[3] : u[4]) ?? 0 : 0,
    p_descuento_tasa: bool(f[C.desc]), p_saldo_anterior: saldoAnterior,
  };
  if (!u && !caso.marca) { omitidas.sin_utilidad++; caso.sinUtilidad = txt(f[C.idUtil]) || "(vacío)"; }
  casos.push(caso);
}

// Llamadas a la base en tandas
const conArgs = casos.filter((c) => c.args);
for (let i = 0; i < conArgs.length; i += 25) {
  await Promise.all(conArgs.slice(i, i + 25).map(async (c) => {
    const { data, error } = await sb.rpc("calcular_movimiento", c.args);
    if (error) c.error = error.message; else c.web = data;
  }));
  if (conArgs.length > 500 && i % 1000 === 0) process.stdout.write(`\r${i}/${conArgs.length}`);
}
if (conArgs.length > 500) process.stdout.write("\n");

const iguales = (a, b, tol) => a != null && b != null && Math.abs(Number(a) - Number(b)) <= tol;
const CAMPOS = [
  ["tasa aplicada (R)", C.tasa, "tasa_aplicada", (v) => 1e-9 * Math.max(1, Math.abs(v))],
  ["monto destino (S)", C.cop, "monto_destino", () => 0.005],
  ["saldo después (V)", C.saldo, "saldo_post", () => 0.005],
  ["tasa adquisición (AA)", C.tadq, "tasa_adquisicion", (v) => 1e-9 * Math.max(1, Math.abs(v))],
  ["utilidad (AC)", C.util, "utilidad", () => 0.01],
];
const resumen = Object.fromEntries(CAMPOS.map(([n]) => [n, { ok: 0, dif: 0 }]));
const difs = [];
let rechazos = 0, todoIgual = 0;
for (const c of casos) {
  if (!c.args) { difs.push([c.fila, c.id, "tasa no encontrada", c.sinTasa, "", ""]); continue; }
  if (c.error) { rechazos++; difs.push([c.fila, c.id, "la web lo rechazaría", "", "", c.error]); continue; }
  let todo = true;
  for (const [nombre, col, campo, tol] of CAMPOS) {
    if (c.marca && (campo === "utilidad" || campo === "tasa_adquisicion")) continue;   // corrección manual: no se compara
    if (c.sinUtilidad && (campo === "utilidad" || campo === "tasa_adquisicion")) continue;
    const motor = num(c.f[col]); const web = Number(c.web[campo]);
    if (iguales(motor, web, tol(Math.abs(web)))) resumen[nombre].ok++;
    else { resumen[nombre].dif++; todo = false; difs.push([c.fila, c.id, nombre, motor, web, (web - (motor ?? 0)).toFixed(6)]); }
  }
  if (todo) todoIgual++;
}

console.log(`\nMovimientos en el Motor: ${casos.length}   ·   iguales en todo: ${todoIgual}   ·   la web los rechazaría: ${rechazos}`);
console.log(`Omitidos: ${omitidas.vacias} filas vacías, ${omitidas.sin_tasa} sin su tasa en el CORE, ${omitidas.sin_utilidad} sin su utilidad (no se compara la utilidad)`);
console.log(`Con marca de utilidad manual (no se compara la utilidad): ${casos.filter((c) => c.marca).length}\n`);
for (const [n, r] of Object.entries(resumen)) console.log(`${r.dif ? "DIFERENCIA" : "OK        "} ${n.padEnd(24)} ${r.ok} iguales, ${r.dif} distintos`);

const salida = archivo.replace(/\.json$/i, "") + "_REPORTE_ORO.csv";
const csv = [["fila", "id_registro", "campo", "motor", "web", "diferencia"], ...difs]
  .map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
writeFileSync(salida, "﻿" + csv);
console.log(`\nDetalle: ${salida}`);
process.exit(difs.length ? 1 : 0);
