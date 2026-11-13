// Prueba de humo local: inicia sesión con cada usuario de prueba y revisa qué páginas ve.
// Uso: node scripts/smoke.mjs [baseUrl]   (requiere `npx supabase start` y la app corriendo)
import { createServerClient } from "@supabase/ssr";

const BASE = process.argv[2] ?? "http://localhost:3100";
const URL_SB = "http://127.0.0.1:54321";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

async function cookiesDeSesion(correo) {
  const jar = new Map();
  const sb = createServerClient(URL_SB, KEY, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach((c) => jar.set(c.name, c.value)) },
  });
  const { error } = await sb.auth.signInWithPassword({ email: correo, password: "Local123!" });
  if (error) throw new Error(`${correo}: ${error.message}`);
  return [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
}

async function pedir(ruta, cookie) {
  const r = await fetch(BASE + ruta, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  // React separa textos interpolados con <!-- -->: se quitan para comparar el texto como se ve
  return { status: r.status, location: r.headers.get("location"), html: r.status === 200 ? (await r.text()).replaceAll("<!-- -->", "") : "" };
}

const casos = [
  // [usuario, ruta, esperado: 200 | "redirige", texto que debe aparecer (200) o que NO debe filtrarse (redirige)]
  [null, "/", "redirige"],
  ["superadmin@tasas.local", "/", 200, "RECALCULAR_BUCKET"],
  ["superadmin@tasas.local", "/admin/roles", 200, "Roles y permisos"],
  ["admin@tasas.local", "/admin/roles", 200, "Permisos cedidos"],
  ["admin@tasas.local", "/admin/auditoria", 200, "Auditoría"],
  ["laura@tasas.local", "/", 200, "Laura (operador)"],
  ["laura@tasas.local", "/admin/roles", "redirige", "Permisos cedidos"],
  ["comnorte@tasas.local", "/admin/auditoria", "redirige", "Últimos 200 cambios"],
  // Sprint 2
  ["admin@tasas.local", "/catalogos", 200, "Monedas"],
  ["admin@tasas.local", "/catalogos?t=contraparte", 200, "CT-72"],
  ["admin@tasas.local", "/catalogos?t=recibido_en", 200, "AGENTE BCP"],
  ["admin@tasas.local", "/tasas", 200, "SOL → COP"],
  ["admin@tasas.local", "/tasas?t=utilidad", 200, "Tabla de utilidad"],
  ["admin@tasas.local", "/beneficios", 200, "LUCAS ALZATE"],
  ["laura@tasas.local", "/tasas", "redirige", "Nuevo borrador"],
  ["laura@tasas.local", "/beneficios", "redirige", "LUCAS ALZATE"],
  // STW-16: comprobantes de Brasil
  ["paula@tasas.local", "/brasil", 200, "Nuevo registro"],
  ["paula@tasas.local", "/brasil?banco=CORA_ALFA", 200, "CORA ALFA"],
  ["admin@tasas.local", "/brasil", 200, "INTER GAMMA"],
  ["laura@tasas.local", "/brasil", 200, "Brasil · comprobantes"],   // 2400: los operadores ven Brasil (sin cargar)
  // Sprint 3: resumen, bandeja y conciliación de Brasil
  ["paula@tasas.local", "/brasil/resumen", 200, "Saldos por día"],
  ["paula@tasas.local", "/brasil/resumen?v=binance", 200, "Total USDT"],
  ["paula@tasas.local", "/brasil/bandeja", "redirige", "por apropiar"],
  ["admin@tasas.local", "/brasil/bandeja", 200, "por apropiar"],
  ["laura@tasas.local", "/brasil/resumen", 200, "Saldos por día"],
  ["laura@tasas.local", "/brasil/bandeja", 200, "por apropiar"],
  ["comnorte@tasas.local", "/brasil/bandeja", "redirige", "por apropiar"],
  // Sprint 4: movimientos (STW-22 a 25) y diseño (STW-63)
  ["laura@tasas.local", "/movimientos", 200, "LN-0001"],
  ["laura@tasas.local", "/movimientos", 200, "parecido a LN-0004"],
  ["laura@tasas.local", "/movimientos?estado=VERIFICADO", 200, "Verificado"],
  ["laura@tasas.local", "/movimientos/nuevo", 200, "Registrar movimiento"],
  ["laura@tasas.local", "/movimientos/exportar", 200, "Código;Libro"],
  ["santiago@tasas.local", "/movimientos?q=4470012001", 200, "No hay movimientos"],
  ["comnorte@tasas.local", "/movimientos/nuevo", 200, "COMNORTE · CT-70"],
  ["admin@tasas.local", "/movimientos", 200, "Verificar seleccionados"],
  ["admin@tasas.local", "/", 200, "Accesos"],
  ["paula@tasas.local", "/movimientos", "redirige", "Exportar a Excel"],
  ["paula@tasas.local", "/movimientos/nuevo", "redirige", "Id de transacción"],
  // Sprint 5: aprobación (STW-28 a 30)
  ["admin@tasas.local", "/aprobacion", 200, "LN-0002"],
  ["admin@tasas.local", "/aprobacion", 200, "Vista previa"],
  ["admin@tasas.local", "/movimientos?estado=APROBADO", 200, "1.350.000,00"],
  ["admin@tasas.local", "/saldos", 200, "CLIENTE DEMO 69"],
  ["laura@tasas.local", "/aprobacion", "redirige", "Vista previa"],
  ["laura@tasas.local", "/saldos", 200, "1.350.000,00"],
  ["paula@tasas.local", "/saldos", "redirige", "CLIENTE DEMO 69"],
  // Rechazo, anulación, períodos, estado de cuenta y gastos (STW-31, 36, 61, 39, 55)
  ["comnorte@tasas.local", "/movimientos?estado=RECHAZADO", 200, "El comprobante no se lee"],
  ["laura@tasas.local", "/movimientos", 200, "Rechazar seleccionados"],
  ["admin@tasas.local", "/estado-cuenta?ct=CT-69&moneda=COP&modalidad=TRANSFERENCIA", 200, "1.350.000,00"],
  ["admin@tasas.local", "/estado-cuenta/exportar?ct=CT-69&moneda=COP&modalidad=TRANSFERENCIA", 200, "Saldo inicial"],
  ["admin@tasas.local", "/finanzas/gastos", 200, "G-0001"],
  ["laura@tasas.local", "/finanzas/gastos", "redirige", "Inmobiliaria demo"],
  ["paula@tasas.local", "/estado-cuenta", "redirige", "Ver estado de cuenta"],
  // Sprint 6 (STW-33, 34, 35, 37, 38, 40, 56, 57, 62)
  ["admin@tasas.local", "/saldos", 200, "Resumen por cliente"],
  ["admin@tasas.local", "/saldos?v=comparacion", 200, "Todos los saldos cuadran"],
  ["superadmin@tasas.local", "/saldos?v=detalle", 200, "Recalcular"],
  ["admin@tasas.local", "/saldos/exportar", 200, "CT;Cliente"],
  ["laura@tasas.local", "/saldos?v=comparacion", 200, "Resumen por cliente"],
  ["admin@tasas.local", "/admin/utilidad", 200, "Quitar toda la utilidad"],
  ["laura@tasas.local", "/admin/utilidad", "redirige", "Quitar toda la utilidad"],
  ["admin@tasas.local", "/admin/periodos", 200, "en curso"],
  ["laura@tasas.local", "/admin/periodos", "redirige", "Cerrar período"],
  ["admin@tasas.local", "/finanzas/negociaciones", 200, "NEG-00001"],
  ["admin@tasas.local", "/finanzas/resumen-operativo", 200, "Puntos promedio"],
  ["laura@tasas.local", "/finanzas/resumen-operativo", "redirige", "Puntos promedio"],
  ["admin@tasas.local", "/movimientos?estado=APROBADO", 200, "Edición masiva de aprobados"],
  ["laura@tasas.local", "/movimientos?estado=APROBADO", 200, "LN-0001"],
  // Sprint 7 (STW-41 a 44, 58)
  ["laz@tasas.local", "/portal", 200, "Mi cuenta · Lucas Alzate"],
  ["laz@tasas.local", "/portal", 200, "LAZ-0003"],
  ["laz@tasas.local", "/portal", 200, "lo atiende Laura"],
  ["laz@tasas.local", "/ganancias", 200, "UTIL-LAZ-0001"],
  ["laz@tasas.local", "/portal", 200, "Mis registros recientes"],
  ["laura@tasas.local", "/movimientos?estado=BORRADOR", 200, "Enviar a verificación (clientes grandes)"],
  ["comnorte@tasas.local", "/ganancias", 200, "No hay clientes con ganancias activas"],
  ["laura@tasas.local", "/ganancias", "redirige", "UTIL-LAZ-0001"],
  ["laura@tasas.local", "/portal", "redirige", "Mi cuenta"],
  ["laura@tasas.local", "/movimientos", 200, "LAZ-0001"],
  ["admin@tasas.local", "/ganancias", 200, "29.700,00"],
  ["admin@tasas.local", "/admin/clientes", 200, "Lucas Alzate"],
  ["admin@tasas.local", "/finanzas/estado-resultados", 200, "Utilidad neta"],
  ["admin@tasas.local", "/aprobacion", 200, "Laura"],
  // Sprint 8 (STW-45, 47, 50)
  ["laz@tasas.local", "/ganancias", 200, "RET-LAZ-0001"],
  ["laz@tasas.local", "/ganancias", 200, "Registrar retiro"],
  ["admin@tasas.local", "/ganancias", 200, "24.700,00"],
  ["admin@tasas.local", "/admin/clientes", 200, "Retiros"],
  ["admin@tasas.local", "/saldos?v=sheets", 200, "Conciliación con Sheets"],
  ["laura@tasas.local", "/saldos?v=sheets", 200, "Resumen por cliente"],
];

let fallas = 0;
const cache = new Map();
for (const [correo, ruta, esperado, texto] of casos) {
  let cookie = null;
  if (correo) { if (!cache.has(correo)) cache.set(correo, await cookiesDeSesion(correo)); cookie = cache.get(correo); }
  const r = await pedir(ruta, cookie);
  // Una redirección puede llegar como 3xx o, si el layout ya empezó a transmitirse, como NEXT_REDIRECT en el stream.
  const redirige = (r.status >= 300 && r.status < 400) || r.html.includes("NEXT_REDIRECT");
  const okStatus = esperado === "redirige" ? redirige : r.status === esperado;
  const okTexto = !texto || (esperado === "redirige" ? !r.html.includes(texto) : r.html.includes(texto));
  const ok = okStatus && okTexto;
  if (!ok) fallas++;
  console.log(`${ok ? "OK  " : "FALLA"} ${correo ?? "(sin sesión)"} ${ruta} → ${r.status}${r.location ? " " + r.location : ""}${texto ? ` [${esperado === "redirige" ? (okTexto ? "sin filtrar: " : "SE FILTRA: ") : (okTexto ? "" : "falta: ")}${texto}]` : ""}`);
}
console.log(fallas ? `\n${fallas} falla(s)` : "\nTodo OK");
process.exit(fallas ? 1 : 0);
