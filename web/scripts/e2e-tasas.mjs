// Prueba de punta a punta de las operaciones de las pantallas de tasas y beneficios (Sprint 2).
// Usa las mismas llamadas que las Server Actions. Requiere `npx supabase start` con seed.sql.
// Uso: node scripts/e2e-tasas.mjs
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
// Igual que src/lib/fechas.ts
const desdeInputBogota = (v) => `${v.length === 16 ? v + ":00" : v}-05:00`;
const rango = (d, h) => `[${d},${h}]`;
const leerRango = (r) => { const m = r?.match(/^[[(]"?([^",]*)"?,"?([^"\])]*)"?[\])]$/); return m ? { desde: m[1] || null, hasta: m[2] || null } : { desde: null, hasta: null }; };

const admin = await como("admin@tasas.local");
const laura = await como("laura@tasas.local");

// 1. Crear borrador USD→COP TRANSFERENCIA (no choca con la semilla)
const desde = desdeInputBogota("2027-01-01T00:00");
let r = await admin.from("tasa_cliente").insert({ moneda_origen: "usd", moneda_destino: "COP", modalidad: "TRANSFERENCIA", vigencia: rango(desde, "infinity"), valor: 3900 }).select().single();
ok(!r.error && r.data.estado === "MODIFICABLE", "admin crea borrador", r.error?.message ?? r.data.id);
const idA = r.data?.id;
ok(r.data?.moneda_origen === "USD", "moneda normalizada a mayúsculas", r.data?.moneda_origen);
const lr = leerRango(r.data?.vigencia);
ok(lr.desde && Date.parse(lr.desde) === Date.parse(desde) && lr.hasta === "infinity", "leerRango entiende el formato de Postgres", r.data?.vigencia);

// 2. Publicar
r = await admin.rpc("cerrar_tasa", { p_id: idA, p_recortar_anterior: true });
ok(!r.error && r.data?.estado === "CERRADO", "publicar (cerrar_tasa)", r.error?.message);

// 3. Segundo borrador que empieza después: publicar con recorte deja la anterior hasta justo antes
const desde2 = desdeInputBogota("2027-02-01T00:00");
r = await admin.from("tasa_cliente").insert({ moneda_origen: "USD", moneda_destino: "COP", modalidad: "TRANSFERENCIA", vigencia: rango(desde2, "infinity"), valor: 3950 }).select("id").single();
const idB = r.data?.id;
r = await admin.rpc("cerrar_tasa", { p_id: idB, p_recortar_anterior: true });
ok(!r.error, "publicar la nueva recortando la anterior", r.error?.message);
r = await admin.from("tasa_cliente").select("vigencia").eq("id", idA).single();
const hastaA = leerRango(r.data?.vigencia).hasta;
ok(hastaA && Date.parse(desde2) - Date.parse(hastaA) < 1000, "la anterior termina justo antes de la nueva (sin hueco)", hastaA);

// 4. Sin recorte, un cruce se rechaza con mensaje claro
r = await admin.from("tasa_cliente").insert({ moneda_origen: "USD", moneda_destino: "COP", modalidad: "TRANSFERENCIA", vigencia: rango(desdeInputBogota("2027-03-01T00:00"), "infinity"), valor: 4000 }).select("id").single();
r = await admin.rpc("cerrar_tasa", { p_id: r.data.id, p_recortar_anterior: false });
ok(!!r.error && /solapa/.test(r.error.message), "publicar sin recorte una tasa que se cruza: rechazada", r.error?.message);

// 5. Cambiar fin de una publicada (a futuro: permitido para administradora)
const { desde: dB } = leerRango((await admin.from("tasa_cliente").select("vigencia").eq("id", idB).single()).data.vigencia);
r = await admin.from("tasa_cliente").update({ vigencia: rango(dB, desdeInputBogota("2027-12-31T23:59")) }).eq("id", idB);
ok(!r.error, "cambiar fecha fin de una publicada", r.error?.message);
r = await admin.from("tasa_cliente").update({ valor: 1 }).eq("id", idB);
ok(!!r.error, "cambiar el valor de una publicada: rechazado", r.error?.message);

// 6. Operador: ve tasas cliente, no la utilidad, no crea tasas
r = await laura.from("tasa_cliente").select("id").eq("estado", "CERRADO");
ok(!r.error && r.data.length >= 2, "operador ve tasas cliente publicadas", String(r.data?.length));
r = await laura.from("tasa_utilidad").select("id");
ok(!r.error && r.data.length === 0, "operador NO ve la tabla de utilidad (margen)", String(r.data?.length));
r = await laura.from("tasa_cliente").insert({ moneda_origen: "SOL", moneda_destino: "COP", modalidad: "EFECTIVO", vigencia: rango(desde, "infinity"), valor: 1 });
ok(!!r.error, "operador no crea tasas", r.error?.code);

// 7. Beneficio: cambiar crea uno nuevo y cierra el anterior (P-5)
r = await admin.rpc("cambiar_beneficio", { p_contraparte: "CT-72", p_moneda_origen: "sol", p_moneda_destino: "cop", p_beneficio: 22, p_desde: new Date().toISOString() });
ok(!r.error && Number(r.data?.beneficio) === 22, "cambiar beneficio de CT-72 a 22", r.error?.message);
r = await admin.from("ajuste_cliente").select("id, beneficio, vigencia").eq("contraparte_id", "CT-72").order("vigencia");
ok(r.data?.length === 2 && leerRango(r.data[0].vigencia).hasta !== "infinity", "el beneficio anterior (20) queda cerrado, no borrado", r.data?.map((a) => `${a.beneficio}`).join(","));

// 8. Descuento BCP solo en SOL
r = await admin.rpc("descuento_recibido", { p_recibido_en: "RE-02", p_moneda_origen: "SOL" });
const d1 = r.data;
r = await admin.rpc("descuento_recibido", { p_recibido_en: "RE-02", p_moneda_origen: "REAL" });
ok(Number(d1) === 15 && Number(r.data) === 0, "Agente BCP: −15 en SOL y 0 en REAL", `${d1} / ${r.data}`);

console.log(fallas ? `\n${fallas} falla(s)` : "\nTodo OK");
process.exit(fallas ? 1 : 0);
