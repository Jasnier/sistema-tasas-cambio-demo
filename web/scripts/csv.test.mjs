// Pruebas del formato CSV de exportarCsv.js.  npm run test:unit
import test from "node:test";
import assert from "node:assert/strict";
import { aCsv, leerCsv } from "./csv.mjs";

test("ida y vuelta: textos, números, fechas de serie, booleanos y huecos", () => {
  const filas = [
    ["id_registro", "fecha", "monto", "tasa", "nota"],
    ["LN-0001", 46336.5, 1250000, 1080.35, 'dijo "hola", y se fue'],
    ["00123", "", -15, 0.0004, "línea 1\nlínea 2"],
    [],
    ["SB-0002", 46337, true, false],
    ["1080", 1080],
  ];
  assert.deepEqual(leerCsv(aCsv(filas)), filas);
});

test("un texto que parece número sigue siendo texto (ceros a la izquierda)", () => {
  const [[a, b]] = leerCsv('"00123",123');
  assert.equal(a, "00123");
  assert.equal(b, 123);
});

test("recorta celdas vacías al final de la fila y filas vacías al final, como la API de Sheets", () => {
  assert.deepEqual(leerCsv('"a",,\r\n,,\r\n"b",1,\r\n,,\r\n,,'), [["a"], [], ["b", 1]]);
});

test("acepta BOM y fin de línea solo \n", () => {
  assert.deepEqual(leerCsv('﻿"x",2\n"y",3\n'), [["x", 2], ["y", 3]]);
});

test("rechaza un valor sin comillas que no es número (archivo editado a mano o de otro programa)", () => {
  assert.throws(() => leerCsv('"a",hola'), /no es número/);
});
