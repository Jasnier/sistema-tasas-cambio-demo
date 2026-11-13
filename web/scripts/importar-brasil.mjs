#!/usr/bin/env node
// Importa el historial de Brasil (libros de Paula, uno por mes) a comprobante_brasil. SOLO bases LOCALES (el entorno de
// datos reales de scripts/reales.mjs o la de desarrollo): no tiene modo producción.
//
//   node scripts/importar-brasil.mjs <EXPORT_BRASIL.json> [--contenedor=…] [--db=…]            → simula (ROLLBACK)
//   node scripts/importar-brasil.mjs <EXPORT_BRASIL.json> … --aplicar                          → guarda
//
// Corre DESPUÉS de importar-historial (usa los movimientos BRS- del Motor para saber qué se apropió).
// Reglas (docs/web/03 §Brasil; prod/brasil-paula: Código.js, base.js, resumenBinance.js):
//  - Una hoja por banco (banco_brasil.hoja_origen). Fila 1 = encabezado. A fecha · B id transacción · C remitente ·
//    D observación · E entrada · F salida (BRL). RESUMEN, BINANCE y hojas sin banco en la web no se importan.
//  - "saldo inicial" en C o D → clase SALDO_INICIAL, SOLO del primer mes (la web calcula los siguientes).
//  - "binance" en D con una tasa en C → clase BINANCE (venta; salida con su tasa). Sin tasa → salida normal.
//  - Sin fecha o sin entrada ni salida: fila vacía, se omite. Id repetido en el mismo banco: se carga el primero.
//  - Entrada sin id de transacción (Paula la anota del extracto y pone el id después, o "SIN SOPORTE" cuando no sabe de
//    qué cliente es): SÍ cuenta en la caja, como en el RESUMEN de Sheets. Entra con un id provisional
//    SIN-ID-<mes>-F<fila> y queda pendiente de apropiar.
//  - Apropiado: por el BRS- de Brasil Operadores (si vino en el export) o por el movimiento BRS- del Motor con el
//    mismo id de transacción → APLICADO con su movimiento, libro, cliente, modalidad y monedas.
//  - Fechas mal escritas: si el id PIX dice otro año/mes con el MISMO día (3-dic por 3-nov, 2025 por 2026, jun por
//    jul) o la fecha es imposible, se toman año y mes del id PIX; las filas sin id con esa misma fecha en la hoja, igual.
//  - Cada libro aporta SOLO su mes: las filas del mes siguiente (Paula seguía anotando en el libro viejo) ya están en el
//    libro de ese mes y se ignoran; las de meses anteriores se ignoran si ya vinieron de un libro anterior (DON ARSENIO
//    repetido en noviembre). Así la caja no se infla. El código BR-<banco>-NNNNN lo pone la web, en orden de mes, hoja y fila.
// Deja un reporte <archivo>_REPORTE_BRASIL.csv con cada fila omitida o marcada y el motivo.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith("--"));
const aplicar = args.includes("--aplicar");
const opcion = (n, d) => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split("=").slice(1).join("=");
const CONTENEDOR = opcion("contenedor", "supabase_db_web");
const DB = opcion("db", "postgres");
const salir = (m) => { console.error(`\n✖ ${m}\n`); process.exit(1); };
if (!archivo || !existsSync(archivo)) salir("Uso: node scripts/importar-brasil.mjs <EXPORT_BRASIL.json> [--contenedor=…] [--db=…] [--aplicar]");
if (!/^[a-z0-9_]+$/.test(CONTENEDOR) || !/^[a-z_][a-z0-9_]*$/.test(DB)) salir("--contenedor o --db no válido");
if (args.some((a) => a.startsWith("--destino=") && !a.endsWith("=local"))) salir("Este importador es solo para bases locales.");
const exp = JSON.parse(readFileSync(archivo, "utf8"));
if (exp.tipo !== "EXPORT_BRASIL") salir("El archivo no es un EXPORT_BRASIL (scripts/csv-a-json.mjs).");

function psql(sql) {
  const r = spawnSync("docker", ["exec", "-i", CONTENEDOR, "psql", "-U", "postgres", "-d", DB, "-v", "ON_ERROR_STOP=1", "-qtA", "-F", "\t"],
    { input: sql, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) salir("psql falló:\n" + (r.stderr || r.stdout));
  return r.stdout;
}

// ---------------------------------------------------------------- utilidades
const txt = (v) => (v === null || v === undefined ? "" : typeof v === "number" ? numTexto(v) : String(v).replace(/\s+/g, " ").trim());
// Un id de transacción que Sheets guardó como número: sin notación científica ni decimales de más
function numTexto(n) { return Number.isInteger(n) ? BigInt(Math.round(n)).toString() : String(n); }
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
/** "R$ 1.234,56", "1234.56", 1234.56 → 1234.56 */
function dinero(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = txt(v).replace(/R\$|\s/gi, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
/** Número de serie de Sheets o texto dd/mm/aaaa → "aaaa-mm-dd" */
function fecha(v) {
  if (typeof v === "number" && v > 1) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const m = txt(v).match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) { const a = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${a}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  const iso = txt(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
}
const lit = (v) => (v === null || v === undefined || v === "" ? "null" : `'${String(v).replace(/'/g, "''")}'`);

// ---------------------------------------------------------------- bancos de la web
const bancos = new Map(psql("select id, hoja_origen from public.banco_brasil where hoja_origen is not null;").trim().split("\n")
  .filter(Boolean).map((l) => { const [id, hoja] = l.split("\t"); return [norm(hoja), id]; }));
if (!bancos.size) salir("banco_brasil no tiene hoja_origen: ¿la base tiene la migración 0700?");

// ---------------------------------------------------------------- Brasil Operadores: id de transacción → BRS-
const brsPorIdTx = new Map();   // "banco|idtx" y "idtx" → BRS-…
const op = exp.operadores;
for (const nombre of ["APLICADOS", "BANDEJA_BRASIL"]) {
  for (const f of (op?.hojas?.[nombre]?.filas ?? []).slice(1)) {
    const estado = norm(f[9]), brs = txt(f[15]), idtx = txt(f[4]).toLowerCase();
    if (estado !== "APLICADO" || !/^BRS-/i.test(brs) || !idtx) continue;
    if (!brsPorIdTx.has(idtx)) brsPorIdTx.set(idtx, brs.toUpperCase());
  }
}

// ---------------------------------------------------------------- filas
const reporte = [["mes", "hoja", "fila", "motivo", "detalle"]];
const nota = (mes, hoja, fila, motivo, detalle = "") => reporte.push([mes, hoja, fila, motivo, detalle]);
const filas = [];
const vistos = new Map();   // banco|id → valor de la primera fila con ese id
const hoy = new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);   // Bogotá
const hojasSinBanco = new Set();

// Fechas mal escritas en Sheets (2026-12-03 por 2026-11-03, 2025-06-12 por 2026-06-12, 2026-06-03 por 2026-07-03). El id
// PIX (E + 8 dígitos del banco + aaaaMMddHHmm en UTC) trae la fecha real. Se corrige año y mes (conservando el día) si:
//  - la fecha es imposible (futura o anterior al mes previo al primer libro), o
//  - la fecha cae fuera del mes de su libro y el id PIX, con el MISMO día, la devuelve a ese mes (2026-06-03 en el
//    libro de julio con PIX del 2026-07-03). Si la fecha ya está en el mes del libro se respeta: a veces el que está mal
//    tecleado es el id (fila del 20-ago con PIX del 20-sep, rodeada de filas del 20-ago y ausente del libro de septiembre).
// Las filas sin id PIX (Binance, pendientes) con la MISMA fecha mala en la misma hoja reciben la misma corrección.
const primerMes = exp.libros.map((l) => l.mes).filter((m) => /^\d{4}-\d{2}$/.test(m)).sort()[0];
const desdeValida = primerMes ? new Date(Date.UTC(+primerMes.slice(0, 4), +primerMes.slice(5, 7) - 2, 1)).toISOString().slice(0, 10) : "2000-01-01";
const imposible = (fe) => fe > hoy || fe < desdeValida;
const correcciones = new Map();   // "mes|hoja|fecha mala" → fecha corregida
/** Fecha corregida por el id PIX de la fila, o null si no aplica. */
function porPix(fe, idtx, mesLibro) {
  const pix = txt(idtx).match(/^E\d{8}(20\d{2})(\d{2})(\d{2})/i);
  if (!fe || !pix || `${pix[1]}-${pix[2]}` === fe.slice(0, 7)) return null;
  if (!imposible(fe) && (fe.slice(0, 7) === mesLibro || `${pix[1]}-${pix[2]}` !== mesLibro || pix[3] !== fe.slice(8, 10))) return null;
  const nueva = `${pix[1]}-${pix[2]}-${fe.slice(8, 10)}`;
  return !imposible(nueva) && new Date(`${nueva}T00:00:00Z`).toISOString().slice(0, 10) === nueva ? nueva : null;
}
for (const libro of exp.libros) {
  for (const [clave, h] of Object.entries(libro.hojas)) {
    for (const f of h.filas.slice(1)) {
      const fe = fecha(f[0]), nueva = porPix(fe, f[1], libro.mes);
      if (nueva) correcciones.set(`${libro.mes}|${h.nombre_real ?? clave}|${fe}`, nueva);
    }
  }
}
// Un libro por mes: lo de otro mes se ignora si ese mes ya tiene (o tendrá) su libro con esas filas
const mesesConLibro = new Set(exp.libros.map((l) => l.mes));
const yaCargadas = new Map();   // "hoja|fecha|tipo|valor" → cuántas vinieron de libros anteriores
const claveRep = (hoja, fe, tipo, valor) => `${norm(hoja)}|${fe}|${tipo}|${Math.round(valor * 100)}`;

exp.libros.forEach((libro, iLibro) => {
  const pendientesRep = [];   // lo que este libro carga: cuenta como "ya vino" para los libros siguientes
  for (const [clave, h] of Object.entries(libro.hojas)) {
    const real = h.nombre_real ?? clave;
    const banco = bancos.get(norm(real));
    if (!banco) { if (!/^(RESUMEN|BINANCE)$/.test(norm(real))) hojasSinBanco.add(real); continue; }
    h.filas.slice(1).forEach((f, i) => {
      const n = i + 2;
      let fe = fecha(f[0]);
      const entrada = dinero(f[4]) ?? 0, salida = dinero(f[5]) ?? 0;
      // "SIN ID", "SIN SOPORTE", "N/A", "-": Paula deja el id para después; es una fila sin id, no un id repetido
      const idtx = /^(sin\s*id|sin\s*soporte|n\/?a|-+|0)$/i.test(txt(f[1])) ? "" : txt(f[1]), remitente = txt(f[2]), obs = txt(f[3]);
      const corregida = porPix(fe, f[1], libro.mes) ?? (fe && !/^E\d{8}20/i.test(txt(f[1])) || imposible(fe ?? "") ? correcciones.get(`${libro.mes}|${real}|${fe}`) : null);
      if (corregida) { nota(libro.mes, real, n, "corregida", `fecha ${fe} → ${corregida} (año y mes del id PIX)`); fe = corregida; }
      if (!fe || (!entrada && !salida)) { if (fe || entrada || salida || idtx || remitente) nota(libro.mes, real, n, "omitida", "sin fecha o sin entrada ni salida"); return; }
      if (entrada < 0 || salida < 0) { nota(libro.mes, real, n, "omitida", `valor negativo (${entrada || salida})`); return; }
      if (entrada && salida) nota(libro.mes, real, n, "aviso", "tiene entrada y salida: se toma la entrada");
      let tipo = entrada ? "ENTRADA" : "SALIDA", valor = entrada || salida;
      const mesFila = fe.slice(0, 7), kRep = claveRep(real, fe, tipo, valor);
      if (mesFila > libro.mes && mesesConLibro.has(mesFila)) { nota(libro.mes, real, n, "omitida", `es de ${mesFila}: ya está en el libro de ese mes`); return; }
      if (mesFila < libro.mes && (yaCargadas.get(kRep) ?? 0) > 0 && !/saldo\s+inicial/i.test(`${remitente} ${obs}`)) {
        yaCargadas.set(kRep, yaCargadas.get(kRep) - 1);
        nota(libro.mes, real, n, "omitida", `es de ${mesFila} y ya vino en un libro anterior`); return;
      }
      let clase = "COMPROBANTE", tasa = null;
      const texto = `${remitente} ${obs}`;
      if (/saldo\s+inicial/i.test(texto)) {
        if (iLibro > 0) { nota(libro.mes, real, n, "omitida", "saldo inicial de un mes que no es el primero (la web lo calcula)"); return; }
        if (tipo !== "ENTRADA") { nota(libro.mes, real, n, "omitida", "saldo inicial negativo: la web no lo admite, revisar"); return; }
        clase = "SALDO_INICIAL";
      } else if (/binance/i.test(obs)) {
        const t = remitente.match(/(\d+[.,]?\d*)/);
        const tasaN = t ? Number(t[1].replace(",", ".")) : null;
        if (tipo === "SALIDA" && tasaN > 0) { clase = "BINANCE"; tasa = tasaN; }
        else nota(libro.mes, real, n, "aviso", "dice Binance pero sin tasa o no es salida: queda como comprobante");
      }
      let idFinal = idtx;
      if (clase === "COMPROBANTE" && tipo === "ENTRADA" && !idtx) {
        idFinal = `SIN-ID-${libro.mes}-F${n}`;
        nota(libro.mes, real, n, "aviso", `entrada sin id de transacción: se carga con el id provisional ${idFinal}`);
      }
      if (idtx && clase === "COMPROBANTE") {
        // Mismo id y mismo valor: la misma transferencia anotada dos veces → se omite. Mismo id con OTRO valor: es otra
        // transferencia a la que Paula le copió el id de la de arriba → entra con id provisional y queda para revisar.
        const k = `${banco}|${idtx.toLowerCase()}`, previo = vistos.get(k);
        if (previo !== undefined && Math.abs(previo - valor) < 0.005) { nota(libro.mes, real, n, "omitida", `id de transacción repetido en el banco: ${idtx}`); return; }
        if (previo !== undefined) {
          idFinal = `${idtx}-F${n}`;
          nota(libro.mes, real, n, "aviso", `id ${idtx} copiado de otra fila con otro valor: entra como ${idFinal} (corregir el id en Sheets)`);
        } else vistos.set(k, valor);
      }
      if (fe && imposible(fe)) nota(libro.mes, real, n, "aviso", `fecha imposible (${fe}) sin id PIX para corregirla: se carga como está en Sheets`);
      pendientesRep.push(kRep);
      filas.push({ orden: filas.length + 1, mes: libro.mes, hoja: real, fila: n, banco, fecha: fe, idtx: idFinal || null, remitente: remitente || null,
        obs: obs || null, tipo, valor: Math.round(valor * 100) / 100, clase, tasa, brs: idtx ? brsPorIdTx.get(idtx.toLowerCase()) ?? null : null });
    });
  }
  for (const k of pendientesRep) yaCargadas.set(k, (yaCargadas.get(k) ?? 0) + 1);
});
for (const h of hojasSinBanco) nota("", h, "", "hoja omitida", "no hay un banco con esa hoja en la web (banco_brasil.hoja_origen)");

// ---------------------------------------------------------------- SQL
const valores = filas.map((r) => `(${r.orden},${lit(r.mes)},${lit(r.hoja)},${r.fila},${lit(r.banco)},${lit(r.fecha)},${lit(r.idtx)},${lit(r.remitente)},${lit(r.obs)},`
  + `${lit(r.tipo)},${r.valor},${lit(r.clase)},${r.tasa ?? "null"},${lit(r.brs)})`);
const sql = `
begin;
create temp table stg (orden int, mes text, hoja text, fila int, banco text, fecha date, idtx text, remitente text, obs text,
  tipo text, valor numeric, clase text, tasa numeric, brs text) on commit drop;
${valores.length ? `insert into stg values\n${valores.join(",\n")};` : ""}
-- Carga histórica: sin auditoría fila a fila ni el bloqueo de fechas futuras (errores de Sheets que se reportan)
alter table public.comprobante_brasil disable trigger aud_comprobante_brasil;
alter table public.comprobante_brasil disable trigger validar_fecha_comprobante;

-- Repetible: lo que ya está (mismo banco e id, o misma fila sin id) no se vuelve a cargar
create temp table nuevos on commit drop as
select s.* from stg s
 where not exists (select 1 from public.comprobante_brasil c where c.banco_id = s.banco and (
         (s.idtx is not null and s.clase = 'COMPROBANTE' and lower(btrim(c.id_tx)) = lower(btrim(s.idtx)))
      or (c.fecha = s.fecha and c.tipo::text = s.tipo and c.valor = s.valor and c.clase::text = s.clase
          and coalesce(c.remitente, '') = coalesce(s.remitente, '') and coalesce(c.observacion, '') = coalesce(s.obs, ''))))
 order by s.orden;

-- Movimiento BRS- de cada comprobante: por el BRS- de Brasil Operadores, o por el id de transacción si es único
create temp table enlace on commit drop as
with por_id as (
  select n.orden, m.id, m.codigo, count(*) over (partition by n.orden) as cuantos
    from nuevos n join public.movimiento m on m.codigo like 'BRS-%' and n.idtx is not null
     and lower(btrim(m.id_transaccion)) = lower(btrim(n.idtx))
   where n.clase = 'COMPROBANTE' and n.brs is null)
select n.orden, coalesce(n.brs, p.codigo) as brs, coalesce(mb.id, p.id) as mov
  from nuevos n
  left join public.movimiento mb on mb.codigo = n.brs
  left join por_id p on p.orden = n.orden and p.cuantos = 1
 where n.brs is not null or p.id is not null;
-- Un movimiento BRS- solo puede ser de un comprobante (codigo_brs es único): el primero se lo queda
delete from enlace e where exists (select 1 from enlace o where o.brs = e.brs and o.orden < e.orden);

insert into public.comprobante_brasil (banco_id, fecha, id_tx, remitente, observacion, tipo, valor, clase, tasa_binance, estado,
  codigo_brs, movimiento_id, libro_destino_id, contraparte_id, modalidad, moneda_destino, recibido_en_id, empresa_id,
  hora_operacion, apropiado_en)
select n.banco, n.fecha, n.idtx, n.remitente, n.obs, n.tipo::public.tipo_mov, n.valor, n.clase::public.clase_comprobante, n.tasa,
       (case when e.brs is not null then 'APLICADO' else 'PENDIENTE' end)::public.estado_comprobante,
       e.brs, m.id, m.libro_id, m.contraparte_id, m.modalidad, m.moneda_destino, m.recibido_en_id, m.empresa_id,
       (m.fecha_operacion at time zone 'America/Bogota')::time, m.fecha_operacion
  from nuevos n
  left join enlace e on e.orden = n.orden
  left join public.movimiento m on m.id = e.mov
 order by n.orden;

alter table public.comprobante_brasil enable trigger aud_comprobante_brasil;
alter table public.comprobante_brasil enable trigger validar_fecha_comprobante;
insert into public.auditoria (tabla, registro_id, accion, despues)
select 'comprobante_brasil', 'importacion-brasil', 'INSERT', jsonb_build_object('archivo', ${lit(archivo.split(/[\\/]/).pop())},
  'nuevos', (select count(*) from nuevos), 'aplicados', (select count(*) from enlace));

select 'resumen', (select count(*) from stg), (select count(*) from nuevos), (select count(*) from enlace),
       (select count(*) from nuevos where clase = 'SALDO_INICIAL'), (select count(*) from nuevos where clase = 'BINANCE');
select 'sin_enlace', n.mes, n.hoja, n.fila, n.idtx from nuevos n
 where n.clase = 'COMPROBANTE' and n.tipo = 'ENTRADA' and not exists (select 1 from enlace e where e.orden = n.orden);
${aplicar ? "commit;" : "rollback;"}
`;
const salida = psql(sql);
let resumen = null;
for (const l of salida.trim().split("\n")) {
  const c = l.split("\t");
  if (c[0] === "resumen") resumen = c.slice(1).map(Number);
  if (c[0] === "sin_enlace") nota(c[1], c[2], c[3], "pendiente", `entrada sin movimiento BRS- en el Motor (queda por apropiar): ${c[4]}`);
}
const rep = archivo.replace(/\.json$/i, "") + "_REPORTE_BRASIL.csv";
writeFileSync(rep, "﻿" + reporte.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n"));
const [leidas, nuevas, aplicadas, saldos, binance] = resumen ?? [0, 0, 0, 0, 0];
console.log(`Brasil: ${exp.libros.length} libro(s), ${leidas} filas válidas, ${nuevas} nuevas (${aplicadas} ya apropiadas, ${saldos} saldo inicial, ${binance} Binance).`);
console.log(`Omitidas o marcadas: ${reporte.length - 1} → ${rep}`);
if (!op) console.log("Sin Brasil Operadores en el export: lo apropiado se dedujo por el id de transacción de los BRS- del Motor.");
console.log(aplicar ? "GUARDADO." : "SIMULACIÓN (nada se guardó). Agregue --aplicar para guardar.");
