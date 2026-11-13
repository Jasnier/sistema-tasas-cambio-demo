// STW-32: Realtime entrega cada cambio de movimiento SOLO a quien puede leer esa fila (RLS de movimiento_leer).
// Uso (Supabase local encendido, con el seed): npm run e2e:tiempo-real
// Toca dos movimientos del seed sin cambiar datos (actualizado_en = actualizado_en): un borrador de Laura y uno de
// Santiago. Esperado: Laura recibe el suyo, Santiago el suyo, la administración los dos y el cliente LAZ ninguno.
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";

const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const psql = (sql) => execFileSync("docker", ["exec", "supabase_db_web", "psql", "-U", "postgres", "-tAc", sql], { encoding: "utf8" }).trim();
const esperado = { laura: ["LN-0003"], santiago: ["SB-0002"], laz: [], admin: ["LN-0003", "SB-0002"] };

const recibido = {}, canales = [];
for (const u of Object.keys(esperado)) {
  const sb = createClient("http://127.0.0.1:54321", KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: `${u}@tasas.local`, password: "Local123!" });
  if (error) { console.error(`${u}: ${error.message} (¿npm run db:start y el seed?)`); process.exit(2); }
  await sb.realtime.setAuth(data.session.access_token);
  recibido[u] = [];
  await new Promise((ok, mal) => {
    const c = sb.channel(`e2e-${u}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "movimiento" }, (p) => recibido[u].push(p.new.codigo))
      .subscribe((s, e) => (s === "SUBSCRIBED" ? ok() : s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? mal(new Error(`${u}: ${s} ${e?.message ?? ""}`)) : null));
    canales.push([sb, c]);
  });
}
// Realtime registra las suscripciones en la base un instante después de SUBSCRIBED
await new Promise((r) => setTimeout(r, 2000));

psql("update public.movimiento set actualizado_en = actualizado_en where codigo = 'LN-0003'");
psql("update public.movimiento set actualizado_en = actualizado_en where codigo = 'SB-0002'");
await new Promise((r) => setTimeout(r, 5000));

let ok = true;
for (const [u, quiere] of Object.entries(esperado)) {
  const tiene = [...recibido[u]].sort();
  const bien = JSON.stringify(tiene) === JSON.stringify([...quiere].sort());
  ok &&= bien;
  console.log(`${bien ? "OK   " : "FALLA"} ${u.padEnd(10)} recibió [${tiene.join(", ")}]  esperado [${quiere.join(", ")}]`);
}
for (const [sb, c] of canales) await sb.removeChannel(c);
console.log(ok ? "\nTodo OK" : "\nHay fallas");
process.exit(ok ? 0 : 1);
