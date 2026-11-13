#!/usr/bin/env node
// Aplica las migraciones de supabase/migrations a staging o producción, con protecciones.
//
//   npm run db:push:staging                 → muestra qué migraciones faltan (no cambia nada)
//   npm run db:push:staging -- --aplicar    → las aplica en staging
//   npm run db:push:prod -- --aplicar --confirmo-produccion
//
// Conexión: variables SUPABASE_DB_URL_STAGING / SUPABASE_DB_URL_PROD (cadena de conexión de
// Postgres del proyecto: Dashboard → Connect → Session pooler). Se leen del entorno o de
// web/.env.entornos.local (ignorado por git). Ver docs/DESPLIEGUE.md.
//
// Protecciones:
//  - Nunca envía semillas (seed.sql tiene usuarios de prueba con contraseña conocida).
//  - Sin --aplicar solo hace --dry-run.
//  - Producción exige --confirmo-produccion, rama main sin cambios pendientes y la misma
//    versión que origin/main, y que staging y producción no sean la misma base.
//  - Antes de aplicar corre las pruebas pgTAP locales (supabase test db) salvo --sin-pruebas
//    (solo staging).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENTORNOS = { staging: "SUPABASE_DB_URL_STAGING", prod: "SUPABASE_DB_URL_PROD" };

function salir(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

function cargarEnvLocal() {
  const f = join(WEB, ".env.entornos.local");
  if (!existsSync(f)) return;
  for (const linea of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function git(...args) {
  return execFileSync("git", args, { cwd: WEB, encoding: "utf8" }).trim();
}

// Se llama al CLI con node (sin shell) para que la contraseña de la URL no pase por cmd/bash
const CLI = join(WEB, "node_modules", "supabase", "dist", "supabase.js");
function supabase(args) {
  if (!existsSync(CLI)) salir("No está instalado el CLI de Supabase (npm install en web/).");
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: WEB, stdio: "inherit" });
  return r.status ?? 1;
}

function ocultar(url) {
  return url.replace(/\/\/([^:@/]+):([^@]+)@/, "//$1:****@");
}

const [entorno, ...flags] = process.argv.slice(2);
if (!ENTORNOS[entorno]) salir("Uso: node scripts/db-push.mjs <staging|prod> [--aplicar] [--confirmo-produccion] [--sin-pruebas]");
const aplicar = flags.includes("--aplicar");
const sinPruebas = flags.includes("--sin-pruebas");
if (flags.some((f) => /seed/i.test(f))) salir("Las semillas nunca se envían a staging ni a producción.");

cargarEnvLocal();
const url = process.env[ENTORNOS[entorno]];
if (!url) salir(`Falta ${ENTORNOS[entorno]} (en el entorno o en web/.env.entornos.local). Ver docs/DESPLIEGUE.md.`);
if (!/^postgres(ql)?:\/\//.test(url)) salir(`${ENTORNOS[entorno]} debe ser una cadena postgresql://…`);
if (/127\.0\.0\.1|localhost/.test(url) && !process.env.DB_PUSH_PERMITIR_LOCAL) {
  salir(`${ENTORNOS[entorno]} apunta a una base local; use npm run db:reset para local.`);
}

if (entorno === "prod") {
  if (process.env.SUPABASE_DB_URL_STAGING && process.env.SUPABASE_DB_URL_STAGING === url) {
    salir("SUPABASE_DB_URL_PROD es igual a la de staging.");
  }
  if (aplicar) {
    if (!flags.includes("--confirmo-produccion")) salir("Para producción agregue --confirmo-produccion.");
    if (sinPruebas) salir("En producción no se omiten las pruebas.");
    if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") salir("Producción solo se actualiza desde la rama main.");
    if (git("status", "--porcelain", "--", "supabase")) salir("Hay cambios sin commit en supabase/.");
    git("fetch", "-q", "origin", "main");
    if (git("rev-parse", "HEAD") !== git("rev-parse", "origin/main")) salir("main local no es igual a origin/main (haga pull/push).");
  }
}

console.log(`Entorno: ${entorno}  ·  base: ${ocultar(url)}`);
console.log("Migraciones pendientes:");
if (supabase(["db", "push", `--remote=${url}`, "--dry-run"]) !== 0) salir("No se pudo consultar la base remota.");

if (!aplicar) {
  console.log("\n(Solo consulta. Agregue --aplicar para aplicar.)");
  process.exit(0);
}

if (!sinPruebas) {
  console.log("\nPruebas pgTAP locales (supabase test db)…");
  if (supabase(["test", "db"]) !== 0) salir("Las pruebas fallaron o Supabase local no está encendido (npm run db:start).");
}

console.log(`\nAplicando en ${entorno}…`);
if (supabase(["db", "push", `--remote=${url}`, "--yes"]) !== 0) salir("db push falló. Revise el mensaje de arriba; la migración que falla se revierte sola.");
console.log(`\n✔ ${entorno} actualizado.`);
