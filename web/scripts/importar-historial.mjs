#!/usr/bin/env node
// STW-49 / STW-59: importa el historial de Sheets a la base.
//
//   node scripts/importar-historial.mjs <EXPORT_MOVIMIENTOS.json> [--historial=<EXPORT_HISTORIAL.json>]          → simula en local
//   node scripts/importar-historial.mjs ... --aplicar                                                         → guarda en local
//   node scripts/importar-historial.mjs ... --destino=prod --aplicar --confirmo-produccion                    → producción
//
// Requisitos: el CORE ya importado (importar-core.mjs): monedas, contrapartes, recibido en, empresas, tasas.
// Qué hace (docs/web/05 §Migración, docs/web/07 T-3..T-16, docs/web/02 §3.10):
//  - MOVIMIENTOS del Motor → movimiento APROBADO con los VALORES del Motor tal cual (tasa, monto, saldo, utilidad):
//    no se recalcula nada (§3.10: los datos del CORE cambiaron después). codigo_origen = id de Sheets,
//    orden_origen = fila; la secuencia del saldo es el orden físico (P-9). RV-/R-/CORRECION_ → fuente "reversion_legacy" (T-15).
//    T-16: tasa_adquisicion = 1 con utilidad 0 → tasa_adquisicion = monto destino / monto efectivo (se conserva la utilidad).
//  - Saldo de cada bucket = último saldo del Motor. Consecutivo de cada libro = el número más alto ya usado.
//  - PERIODOS del Motor con su estado.
//  - Con --historial: pendientes de operadores y clientes (lo no enviado al Motor), ganancias y caja de LAZ/VRJ, GASTOS.
// Seguridad: todo en UNA transacción; sin --aplicar termina en ROLLBACK. Repetible: lo que ya existe (mismo código) se omite.
// Los triggers de auditoría y de ganancias se apagan dentro de la transacción (es una carga histórica, no una operación);
// queda UNA fila en auditoría con el resumen.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith("--"));
const archHist = (args.find((a) => a.startsWith("--historial=")) ?? "").split("=").slice(1).join("=");
const destino = (args.find((a) => a.startsWith("--destino=")) ?? "--destino=local").split("=")[1];
const aplicar = args.includes("--aplicar");
const salir = (m) => { console.error(`\n✖ ${m}\n`); process.exit(1); };
if (!archivo || !existsSync(archivo)) salir("Uso: node scripts/importar-historial.mjs <EXPORT_MOVIMIENTOS.json> [--historial=…] [--aplicar] [--destino=local|prod]");
if (archHist && !existsSync(archHist)) salir(`No existe ${archHist}`);
if (!["local", "prod"].includes(destino)) salir("--destino debe ser local o prod");
if (destino === "prod" && aplicar && !args.includes("--confirmo-produccion")) salir("Para guardar en producción agregue --confirmo-produccion.");

const exp = JSON.parse(readFileSync(archivo, "utf8"));
if (exp.tipo !== "EXPORT_MOVIMIENTOS") salir("El archivo no es un export de movimientos (exportarMovimientos).");
const hist = archHist ? JSON.parse(readFileSync(archHist, "utf8")) : null;
if (hist && hist.tipo !== "EXPORT_HISTORIAL") salir("--historial no es un export de exportarHistorial.");

// ---------------------------------------------------------------- utilidades
const txt = (v) => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());
const up = (v) => txt(v).toUpperCase();
function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = txt(v).replace(/\s/g, "");
  if (!s) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
}
const bool = (v) => v === true || /^(TRUE|VERDADERO|SI|SÍ|1)$/i.test(txt(v));
// Número de serie de Sheets (días desde 1899-12-30, hora LOCAL del libro) → "YYYY-MM-DD HH:MI:SS" local
function serialLocal(v) {
  const n = typeof v === "number" ? v : num(v);
  if (n == null || n < 1) return null;
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  if (!fechaRazonable(d.getUTCFullYear())) return null;
  return d.toISOString().replace("T", " ").slice(0, 19);
}
// Años imposibles (p. ej. 20269 por un dígito de más en Sheets): la fila sale sin fecha y se reporta, no tumba la carga
const fechaRazonable = (y) => Number(y) >= 2000 && Number(y) <= 2100;
function fechaHoraOperacion(e, f) {
  const d = typeof e === "number" ? e : null;
  if (d != null) return serialLocal(Math.floor(d) + (typeof f === "number" ? f % 1 : 0));
  const m = txt(e).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/) || txt(e).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [y, mo, da] = m[1].length === 4 ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
  if (!fechaRazonable(y)) return null;
  const h = typeof f === "number" ? serialLocal(f % 1 + 1)?.slice(11) : (txt(f).match(/^\d{1,2}:\d{2}(:\d{2})?$/) ? txt(f).padStart(5, "0") : "00:00");
  return `${y}-${mo.padStart(2, "0")}-${da.padStart(2, "0")} ${h ?? "00:00"}`;
}
// CSV para COPY: comillas dobles y \N para nulos
const csv = (v) => (v === null || v === undefined || v === "" ? "\\N" : `"${String(v).replace(/"/g, '""')}"`);
const hoja = (libro, n) => (libro?.hojas?.[n]?.filas ?? []).map((f) => f ?? []);

// Libro de origen por el prefijo del código (BRS-LN-… es del libro LN). Lo raro va por libro_origen (col G).
function prefijoLibro(codigo) {
  const m = codigo.match(/^BRS-([A-Z]{2,5})-\d+$/) || codigo.match(/^([A-Z]{2,5})-\d+$/);
  return m ? m[1] : null;
}
const legacy = (c) => /^(RV-|R-|CORRECION_)/.test(c);

// ---------------------------------------------------------------- MOVIMIENTOS del Motor
const core = exp.core ?? { hojas: {} };
const porId = (filas) => new Map(filas.slice(1).filter((f) => txt(f[0])).map((f) => [txt(f[0]), f]));
const utilCore = porId(hoja(core, "UTILIDAD"));
const ajusCore = porId(hoja(core, "AJUSTES_CLIENTES"));
const MOV = hoja(exp.motor, "MOVIMIENTOS");
if (MOV.length < 2) salir("El export no trae MOVIMIENTOS.");
const MARCAS = new Set(["UTILIDAD N/A", "CAMBIADA POR EL ADMIN"]);
const filasMov = [];
const vistosCod = new Map(), vistosTx = new Map();
// Saldo anterior de cada bucket en el Motor (orden físico) para detectar saltos sin movimiento que los explique
const saldoPrev = new Map();
let nAjustes = 0;
const avisos = [];
for (let i = 1; i < MOV.length; i++) {
  const f = MOV[i];
  const cod0 = txt(f[0]);
  if (!cod0) continue;
  const fila = i + 1;
  // Códigos repetidos en el Motor (p. ej. CN-379 aprobado dos veces): se importan los dos y se reportan
  let codigo = cod0;
  const nCod = (vistosCod.get(cod0) ?? 0) + 1; vistosCod.set(cod0, nCod);
  if (nCod > 1) { codigo = `${cod0}/${nCod}`; avisos.push([fila, cod0, `código repetido en el Motor: se importa como ${codigo} (revisar si fue una aprobación doble)`]); }
  let tx = txt(f[2]);
  if (!tx) { tx = `SIN-ID-${codigo}`; avisos.push([fila, cod0, "sin id de transacción en el Motor"]); }
  const nTx = (vistosTx.get(tx.toLowerCase()) ?? 0) + 1; vistosTx.set(tx.toLowerCase(), nTx);
  if (nTx > 1) { avisos.push([fila, cod0, `id de transacción ${tx} repetido en el Motor`]); tx = `${tx} [${codigo}]`; }
  const mo = up(f[14]), md = up(f[15]);
  const monto = num(f[16]);
  const bcp = up(f[8]) === "AGENTE BCP" && mo === "SOL";
  const montoEf = monto == null ? null : monto - (bcp ? 15 : 0);
  const util = num(f[28]), tadq0 = num(f[26]), montoDest = num(f[18]);
  let tadq = tadq0;
  if (tadq0 === 1 && (util ?? 0) === 0 && mo !== md && montoEf) { tadq = montoDest / montoEf; avisos.push([fila, cod0, "T-16: tasa de adquisición 1 con utilidad 0 → se recalcula para que cuadre"]); }
  const idUt = txt(f[34]);
  const marca = MARCAS.has(up(idUt)) ? up(idUt) : null;
  const u = marca ? null : utilCore.get(idUt);
  const puntos = u ? num(up(f[7]) === "EFECTIVO" ? u[3] : u[4]) ?? 0 : 0;
  const ben = ajusCore.get(txt(f[32]));
  const per = txt(f[36]).match(/^\d{4}-\d{2}$/) ? txt(f[36]) : null;
  const fop = fechaHoraOperacion(f[4], f[5]);
  const ent = num(f[19]) ?? 0, sal = num(f[20]) ?? 0, saldo = num(f[21]);
  const ct = txt(f[12]), kb = `${ct}|${md}|${up(f[7])}`;
  // Ajuste de migración: si el saldo del Motor no es "anterior + entrada − salida" (saldo inicial escrito a mano, edición o
  // recálculo en Sheets), la diferencia entra como un movimiento propio JUSTO ANTES de esta fila. Así la historia cuadra
  // sola: cualquier recálculo posterior en la web reproduce exactamente los saldos de Sheets (docs/web/02 §3.10).
  if (ct && saldo != null) {
    const previo = saldoPrev.get(kb) ?? 0;
    const salto = Math.round((saldo - (previo + ent - sal)) * 100) / 100;
    if (Math.abs(salto) >= 0.01) {
      nAjustes++;
      const v = Math.abs(salto);
      filasMov.push([
        fila, `AJM-${codigo}`, cod0, prefijoLibro(cod0), up(f[6]), serialLocal(f[1]) ?? fop, `AJM-${codigo}`, salto > 0 ? "ENTRADA" : "SALIDA", fop,
        up(f[7]), "", "", ct, "Ajuste de migración", md, md, v, v, 1, v, salto > 0 ? v : 0, salto < 0 ? v : 0, Math.round((previo + salto) * 100) / 100,
        null, 1, v, 0, "", "", false, null, null, 0, 0, per, "ajuste_migracion", fila * 2 - 1,
      ]);
    }
    saldoPrev.set(kb, saldo);
  }
  filasMov.push([
    fila, codigo, cod0, prefijoLibro(cod0), up(f[6]), serialLocal(f[1]) ?? fop, tx, up(f[3]), fop, up(f[7]), up(f[8]), up(f[9]),
    txt(f[12]), txt(f[13]), mo, md, monto, montoEf, num(f[17]), montoDest, num(f[19]) ?? 0, num(f[20]) ?? 0, num(f[21]),
    serialLocal(f[23]), tadq, num(f[27]), util, txt(f[31]), txt(f[32]), bool(f[33]), marca ? null : idUt, marca, puntos,
    ben ? num(ben[8]) ?? 0 : 0, per, legacy(cod0) ? "reversion_legacy" : "motor", fila * 2,
  ]);
}
const colsMov = "fila, codigo, codigo_origen, prefijo, libro_origen, aprobado_en, id_tx, tipo, fecha_op, modalidad, recibido, empresa, ct, tercero, mo, md, monto, monto_ef, tasa, monto_dest, entrada, salida, saldo, verificado_en, tadq, vadq, utilidad, id_tasa, id_ajuste, descuento, id_util, marca, puntos, beneficio, periodo, fuente, orden";

// Si este export no trae PERIODOS, se pueden tomar de otro export del Motor (--periodos-de=<EXPORT_MOVIMIENTOS.json>);
// sin ninguno, cada mes con movimientos queda ABIERTO (se pierden los cierres)
const archPer = (args.find((a) => a.startsWith("--periodos-de=")) ?? "").split("=").slice(1).join("=");
let fuentePer = exp.motor;
if (hoja(exp.motor, "PERIODOS").length < 2 && archPer) {
  if (!existsSync(archPer)) salir(`No existe ${archPer}`);
  fuentePer = JSON.parse(readFileSync(archPer, "utf8")).motor;
  console.log(`OJO: el export no trae PERIODOS; se toman de ${archPer}`);
}
const periodos = hoja(fuentePer, "PERIODOS").slice(1).filter((f) => txt(f[0]).match(/^\d{4}-\d{2}$/))
  .map((f) => [txt(f[0]), serialLocal(f[1])?.slice(0, 10), serialLocal(f[2])?.slice(0, 10), up(f[4]) === "CERRADO" ? "CERRADO" : "ABIERTO", num(f[5])]);

// ---------------------------------------------------------------- historial de los libros (opcional)
const enMotor = new Set(filasMov.map((r) => r[2]));
const pendientes = [], gastos = [], cajas = [], ganancias = [];
if (hist) {
  for (const [libroCod, l] of Object.entries(hist.libros ?? {})) {
    if (l.tipo === "operador" || l.tipo === "cliente") {
      const R = hoja(l, "REGISTROS");
      for (let i = 1; i < R.length; i++) {
        const f = R[i]; const id = txt(f[0]);
        if (!id || enMotor.has(id)) continue;                       // ya está aprobado en el Motor
        let estado;
        if (l.tipo === "operador") {
          if (bool(f[29]) || up(f[29]) === "BLOQUEADO") continue;   // enviado y aprobado (debería estar en el Motor)
          estado = bool(f[24]) ? "VERIFICADO" : (prefijoLibro(id) && !["LN", "SB"].includes(prefijoLibro(id)) ? "ENVIADO_OPERADOR" : "BORRADOR");
        } else {
          const y = txt(f[24]);
          if (y === "2") { avisos.push([i + 1, id, `${libroCod}: aprobado en el cliente pero no está en el Motor`]); continue; }
          if (y === "1") continue;                                  // ya lo tiene el operador (se importa desde su libro)
          estado = y === "3" ? "RECHAZADO" : "BORRADOR";
        }
        pendientes.push([libroCod, i + 1, id, txt(f[2]) || `SIN-ID-${id}`, up(f[3]), fechaHoraOperacion(f[4], f[5]), up(f[6]), up(f[7]), up(f[9]),
          txt(f[13]), txt(f[14]), up(f[15]), up(f[17]), num(f[18]), bool(f[l.tipo === "operador" ? 31 : 28]), txt(f[l.tipo === "operador" ? 33 : 29]), estado]);
      }
    }
    if (libroCod !== "OTROS" && hoja(l, "CAJA_GANANCIAS").length) {
      const C = hoja(l, "CAJA_GANANCIAS");
      for (let i = 12; i < C.length; i++) {                         // fila 13 en adelante (FILA_INICIO_LEDGER)
        const f = C[i]; const cod = txt(f[0]);
        if (!cod || !/^(UTIL|RET)-/.test(cod)) continue;
        cajas.push([libroCod, i + 1, cod, up(f[2]) === "RETIRO" ? "RETIRO" : "UTILIDAD", serialLocal(f[1]) ?? null, txt(f[3]), txt(f[4]), num(f[5]) ?? 0, num(f[6]) ?? 0]);
      }
      const G = hoja(l, "GANANCIAS");
      for (let i = 1; i < G.length; i++) {
        const f = G[i]; if (!txt(f[0])) continue;
        ganancias.push([libroCod, txt(f[0]), up(f[3]), num(f[7]) ?? 0, num(f[8]), num(f[5]), num(f[9]) ?? 0]);
      }
    }
    if (libroCod === "OTROS") {
      const G = hoja(l, "GASTOS");
      for (let i = 1; i < G.length; i++) {
        const f = G[i]; if (!txt(f[0]) || num(f[5]) == null) continue;
        const fecha = typeof f[1] === "number" ? serialLocal(f[1])?.slice(0, 10) : (txt(f[1]).match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null);
        gastos.push([i + 1, txt(f[0]), fecha, txt(f[2]) || "SIN TIPO", txt(f[3]), txt(f[4]), num(f[5]), txt(f[6]), txt(f[7]), txt(f[8])]);
      }
    }
  }
}

// ---------------------------------------------------------------- SQL
const copy = (tabla, cols, filas) => `copy ${tabla} (${cols}) from stdin with (format csv, null '\\N');\n`
  + (filas.length ? filas.map((r) => r.map(csv).join(",")).join("\n") + "\n" : "") + "\\.\n";
const sql = `
\\set ON_ERROR_STOP on
begin;
set local timezone = 'America/Bogota';
create temp table stg_mov (fila int, codigo text, codigo_origen text, prefijo text, libro_origen text, aprobado_en timestamptz, id_tx text, tipo text,
  fecha_op timestamptz, modalidad text, recibido text, empresa text, ct text, tercero text, mo text, md text, monto numeric, monto_ef numeric,
  tasa numeric, monto_dest numeric, entrada numeric, salida numeric, saldo numeric, verificado_en timestamptz, tadq numeric, vadq numeric,
  utilidad numeric, id_tasa text, id_ajuste text, descuento boolean, id_util text, marca text, puntos numeric, beneficio numeric, periodo text, fuente text, orden int);
${copy("stg_mov", colsMov, filasMov)}
create temp table stg_per (id text, inicio date, fin date, estado text, utilidad numeric);
${copy("stg_per", "id, inicio, fin, estado, utilidad", periodos)}
create temp table stg_pend (libro text, fila int, codigo text, id_tx text, tipo text, fecha_op timestamptz, modalidad text, recibido text, empresa text,
  ct text, tercero text, mo text, md text, monto numeric, descuento boolean, observaciones text, estado text);
${copy("stg_pend", "libro, fila, codigo, id_tx, tipo, fecha_op, modalidad, recibido, empresa, ct, tercero, mo, md, monto, descuento, observaciones, estado", pendientes)}
create temp table stg_caja (libro text, fila int, codigo text, tipo text, fecha timestamptz, referencia text, descripcion text, entrada numeric, salida numeric);
${copy("stg_caja", "libro, fila, codigo, tipo, fecha, referencia, descripcion, entrada, salida", cajas)}
create temp table stg_gan (libro text, codigo text, mo text, beneficio numeric, tasa_cliente numeric, monto numeric, utilidad numeric);
${copy("stg_gan", "libro, codigo, mo, beneficio, tasa_cliente, monto, utilidad", ganancias)}
create temp table stg_gasto (fila int, id text, fecha date, tipo text, proveedor text, descripcion text, valor numeric, empresa text, tipo_abono text, oficina text);
${copy("stg_gasto", "fila, id, fecha, tipo, proveedor, descripcion, valor, empresa, tipo_abono, oficina", gastos)}

create temp table rep (seccion text, fila int, codigo text, motivo text);

-- Carga histórica: sin auditoría fila a fila ni cálculo automático de ganancias (se importan las de Sheets)
alter table public.movimiento disable trigger aud_movimiento;
alter table public.movimiento disable trigger ganancia_por_movimiento;
alter table public.movimiento_utilidad disable trigger aud_movimiento_utilidad;
alter table public.movimiento_utilidad disable trigger ganancia_por_utilidad;
alter table public.saldo_bucket disable trigger aud_saldo_bucket;
alter table public.caja_ganancia disable trigger aud_caja_ganancia;
alter table public.ganancia_movimiento disable trigger aud_ganancia_movimiento;
alter table public.gasto disable trigger aud_gasto;

-- ---------------------------------------------------------------- períodos
insert into public.periodo (id, inicio, fin, estado, utilidad_total)
select id, inicio, fin, estado, case when estado = 'CERRADO' then utilidad end from stg_per on conflict (id) do nothing;

-- ---------------------------------------------------------------- resolver referencias
alter table stg_mov add column libro_id uuid, add column operador_id uuid, add column recibido_id text, add column empresa_id text, add column error text;
update stg_mov s set libro_id = l.id, operador_id = l.operador_id from public.libro l where l.prefijo = s.prefijo;
update stg_mov s set libro_id = l.id from public.libro l where s.libro_id is null and l.codigo = s.libro_origen;
update stg_mov s set recibido_id = r.id from public.recibido_en r where public.normalizar_texto(r.nombre) = s.recibido;
update stg_mov s set empresa_id = e.id from public.empresa e where public.normalizar_texto(e.nombre) = s.empresa;
update stg_mov s set periodo = to_char(s.fecha_op, 'YYYY-MM') where s.periodo is null;
insert into public.periodo (id, inicio, fin, estado)
select distinct periodo, to_date(periodo || '-01', 'YYYY-MM-DD'), (to_date(periodo || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date, 'ABIERTO'
  from stg_mov on conflict (id) do nothing;
update stg_mov set error = 'ya importado' where codigo in (select codigo from public.movimiento);
update stg_mov set error = concat('libro desconocido (prefijo ', coalesce(prefijo, '—'), ', origen ', libro_origen, ')') where error is null and libro_id is null;
update stg_mov set error = concat('contraparte ', coalesce(nullif(ct, ''), '(vacía)'), ' no existe en el catálogo') where error is null and not exists (select 1 from public.contraparte c where c.id = ct);
update stg_mov set error = concat('moneda ', mo, ' o ', md, ' no existe en el catálogo') where error is null
   and (not exists (select 1 from public.moneda m where m.nombre = mo) or not exists (select 1 from public.moneda m where m.nombre = md));
update stg_mov set error = 'tipo, modalidad, fecha o montos incompletos' where error is null
   and (tipo not in ('ENTRADA', 'SALIDA') or modalidad not in ('EFECTIVO', 'TRANSFERENCIA') or fecha_op is null or monto is null or monto <= 0
        or tasa is null or monto_dest is null or saldo is null);
insert into rep select 'movimientos', fila, codigo_origen, error from stg_mov where error is not null;
insert into rep select 'avisos', fila, codigo_origen, concat('recibido en "', recibido, '" no está en el catálogo (queda vacío)') from stg_mov
  where error is null and recibido_id is null and recibido not in ('', 'NO APLICA');

-- ---------------------------------------------------------------- movimientos aprobados (valores del Motor)
create temp table nuevos as
select s.*, gen_random_uuid() as nid,
       row_number() over (partition by ct, md, modalidad order by orden) as sec,
       coalesce(lag(saldo) over (partition by ct, md, modalidad order by orden), 0) as saldo_ant
  from stg_mov s where error is null;
-- secuencia sigue lo que ya existe en la web para ese bucket (repetible)
update nuevos n set sec = n.sec + coalesce((select max(secuencia_bucket) from public.movimiento m
  where m.contraparte_id = n.ct and m.moneda_destino = n.md and m.modalidad = n.modalidad and m.estado = 'APROBADO'), 0);

insert into public.movimiento (id, codigo, libro_id, operador_id, id_transaccion, tipo, fecha_operacion, modalidad, recibido_en_id, empresa_id,
  contraparte_id, tercero, moneda_origen, moneda_destino, monto_origen, descuento_tasa, estado, verificado_en, aprobado_en, monto_efectivo,
  tasa_cliente_id, tasa_base, tasa_aplicada, monto_destino, entrada, salida, saldo_anterior, saldo_post, secuencia_bucket, periodo_id,
  codigo_origen, orden_origen, fuente_migracion, importado_en, creado_en, actualizado_en, orden_aprobacion, observaciones)
select nid, codigo, libro_id, operador_id, id_tx, tipo::public.tipo_mov, fecha_op, modalidad, recibido_id, empresa_id, ct, nullif(tercero, ''), mo, md,
       round(monto, 2), descuento, 'APROBADO', verificado_en, coalesce(aprobado_en, fecha_op), round(monto_ef, 2),
       (select t.id from public.tasa_cliente t where t.id = n.id_tasa), (select t.valor from public.tasa_cliente t where t.id = n.id_tasa),
       tasa, round(monto_dest, 2), round(entrada, 2), round(salida, 2), round(saldo_ant, 2), round(saldo, 2), sec, periodo,
       codigo_origen, fila, fuente, now(), coalesce(aprobado_en, fecha_op), now(),
       -- P-9: el orden del saldo es la fila física del Motor (migración 1900)
       (select coalesce(max(orden_aprobacion), 0) from public.movimiento) + row_number() over (order by orden),
       case when fuente = 'ajuste_migracion' then concat('Ajuste de migración: el saldo del Motor cambió sin un movimiento que lo explique justo antes de ',
         codigo_origen, ' (saldo inicial escrito a mano, edición o recálculo en Sheets). Revisar con la administración.') end
  from nuevos n;
select setval('public.movimiento_orden_aprobacion_seq', coalesce((select max(orden_aprobacion) from public.movimiento), 0) + 1, false);

insert into public.movimiento_utilidad (movimiento_id, tasa_utilidad_id, puntos_utilidad, ajuste_id, beneficio, tasa_adquisicion, valor_adquisicion, utilidad, marca_utilidad)
select nid, (select u.id from public.tasa_utilidad u where u.id = n.id_util), coalesce(puntos, 0),
       (select a.id from public.ajuste_cliente a where a.id = n.id_ajuste), coalesce(beneficio, 0),
       coalesce(tadq, tasa), coalesce(vadq, monto_dest), coalesce(utilidad, 0), marca
  from nuevos n;

-- Saldo de cada bucket = último saldo del Motor (orden físico); la secuencia, la última
insert into public.saldo_bucket (contraparte_id, moneda, modalidad, saldo, ultima_secuencia, actualizado_en)
select distinct on (ct, md, modalidad) ct, md, modalidad, round(saldo, 2), sec, now() from nuevos order by ct, md, modalidad, orden desc
on conflict (contraparte_id, moneda, modalidad) do update set saldo = excluded.saldo, ultima_secuencia = excluded.ultima_secuencia, actualizado_en = now();

-- ---------------------------------------------------------------- pendientes (lo no enviado al Motor)
insert into public.movimiento (codigo, libro_id, operador_id, id_transaccion, tipo, fecha_operacion, modalidad, recibido_en_id, empresa_id, contraparte_id,
  tercero, moneda_origen, moneda_destino, monto_origen, descuento_tasa, observaciones, estado, verificado_en, rechazado_motivo, rechazado_en,
  codigo_origen, orden_origen, fuente_migracion, importado_en)
select p.codigo, l.id, l.operador_id, p.id_tx, p.tipo::public.tipo_mov, p.fecha_op, p.modalidad,
       (select r.id from public.recibido_en r where public.normalizar_texto(r.nombre) = p.recibido),
       (select e.id from public.empresa e where public.normalizar_texto(e.nombre) = p.empresa), p.ct, nullif(p.tercero, ''), p.mo, p.md, round(p.monto, 2),
       p.descuento, nullif(p.observaciones, ''), p.estado::public.estado_mov, case when p.estado = 'VERIFICADO' then now() end,
       case when p.estado = 'RECHAZADO' then 'Rechazado en Sheets (migración)' end, case when p.estado = 'RECHAZADO' then now() end,
       p.codigo, p.fila, 'pendiente_' || lower(p.libro), now()
  from stg_pend p
  join public.libro l on l.prefijo = coalesce(substring(p.codigo from '^BRS-([A-Z]{2,5})-'), substring(p.codigo from '^([A-Z]{2,5})-'))
 where not exists (select 1 from public.movimiento m where m.codigo = p.codigo)
   and p.tipo in ('ENTRADA', 'SALIDA') and p.modalidad in ('EFECTIVO', 'TRANSFERENCIA') and p.fecha_op is not null and p.monto > 0
   and exists (select 1 from public.contraparte c where c.id = p.ct)
   and exists (select 1 from public.moneda m where m.nombre = p.mo) and exists (select 1 from public.moneda m where m.nombre = p.md)
   and not exists (select 1 from public.movimiento m where lower(btrim(m.id_transaccion)) = lower(btrim(p.id_tx)) and m.estado not in ('ANULADO', 'RECHAZADO'))
on conflict do nothing;
insert into rep select 'pendientes', p.fila, p.codigo, 'no se importó (libro, catálogo, datos incompletos o id de transacción ya usado)'
  from stg_pend p where not exists (select 1 from public.movimiento m where m.codigo = p.codigo);

-- ---------------------------------------------------------------- ganancias y caja (LAZ, VRJ)
insert into public.ganancia_movimiento (movimiento_id, libro_id, moneda_origen, beneficio, tasa_cliente, monto_base, utilidad)
select m.id, m.libro_id, g.mo, g.beneficio, coalesce(g.tasa_cliente, m.tasa_aplicada - g.beneficio), coalesce(m.monto_efectivo, g.monto), round(g.utilidad, 2)
  from stg_gan g join public.movimiento m on m.codigo = g.codigo
on conflict (movimiento_id) do nothing;
insert into public.caja_ganancia (libro_id, codigo, tipo, fecha, movimiento_id, descripcion, entrada, salida)
select l.id, c.codigo, c.tipo::public.tipo_caja, coalesce(c.fecha, now()), (select m.id from public.movimiento m where m.codigo = c.referencia),
       nullif(c.descripcion, ''), round(c.entrada, 2), round(c.salida, 2)
  from stg_caja c join public.libro l on l.codigo = c.libro
 where not exists (select 1 from public.caja_ganancia x where x.codigo = c.codigo)
 order by c.libro, c.fila;

-- ---------------------------------------------------------------- gastos (STW-59), con su código G- de Sheets
insert into public.gasto (id, fecha, tipo, proveedor, descripcion, valor, empresa_id, tipo_abono, oficina)
select g.id, g.fecha, g.tipo, nullif(g.proveedor, ''), nullif(g.descripcion, ''), round(g.valor, 2),
       (select e.id from public.empresa e where public.normalizar_texto(e.nombre) = public.normalizar_texto(g.empresa)), nullif(g.tipo_abono, ''), nullif(g.oficina, '')
  from stg_gasto g where g.fecha is not null and g.valor > 0 and not exists (select 1 from public.gasto x where x.id = g.id)
on conflict do nothing;
insert into rep select 'gastos', g.fila, g.id, 'no se importó (sin fecha, valor ≤ 0 o código repetido)' from stg_gasto g where not exists (select 1 from public.gasto x where x.id = g.id);

-- ---------------------------------------------------------------- consecutivos: siguen desde el número más alto usado
insert into public.consecutivo (libro_id, ultimo)
select l.id, max(substring(m.codigo from '^' || l.prefijo || '-(\\d+)$')::int)
  from public.movimiento m join public.libro l on m.codigo ~ ('^' || l.prefijo || '-\\d+$') group by l.id
on conflict (libro_id) do update set ultimo = greatest(public.consecutivo.ultimo, excluded.ultimo);
insert into public.consecutivo_finanzas (serie, ultimo)
select 'G', max(substring(id from '^G-(\\d+)$')::int) from public.gasto where id ~ '^G-\\d+$' having count(*) > 0
on conflict (serie) do update set ultimo = greatest(public.consecutivo_finanzas.ultimo, excluded.ultimo);

alter table public.movimiento enable trigger aud_movimiento;
alter table public.movimiento enable trigger ganancia_por_movimiento;
alter table public.movimiento_utilidad enable trigger aud_movimiento_utilidad;
alter table public.movimiento_utilidad enable trigger ganancia_por_utilidad;
alter table public.saldo_bucket enable trigger aud_saldo_bucket;
alter table public.caja_ganancia enable trigger aud_caja_ganancia;
alter table public.ganancia_movimiento enable trigger aud_ganancia_movimiento;
alter table public.gasto enable trigger aud_gasto;

insert into public.auditoria (tabla, registro_id, accion, despues)
values ('importacion_historial', '${exp.generado}', 'INSERT', jsonb_build_object('fuente', '${archivo.split(/[\\/]/).pop()}',
  'movimientos', (select count(*) from nuevos), 'pendientes', (select count(*) from stg_pend), 'gastos', (select count(*) from stg_gasto)));

-- ---------------------------------------------------------------- resumen
select 'R', 'movimientos aprobados importados', count(*)::text from nuevos
union all select 'R', '  de ellos reversiones/ajustes antiguos (RV-, R-, CORRECION_)', count(*)::text from nuevos where fuente = 'reversion_legacy'
union all select 'R', '  ajustes de migración (saltos de saldo del Motor, AJM-)', count(*)::text from nuevos where fuente = 'ajuste_migracion'
union all select 'R', 'saldos (buckets) actualizados', count(distinct (ct, md, modalidad))::text from nuevos
union all select 'R', 'pendientes importados', count(*)::text from public.movimiento where fuente_migracion like 'pendiente_%' and importado_en >= now() - interval '1 minute'
union all select 'R', 'ganancias / caja importadas', (select count(*) from stg_gan)::text || ' / ' || (select count(*) from stg_caja)::text
union all select 'R', 'gastos importados', (select count(*) from public.gasto where id in (select id from stg_gasto))::text
union all select 'R', 'ya estaban importados (se omiten: la importación es repetible)', (select count(*) from rep where motivo = 'ya importado')::text
union all select 'R', 'filas con problema (no importadas)', (select count(*) from rep where seccion <> 'avisos' and motivo <> 'ya importado')::text
union all select 'R', 'períodos', (select string_agg(id || ' ' || lower(estado), ', ' order by id) from public.periodo);
select 'X', seccion, fila::text, codigo, motivo from rep where motivo <> 'ya importado' order by seccion, fila;
select 'G', g.periodo, public.formato_pesos(sum(g.valor)) from public.gasto g where g.id in (select id from stg_gasto) group by g.periodo order by 1, 2;
${aplicar ? "commit;" : "rollback;"}
`;

// ---------------------------------------------------------------- ejecutar
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
console.log(`Export: ${exp.motor?.titulo ?? "Motor"} (${exp.generado})${hist ? ` + historial (${hist.generado})` : ""} · destino ${destino} · ${aplicar ? "GUARDADO" : "SIMULACIÓN (no se guarda nada)"}`);
console.log(`Saltos de saldo en el Motor convertidos en ajustes AJM- (uno por salto, en la moneda de ese saldo): ${nAjustes}`);
console.log(`Leídos: ${filasMov.length - nAjustes} movimientos del Motor, ${periodos.length} períodos, ${pendientes.length} pendientes, ${ganancias.length} ganancias, ${cajas.length} filas de caja, ${gastos.length} gastos`);
const t0 = Date.now();
const r = spawnSync("docker", ["exec", "-i", CONTENEDOR, "psql", ...destinoPsql, "-q", "-tA", "-F", "\t", "-v", "ON_ERROR_STOP=1"],
  { input: sql, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
if (r.status !== 0) { console.error(r.stderr || r.stdout); salir("La importación falló y no se guardó nada (ROLLBACK)."); }
const lineas = r.stdout.trim().split("\n").filter(Boolean).map((l) => l.split("\t"));
console.log("");
for (const l of lineas.filter((x) => x[0] === "R")) console.log(`  ${l[1].padEnd(62)} ${l[2]}`);
const problemas = lineas.filter((x) => x[0] === "X");
const porMotivo = new Map();
for (const p of problemas) { const k = `${p[1]}: ${p[4].replace(/ [A-Z]+-\d+.*| CT-\d+.*/, "")}`; porMotivo.set(k, (porMotivo.get(k) ?? 0) + 1); }
if (porMotivo.size) { console.log("\nProblemas y avisos (resumen):"); for (const [k, v] of porMotivo) console.log(`  ${String(v).padStart(6)}  ${k}`); }
if (avisos.length) {
  console.log(`\nAvisos de los datos del Motor (${avisos.length}):`);
  const tipos = new Map(); for (const a of avisos) { const k = a[2].replace(/ [A-Z0-9-]+\/\d.*| .*repetido en el Motor/, (m) => (m.includes("repetido") ? " repetido en el Motor" : "")); tipos.set(k, (tipos.get(k) ?? 0) + 1); }
  for (const [k, v] of tipos) console.log(`  ${String(v).padStart(6)}  ${k}`);
}
const gastosMes = lineas.filter((x) => x[0] === "G");
if (gastosMes.length) { console.log("\nGastos importados por período (compárelos con la hoja GASTOS):"); for (const g of gastosMes) console.log(`  ${g[1]}  ${g[2]}`); }
const rep = archivo.replace(/\.json$/i, "") + `_REPORTE_IMPORTACION_${destino.toUpperCase()}.csv`;
writeFileSync(rep, "\uFEFF" + [["seccion", "fila", "codigo", "motivo"], ...problemas.map((p) => p.slice(1)), ...avisos.map((a) => ["avisos_motor", ...a])]
  .map((x) => x.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n"));
console.log(`\nDetalle: ${rep}\nTiempo: ${Math.round((Date.now() - t0) / 1000)} s`);
if (!aplicar) console.log("\nPara guardar, repita con --aplicar" + (destino === "prod" ? " --confirmo-produccion" : "") + ".");
