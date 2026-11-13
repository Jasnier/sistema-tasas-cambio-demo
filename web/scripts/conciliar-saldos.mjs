#!/usr/bin/env node
// STW-50: conciliación automática de saldos web vs Sheets.
//
//   node scripts/conciliar-saldos.mjs <EXPORT_MOVIMIENTOS.json> [--db=migracion] [--destino=prod --confirmo-produccion]
//
// Para cada bucket (cliente × moneda destino × modalidad) toma el ÚLTIMO saldo del Motor en orden físico (lo que hoy
// muestra Sheets) y lo compara con el saldo de la web. Guarda la corrida en conciliacion_corrida / conciliacion_saldo
// (pantalla Saldos → Conciliación con Sheets) y deja un CSV con las diferencias. Durante el periodo en paralelo
// (STW-51) se corre cada día con un export fresco: la meta es 0 diferencias 5 días seguidos.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith("--"));
const destino = (args.find((a) => a.startsWith("--destino=")) ?? "--destino=local").split("=")[1];
const dbLocal = (args.find((a) => a.startsWith("--db=")) ?? "--db=postgres").split("=")[1];
// --contenedor=<nombre>: otro Supabase LOCAL (p. ej. el de datos reales de scripts/reales.mjs); por defecto el de desarrollo
const CONTENEDOR = (process.argv.slice(2).find((a) => a.startsWith("--contenedor=")) ?? "--contenedor=supabase_db_web").split("=")[1];
if (!/^[a-z0-9_]+$/.test(CONTENEDOR)) { console.error("--contenedor no válido"); process.exit(1); }
const salir = (m) => { console.error(`\n✖ ${m}\n`); process.exit(1); };
if (!archivo || !existsSync(archivo)) salir("Uso: node scripts/conciliar-saldos.mjs <EXPORT_MOVIMIENTOS.json> [--db=…]");
if (!/^[a-z_][a-z0-9_]*$/.test(dbLocal)) salir("--db no válido");
if (destino === "prod" && !args.includes("--confirmo-produccion")) salir("Para escribir la corrida en producción agregue --confirmo-produccion.");

const exp = JSON.parse(readFileSync(archivo, "utf8"));
const MOV = exp.motor?.hojas?.MOVIMIENTOS?.filas ?? [];
if (MOV.length < 2) salir("El export no trae MOVIMIENTOS.");
const txt = (v) => (v == null ? "" : String(v).trim());
const buckets = new Map();
for (let i = 1; i < MOV.length; i++) {
  const f = MOV[i] ?? [];
  if (!txt(f[0]) || !txt(f[12])) continue;
  const k = `${txt(f[12])}|${txt(f[15]).toUpperCase()}|${txt(f[7]).toUpperCase()}`;
  const b = buckets.get(k) ?? { saldo: 0, n: 0 };
  b.saldo = typeof f[21] === "number" ? f[21] : Number(f[21]) || b.saldo;
  b.n++;
  buckets.set(k, b);
}
const csv = (v) => (v == null ? "\\N" : `"${String(v).replace(/"/g, '""')}"`);
const fuente = archivo.split(/[\\/]/).pop().replace(/'/g, "");
const sql = `
\\set ON_ERROR_STOP on
begin;
create temp table stg (contraparte_id text, moneda text, modalidad text, saldo numeric, n int);
copy stg from stdin with (format csv, null '\\N');
${[...buckets].map(([k, b]) => [...k.split("|"), Math.round(b.saldo * 100) / 100, b.n].map(csv).join(",")).join("\n")}
\\.
with c as (insert into public.conciliacion_corrida (fuente, corte_sheets) values ('${fuente}', '${exp.generado}') returning id),
web as (select contraparte_id, moneda, modalidad, saldo from public.saldo_bucket),
nweb as (select contraparte_id, moneda_destino as moneda, modalidad, count(*)::int n from public.movimiento where estado = 'APROBADO' group by 1, 2, 3),
todo as (select coalesce(s.contraparte_id, w.contraparte_id) ct, coalesce(s.moneda, w.moneda) mon, coalesce(s.modalidad, w.modalidad) moda,
                s.saldo ss, w.saldo sw, s.n ns from stg s full join web w using (contraparte_id, moneda, modalidad))
insert into public.conciliacion_saldo (corrida_id, contraparte_id, moneda, modalidad, saldo_sheets, saldo_web, movimientos_sheets, movimientos_web)
select c.id, t.ct, t.mon, t.moda, t.ss, t.sw, t.ns, n.n from todo t cross join c
  left join nweb n on n.contraparte_id = t.ct and n.moneda = t.mon and n.modalidad = t.moda;
update public.conciliacion_corrida r set buckets = (select count(*) from public.conciliacion_saldo s where s.corrida_id = r.id),
  con_diferencia = (select count(*) from public.conciliacion_saldo s where s.corrida_id = r.id and abs(s.diferencia) > 0.005)
 where r.id = (select max(id) from public.conciliacion_corrida);
select 'R', id, buckets, con_diferencia from public.conciliacion_corrida where id = (select max(id) from public.conciliacion_corrida);
select 'D', s.contraparte_id, s.moneda, s.modalidad, coalesce(s.saldo_sheets::text, '—'), coalesce(s.saldo_web::text, '—'), s.diferencia
  from public.conciliacion_saldo s where s.corrida_id = (select max(id) from public.conciliacion_corrida) and abs(s.diferencia) > 0.005
 order by abs(s.diferencia) desc;
commit;
`;
let destinoPsql = ["-U", "postgres", "-d", dbLocal];
if (destino === "prod") {
  const env = join(WEB, ".env.entornos.local");
  const url = existsSync(env) ? (readFileSync(env, "utf8").match(/^SUPABASE_DB_URL_PROD=(.+)$/m)?.[1] ?? "").trim() : "";
  if (!url) salir("Falta SUPABASE_DB_URL_PROD en web/.env.entornos.local");
  destinoPsql = [url];
}
const r = spawnSync("docker", ["exec", "-i", CONTENEDOR, "psql", ...destinoPsql, "-q", "-tA", "-F", "\t"], { input: sql, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (r.status !== 0) { console.error(r.stderr || r.stdout); salir("La conciliación falló."); }
const l = r.stdout.trim().split("\n").filter(Boolean).map((x) => x.split("\t"));
const [, id, total, dif] = l.find((x) => x[0] === "R");
console.log(`Conciliación #${id} · ${fuente} (corte ${exp.generado}) · ${total} saldos comparados · ${dif} con diferencia`);
const d = l.filter((x) => x[0] === "D");
for (const x of d.slice(0, 15)) console.log(`  ${x[1].padEnd(8)} ${x[2].padEnd(14)} ${x[3].padEnd(13)} Sheets ${x[4].padStart(16)}  web ${x[5].padStart(16)}  dif ${x[6]}`);
if (d.length > 15) console.log(`  … y ${d.length - 15} más`);
const out = archivo.replace(/\.json$/i, "") + `_CONCILIACION_${id}.csv`;
writeFileSync(out, "﻿" + [["contraparte", "moneda", "modalidad", "saldo_sheets", "saldo_web", "diferencia"], ...d.map((x) => x.slice(1))]
  .map((x) => x.map((v) => `"${v}"`).join(";")).join("\r\n"));
console.log(`Detalle: ${out}`);
process.exit(Number(dif) ? 1 : 0);
