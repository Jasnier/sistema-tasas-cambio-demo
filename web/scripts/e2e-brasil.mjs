// Prueba de punta a punta de la carga de comprobantes de Brasil (STW-16). Solo información: hoy no se cargan archivos.
// Usa las mismas llamadas que src/app/(app)/brasil/actions.ts y el formulario del navegador.
// Requiere `npx supabase start` con seed.sql. Se puede correr varias veces (ids únicos por corrida).
// Uso: node scripts/e2e-brasil.mjs
import { createClient } from "@supabase/supabase-js";

const URL_SB = "http://127.0.0.1:54321";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
let fallas = 0;
const ok = (cond, msg, extra = "") => { if (!cond) fallas++; console.log(`${cond ? "OK  " : "FALLA"} ${msg}${extra ? " — " + extra : ""}`); };

async function como(correo) {
  const sb = createClient(URL_SB, KEY, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email: correo, password: "Local123!" });
  if (error) throw error;
  return sb;
}

const paula = await como("paula@tasas.local");
const conteo = await como("comnorte@tasas.local");   // cliente grande: sin permisos de Brasil
const admin = await como("admin@tasas.local");
const corrida = Date.now().toString(36).toUpperCase();

// 2. Guardar el comprobante
const idTx = `E2E-${corrida}`;
let r = await paula.from("comprobante_brasil").insert({
  banco_id: "BTG_GAMMA", fecha: "2026-11-10", id_tx: idTx, tipo: "ENTRADA", valor: 2500.75,
  remitente: "Prueba e2e",
}).select("id, codigo, estado").single();
ok(!r.error && /^BR-BTG_GAMMA-\d{5}$/.test(r.data?.codigo) && r.data.estado === "PENDIENTE", "comprobante guardado PENDIENTE con código BR-BTG_GAMMA-nnnnn", r.error?.message ?? r.data?.codigo);
const idComp = r.data?.id;

r = await paula.from("comprobante_brasil").insert({ banco_id: "BTG_GAMMA", fecha: "2026-11-10", id_tx: ` ${idTx.toLowerCase()} `, tipo: "SALIDA", valor: 1 });
ok(r.error?.code === "23505", "P-15: mismo ID en el mismo banco se rechaza", r.error?.message);

// 3. Quien no tiene permisos de Brasil no ve los comprobantes
r = await conteo.from("comprobante_brasil").select("id").eq("id", idComp);
ok(!r.error && r.data.length === 0, "un cliente grande no ve los comprobantes de Brasil");

// 4. Anular con motivo (no se borra)
r = await paula.from("comprobante_brasil").update({ estado: "ANULADO", anulado_motivo: "Prueba e2e" }).eq("id", idComp).eq("estado", "PENDIENTE").select("estado");
ok(!r.error && r.data?.[0]?.estado === "ANULADO", "anular con motivo", r.error?.message);
r = await paula.from("comprobante_brasil").delete().eq("id", idComp).select("id");
const sigue = await admin.from("comprobante_brasil").select("id").eq("id", idComp);
ok(sigue.data?.length === 1, "nadie borra un comprobante");

console.log(fallas ? `\n${fallas} falla(s)` : "\nTodo OK");
process.exit(fallas ? 1 : 0);
