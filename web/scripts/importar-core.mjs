#!/usr/bin/env node
// STW-12: importa el CORE (export JSON de dev/diagnostico/exportarCore.js) a la base.
//
//   node scripts/importar-core.mjs <export.json>                       → simula en local (no guarda)
//   node scripts/importar-core.mjs <export.json> --aplicar             → guarda en local
//   node scripts/importar-core.mjs <export.json> --destino=prod        → simula en producción
//   node scripts/importar-core.mjs <export.json> --destino=prod --aplicar --confirmo-produccion
//
// - Todo en UNA transacción; sin --aplicar termina en ROLLBACK.
// - Cada fila va en su propio bloque: si falla, queda en el reporte con el motivo y sigue.
// - Repetible: catálogos se actualizan (upsert); tasas, utilidad y ajustes que ya existen no se tocan.
// - Columnas por posición según docs/web/02 §1.4–1.7; avisa si un encabezado no coincide.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith("--"));
const destino = (args.find((a) => a.startsWith("--destino=")) ?? "--destino=local").split("=")[1];
const aplicar = args.includes("--aplicar");
const salir = (m) => { console.error(`\n✖ ${m}\n`); process.exit(1); };

if (!archivo || !existsSync(archivo)) salir("Uso: node scripts/importar-core.mjs <export.json> [--destino=local|prod] [--aplicar]");
if (!["local", "prod"].includes(destino)) salir("--destino debe ser local o prod");
if (destino === "prod" && aplicar && !args.includes("--confirmo-produccion")) salir("Para guardar en producción agregue --confirmo-produccion.");

const exp = JSON.parse(readFileSync(archivo, "utf8"));
if (exp.tipo !== "EXPORT_CORE") salir("El archivo no es un export del CORE (exportarCore).");
const TZ = exp.zona_horaria || "America/Bogota";
const avisos = [];

// ---------------------------------------------------------------- utilidades
const lit = (v) => (v === null || v === undefined || v === "" ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const txt = (v) => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());
const activo = (v) => v === true || v === 1 || /^(TRUE|VERDADERO|SI|SÍ|ACTIVO|1)$/i.test(txt(v));
function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = txt(v).replace(/\s/g, "");
  if (!s) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
}
/** Número de serie de Sheets (días desde 1899-12-30, hora local del libro) → 'YYYY-MM-DD HH:MM:SS' local. */
function fechaLocal(v) {
  if (typeof v === "number" && v > 0) {
    const d = new Date(Math.round((v - 25569) * 86400) * 1000);
    return d.toISOString().slice(0, 19).replace("T", " ");
  }
  const m = txt(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")} ${(m[4] ?? "0").padStart(2, "0")}:${m[5] ?? "00"}:${m[6] ?? "00"}`;
  return null;
}
/** Número a literal SQL sin perder decimales ni usar notación científica (1e-7). */
const numSql = (n) => {
  const t = String(n);
  if (!/e/i.test(t)) return t;
  return n.toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
};
const ts = (local) => `(${lit(local)}::timestamp at time zone ${lit(TZ)})`;

function hoja(nombre, esperados) {
  const h = exp.hojas?.[nombre];
  if (!h) { avisos.push(`No viene la hoja ${nombre}`); return []; }
  const enc = (h.filas[0] ?? []).map((x) => txt(x).toUpperCase());
  for (const [col, palabra] of Object.entries(esperados)) {
    if (!(enc[col] ?? "").includes(palabra)) avisos.push(`${nombre}: la columna ${String.fromCharCode(65 + +col)} dice "${enc[col] ?? ""}" (se esperaba algo con "${palabra}")`);
  }
  return h.filas.slice(1).map((f, i) => ({ f, fila: i + 2 })).filter(({ f }) => f.some((c) => txt(c) !== ""));
}

const bloques = [];
/** Un bloque por fila: si falla, se anota y sigue. */
function fila(hojaN, n, clave, sql, contarComo = "ok") {
  bloques.push(`do $b$ declare k int; begin
  ${sql}
  get diagnostics k = row_count;
  insert into _rep values (${lit(hojaN)}, ${n}, ${lit(clave)}, case when k > 0 then ${lit(contarComo)} else 'ya existía' end, null);
exception when others then
  insert into _rep values (${lit(hojaN)}, ${n}, ${lit(clave)}, 'error', sqlerrm);
end $b$;`);
}
const descarte = (hojaN, n, clave, motivo) => bloques.push(`insert into _rep values (${lit(hojaN)}, ${n}, ${lit(clave)}, 'descartada', ${lit(motivo)});`);

// ---------------------------------------------------------------- catálogos (docs/web/02 §1.7)
const monedas = new Set();
for (const { f, fila: n } of hoja("MONEDAS", { 1: "CODIGO" })) {
  const id = txt(f[0]), nombre = txt(f[1]).toUpperCase();
  if (!id || !nombre) { descarte("MONEDAS", n, id, "sin id o nombre"); continue; }
  monedas.add(nombre);
  fila("MONEDAS", n, id, `insert into public.moneda (id, nombre, activo, orden) values (${lit(id)}, ${lit(nombre)}, ${activo(f[3])}, ${num(f[4]) ?? "null"})
    on conflict (id) do update set nombre = excluded.nombre, activo = excluded.activo, orden = excluded.orden;`);
}
for (const { f, fila: n } of hoja("EMPRESAS", { 1: "NOMBRE" })) {
  const id = txt(f[0]);
  if (!id || !txt(f[1])) { descarte("EMPRESAS", n, id, "sin id o nombre"); continue; }
  fila("EMPRESAS", n, id, `insert into public.empresa (id, nombre, activo, orden) values (${lit(id)}, ${lit(txt(f[1]))}, ${activo(f[4])}, ${num(f[5]) ?? "null"})
    on conflict (id) do update set nombre = excluded.nombre, activo = excluded.activo, orden = excluded.orden;`);
}
for (const { f, fila: n } of hoja("RECIBIDO_EN", { 1: "NOMBRE" })) {
  const id = txt(f[0]), nombre = txt(f[1]);
  if (!id || !nombre) { descarte("RECIBIDO_EN", n, id, "sin id o nombre"); continue; }
  const bcp = /^AGENTE\s+BCP$/i.test(nombre); // P-4 / P-36: −15 solo en SOL
  fila("RECIBIDO_EN", n, id, `insert into public.recibido_en (id, nombre, activo, orden, descuento_fijo, descuento_moneda)
    values (${lit(id)}, ${lit(nombre)}, ${activo(f[5])}, ${num(f[6]) ?? "null"}, ${bcp ? 15 : 0}, ${bcp ? "'SOL'" : "null"})
    on conflict (id) do update set nombre = excluded.nombre, activo = excluded.activo, orden = excluded.orden
      ${bcp ? ", descuento_fijo = 15, descuento_moneda = 'SOL'" : ""};`);
}
const contrapartes = new Set();
for (const { f, fila: n } of hoja("CLIENTES_ALIADOS", { 2: "NOMBRE" })) {
  const id = txt(f[0]).toUpperCase().replace(/\s/g, ""), tipo = txt(f[1]).toUpperCase(), nombre = txt(f[2]);
  if (!/^CT-\d+$/.test(id)) { descarte("CLIENTES_ALIADOS", n, id, "el id no tiene la forma CT-nn"); continue; }
  if (!["CLIENTE", "ALIADO"].includes(tipo)) { descarte("CLIENTES_ALIADOS", n, id, `tipo "${tipo}" no es CLIENTE ni ALIADO`); continue; }
  if (!nombre) { descarte("CLIENTES_ALIADOS", n, id, "sin nombre"); continue; }
  contrapartes.add(id);
  fila("CLIENTES_ALIADOS", n, id, `insert into public.contraparte (id, tipo, nombre, activo) values (${lit(id)}, ${lit(tipo)}, ${lit(nombre)}, ${activo(f[4])})
    on conflict (id) do update set tipo = excluded.tipo, nombre = excluded.nombre, activo = excluded.activo;`);
}

// Contraparte fija de cada cliente grande (prod/cliente-*/enviarOperador.js, columna N)
const LIBRO_CT = { COMNORTE: "CT-70", DIANA: "CT-02", GLOBAL_BRIDGE: "CT-184", JULIAN_GOMEZ: "CT-69", JARAMILLO: "CT-45",
  LUCAS_ALZATE: "CT-72", SURCARIBE: "CT-71", TURISMOJG: "CT-155", VALERIA_ROJAS: "CT-73" };
for (const [libro, ct] of Object.entries(LIBRO_CT)) {
  if (!contrapartes.has(ct)) { descarte("LIBROS", 0, libro, `${ct} no está en CLIENTES_ALIADOS`); continue; }
  fila("LIBROS", 0, libro, `update public.libro set contraparte_id = ${lit(ct)} where codigo = ${lit(libro)} and contraparte_id is distinct from ${lit(ct)};`, "ok");
}

// ---------------------------------------------------------------- tasas (§1.4), utilidad (§1.5), ajustes (§1.6)
// El CORE repite ids en filas distintas (p. ej. TB-000130 para BS→COP efectivo y transferencia).
// La primera conserva el id; las siguientes reciben "-2", "-3"… (convención ya usada a mano: TB-101802-2).
function idsUnicos(filas) {
  const todos = new Set(filas.map(({ f }) => txt(f[0])));
  const usados = new Set(), mapa = new Map();
  for (const { f, fila: n } of filas) {
    const id = txt(f[0]);
    if (!id || !usados.has(id)) { usados.add(id); mapa.set(n, id); continue; }
    let k = 2; while (todos.has(`${id}-${k}`) || usados.has(`${id}-${k}`)) k++;
    usados.add(`${id}-${k}`); mapa.set(n, `${id}-${k}`);
  }
  return mapa;
}
const notaId = (orig, nuevo) => (orig === nuevo ? "ok" : `ok · id repetido en el CORE: ${orig} → ${nuevo}`);
const parOk = (hojaN, n, clave, o, d) => {
  if (!monedas.has(o) || !monedas.has(d)) { descarte(hojaN, n, clave, `moneda desconocida (${o} → ${d})`); return false; }
  return true;
};
// "La primera fila gana" (doc 02 §3.3–3.4): el Motor recorre la hoja en orden y usa la primera fila
// vigente. Si una fila publicada se cruza con otra anterior del mismo par, aquí se publica SOLO la parte
// de su vigencia que nadie cubría antes (en 1 o 2 pedazos: id, id-T2…). Si queda tapada del todo, entra
// como borrador (MODIFICABLE): no se pierde y el Motor web nunca la usa, igual que hoy.
// Tiempos en microsegundos de hora local del libro; los extremos son inclusivos.
const US = (local) => Date.parse(local.replace(" ", "T") + "Z") * 1000;
function localDeUs(us) {
  const ms = Math.floor(us / 1000), micro = us - ms * 1000;
  return new Date(ms).toISOString().slice(0, 23).replace("T", " ") + String(micro).padStart(3, "0");
}
const publicadas = new Map(); // llave → [[desdeUs, hastaUs], …] ya publicados
function partesLibres(llave, d, h) {
  let partes = [[d, h]];
  for (const [a, b] of publicadas.get(llave) ?? []) {
    partes = partes.flatMap(([x, y]) => {
      if (b < x || a > y) return [[x, y]];
      const r = [];
      if (x < a) r.push([x, a - 1]);
      if (b < y) r.push([b + 1, y]);
      return r;
    });
  }
  return partes;
}
function publicar(llave, partes) {
  publicadas.set(llave, [...(publicadas.get(llave) ?? []), ...partes]);
}
const rangoSql = ([d, h]) => `tstzrange(${ts(localDeUs(d))}, ${ts(localDeUs(h))}, '[]')`;
const fechaCorta = (us) => localDeUs(us).slice(0, 19);

/** Devuelve [{id, rango, estado, nota}] para insertar, aplicando "la primera fila gana". */
function piezas(llave, id, orig, desde, hasta, estado) {
  const d = US(desde), h = US(hasta);
  const base = notaId(orig, id);
  if (estado !== "CERRADO") return [{ id, rango: rangoSql([d, h]), estado, nota: base }];
  const libres = partesLibres(llave, d, h);
  if (!libres.length) {
    return [{ id, rango: rangoSql([d, h]), estado: "MODIFICABLE",
      nota: `${base} · tapada por una fila anterior del mismo par: entra como borrador` }];
  }
  publicar(llave, libres);
  const recortada = libres.length !== 1 || libres[0][0] !== d || libres[0][1] !== h;
  return libres.map((rg, i) => ({
    id: i === 0 ? id : `${id}-T${i + 1}`, rango: rangoSql(rg), estado: "CERRADO",
    nota: recortada ? `${base} · cruzaba con una fila anterior: publicada solo ${fechaCorta(rg[0])} → ${fechaCorta(rg[1])}` : base,
  }));
}
const resultadoDe = (nota) => nota;

const filasTasas = hoja("TASAS_CLIENTE", { 4: "DESDE", 5: "HASTA", 7: "ESTADO" });
const idTasa = idsUnicos(filasTasas);
for (const { f, fila: n } of filasTasas) {
  const orig = txt(f[0]), id = idTasa.get(n), o = txt(f[1]).toUpperCase(), d = txt(f[2]).toUpperCase(), mod = txt(f[3]).toUpperCase();
  const desde = fechaLocal(f[4]), hasta = fechaLocal(f[5]), valor = num(f[6]), estado = txt(f[7]).toUpperCase() === "CERRADO" ? "CERRADO" : "MODIFICABLE";
  if (!/^TB-\d+(-\d+)?$/.test(id)) { descarte("TASAS_CLIENTE", n, orig, "el id no tiene la forma TB-nnnnnn"); continue; }
  if (!parOk("TASAS_CLIENTE", n, id, o, d)) continue;
  if (!["EFECTIVO", "TRANSFERENCIA"].includes(mod)) { descarte("TASAS_CLIENTE", n, id, `modalidad "${mod}" (solo EFECTIVO/TRANSFERENCIA, P-6)`); continue; }
  if (!desde || !hasta || US(desde) >= US(hasta)) { descarte("TASAS_CLIENTE", n, id, "vigencia sin fechas válidas (desde debe ser menor que hasta)"); continue; }
  if (valor === null || valor <= 0) { descarte("TASAS_CLIENTE", n, id, "valor vacío o no positivo"); continue; }
  for (const pz of piezas(`${o}|${d}|${mod}`, id, orig, desde, hasta, estado)) {
    fila("TASAS_CLIENTE", n, pz.id, `insert into public.tasa_cliente (id, moneda_origen, moneda_destino, modalidad, vigencia, valor, estado)
    values (${lit(pz.id)}, ${lit(o)}, ${lit(d)}, ${lit(mod)}, ${pz.rango}, ${numSql(valor)}, ${lit(pz.estado)})
    on conflict (id) do update set valor = excluded.valor
      where tasa_cliente.valor <> excluded.valor and round(tasa_cliente.valor, 6) = round(excluded.valor, 6);`,
      resultadoDe(pz.nota));  // si ya existía con el valor redondeado (migración 1000), le devuelve los decimales
  }
}
const filasUtil = hoja("UTILIDAD", { 3: "EFECTIVO", 4: "TRANSFERENCIA" });
const idUtil = idsUnicos(filasUtil);
for (const { f, fila: n } of filasUtil) {
  const orig = txt(f[0]), id = idUtil.get(n), o = txt(f[1]).toUpperCase(), d = txt(f[2]).toUpperCase();
  const pe = num(f[3]), pt = num(f[4]), desde = fechaLocal(f[5]), hasta = fechaLocal(f[6]);
  if (!id) { descarte("UTILIDAD", n, id, "sin id"); continue; }
  if (!parOk("UTILIDAD", n, id, o, d)) continue;
  if (pe === null || pt === null) { descarte("UTILIDAD", n, id, "puntos vacíos"); continue; }
  if (!desde || !hasta || US(desde) >= US(hasta)) { descarte("UTILIDAD", n, id, "vigencia sin fechas válidas (desde debe ser menor que hasta)"); continue; }
  // La hoja no tiene estado y el Motor la usa siempre: entra publicada (con la regla de la primera fila)
  for (const pz of piezas(`${o}|${d}`, id, orig, desde, hasta, "CERRADO")) {
    fila("UTILIDAD", n, pz.id, `insert into public.tasa_utilidad (id, moneda_origen, moneda_destino, puntos_efectivo, puntos_transferencia, vigencia, estado)
    values (${lit(pz.id)}, ${lit(o)}, ${lit(d)}, ${pe}, ${pt}, ${pz.rango}, ${lit(pz.estado)})
    on conflict (id) do nothing;`, resultadoDe(pz.nota));
  }
}
// Ajustes: si hay varios ACTIVO con la misma llave, gana el último (como el Motor, doc 02 §3.5)
const ajustes = hoja("AJUSTES_CLIENTES", { 1: "ESTADO", 8: "BENEFICIO" });
const ultimoActivo = new Map();
for (const a of ajustes) {
  const k = [txt(a.f[2]).toUpperCase(), txt(a.f[5]).toUpperCase(), txt(a.f[6]).toUpperCase()].join("|");
  if (activo(a.f[1])) ultimoActivo.set(k, a.fila);
}
const idAj = idsUnicos(ajustes);
for (const { f, fila: n } of ajustes) {
  const orig = txt(f[0]), id = idAj.get(n), ct = txt(f[2]).toUpperCase().replace(/\s/g, ""), o = txt(f[5]).toUpperCase(), d = txt(f[6]).toUpperCase(), ben = num(f[8]);
  if (!id) { descarte("AJUSTES_CLIENTES", n, id, "sin id"); continue; }
  if (!contrapartes.has(ct)) { descarte("AJUSTES_CLIENTES", n, id, `contraparte ${ct} no está en CLIENTES_ALIADOS`); continue; }
  if (!parOk("AJUSTES_CLIENTES", n, id, o, d)) continue;
  if (ben === null) { descarte("AJUSTES_CLIENTES", n, id, "beneficio vacío"); continue; }
  const esActivo = activo(f[1]) && ultimoActivo.get([ct, o, d].join("|")) === n;
  const nota = activo(f[1]) && !esActivo ? "activo repetido: gana el último; este entra inactivo" : null;
  fila("AJUSTES_CLIENTES", n, id, `insert into public.ajuste_cliente (id, contraparte_id, moneda_origen, moneda_destino, beneficio, activo, vigencia)
    values (${lit(id)}, ${lit(ct)}, ${lit(o)}, ${lit(d)}, ${ben}, ${esActivo}, tstzrange('-infinity', 'infinity', '[]'))
    on conflict (id) do nothing;`, nota ? "ok · activo repetido: gana el último, este entra inactivo" : notaId(orig, id));
}

// ---------------------------------------------------------------- SQL completo
const sql = `\\set ON_ERROR_STOP on
begin;
create temp table _rep (hoja text, fila int, clave text, resultado text, detalle text);
${bloques.join("\n")}
-- Las secuencias siguen después del mayor id importado
select setval('public.tasa_cliente_seq', greatest(1, coalesce((select max(substring(id from '^TB-(\\d+)$')::int) from public.tasa_cliente), 0)));
select setval('public.tasa_utilidad_seq', greatest(1, coalesce((select max(substring(id from '^UT-(\\d+)$')::int) from public.tasa_utilidad), 0)));
select setval('public.ajuste_cliente_seq', greatest(1, coalesce((select max(substring(id from '^AJ-(\\d+)$')::int) from public.ajuste_cliente), 0)));
\\echo ===RESUMEN
select hoja, resultado, count(*) from _rep group by 1, 2 order by 1, 2;
\\echo ===DETALLE
select hoja, fila, clave, resultado, coalesce(detalle, '') from _rep where resultado not in ('ok', 'ya existía') order by 1, 2;
${aplicar ? "commit;" : "rollback;"}
`;

// ---------------------------------------------------------------- ejecutar (psql del contenedor local de Supabase)
// --db=<nombre>: otra base del Supabase LOCAL (p. ej. una de ensayo de la migración), sin tocar la de desarrollo
const dbLocal = (args.find((a) => a.startsWith("--db=")) ?? "--db=postgres").split("=")[1];
// --contenedor=<nombre>: otro Supabase LOCAL (p. ej. el de datos reales de scripts/reales.mjs); por defecto el de desarrollo
const CONTENEDOR = (process.argv.slice(2).find((a) => a.startsWith("--contenedor=")) ?? "--contenedor=supabase_db_web").split("=")[1];
if (!/^[a-z0-9_]+$/.test(CONTENEDOR)) { console.error("--contenedor no válido"); process.exit(1); }
if (!/^[a-z_][a-z0-9_]*$/.test(dbLocal)) salir("--db no válido");
let destinoPsql = ["-U", "postgres", "-d", dbLocal];
if (destino === "prod") {
  const env = join(WEB, ".env.entornos.local");
  const url = existsSync(env) ? (readFileSync(env, "utf8").match(/^SUPABASE_DB_URL_PROD=(.+)$/m)?.[1] ?? "").trim() : "";
  if (!url) salir("Falta SUPABASE_DB_URL_PROD en web/.env.entornos.local");
  destinoPsql = [url];
}
const r = spawnSync("docker", ["exec", "-i", CONTENEDOR, "psql", ...destinoPsql, "-q", "-tA", "-F", "\t"], { input: sql, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (r.status !== 0) salir("psql falló:\n" + (r.stderr || r.stdout));

const salida = r.stdout.split("\n");
const iR = salida.indexOf("===RESUMEN"), iD = salida.indexOf("===DETALLE");
console.log(`Export: ${exp.libro} (${exp.generado}) · zona ${TZ} · destino ${destino} · ${aplicar ? "GUARDADO" : "SIMULACIÓN (no se guardó nada)"}`);
if (exp.faltantes?.length) console.log("Hojas que no venían: " + exp.faltantes.join(", "));
for (const a of avisos) console.log("Aviso: " + a);
console.log("\nResumen (hoja · resultado · filas):");
for (const l of salida.slice(iR + 1, iD).filter(Boolean)) console.log("  " + l.replace(/\t/g, " · "));
const detalle = salida.slice(iD + 1).filter((l) => l.includes("\t"));
if (detalle.length) {
  console.log(`\nFilas no importadas o con nota (${detalle.length}):`);
  for (const l of detalle.slice(0, 200)) { const [h, f, k, res, det] = l.split("\t"); console.log(`  ${h} fila ${f} [${k}] ${res}: ${det}`); }
  if (detalle.length > 200) console.log(`  … y ${detalle.length - 200} más`);
}
if (!aplicar) console.log("\nPara guardar, repita con --aplicar" + (destino === "prod" ? " --confirmo-produccion" : "") + ".");
