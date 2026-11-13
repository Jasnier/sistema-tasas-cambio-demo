// Pruebas de traerTodo (corte de max_rows de Supabase).  npm run test:unit
import test from "node:test";
import assert from "node:assert/strict";
import { traerTodo, PAGINA } from "../src/lib/paginar.ts";

/** Simula PostgREST: `total` filas y un servidor que entrega como máximo `maxRows` por consulta. */
function servidor(total, maxRows = 1000) {
  const filas = Array.from({ length: total }, (_, i) => i);
  const llamadas = [];
  const pedir = async (desde, hasta) => {
    llamadas.push([desde, hasta]);
    return { data: filas.slice(desde, Math.min(hasta + 1, desde + maxRows)), error: null };
  };
  return { pedir, llamadas };
}

test("trae todo aunque haya más filas que max_rows", async () => {
  const { pedir } = servidor(2500);
  const r = await traerTodo(pedir);
  assert.equal(r.data.length, 2500);
  assert.deepEqual(r.data.slice(998, 1002), [998, 999, 1000, 1001]);
  assert.equal(r.truncado, false);
});

test("funciona si el servidor corta en menos que la página (max_rows = 300)", async () => {
  const { pedir } = servidor(1234, 300);
  const r = await traerTodo(pedir);
  assert.deepEqual(r.data, Array.from({ length: 1234 }, (_, i) => i));
});

test("sin filas y con un múltiplo exacto de la página", async () => {
  assert.deepEqual((await traerTodo(servidor(0).pedir)).data, []);
  const { pedir, llamadas } = servidor(PAGINA * 2);
  assert.equal((await traerTodo(pedir)).data.length, PAGINA * 2);
  assert.deepEqual(llamadas[1], [PAGINA, PAGINA * 2 - 1]);
});

test("avisa cuando pasa el tope en vez de cortar en silencio", async () => {
  const r = await traerTodo(servidor(5000).pedir, 3000);
  assert.equal(r.data.length, 3000);
  assert.equal(r.truncado, true);
});

test("devuelve el error de la consulta", async () => {
  const r = await traerTodo(async () => ({ data: null, error: { message: "permiso denegado" } }));
  assert.equal(r.error?.message, "permiso denegado");
});
