// Pruebas de parsearNumero.  npm run test:unit
import test from "node:test";
import assert from "node:assert/strict";
import { parsearNumero } from "../src/lib/numeros.ts";

const casos = [
  ["4100", 4100], ["4100.5", 4100.5], ["4100,5", 4100.5], ["4.100,50", 4100.5],
  ["1.080.000,25", 1080000.25], ["0.25", 0.25], ["0,25", 0.25], ["15", 15], [" 22 ", 22],
  ["-3", -3], ["3.5", 3.5], ["1234.567", 1234.567],
];
for (const [entrada, esperado] of casos) {
  test(`"${entrada}" → ${esperado}`, () => assert.equal(parsearNumero(entrada), esperado));
}

for (const ambiguo of ["4.100", "1.080", "0.250", "1.080.000", "-4.100"]) {
  test(`"${ambiguo}" es ambiguo y se rechaza (antes daba 4,1 en vez de 4.100)`, () =>
    assert.throws(() => parsearNumero(ambiguo, "valor"), /ambiguo/));
}

for (const malo of ["", "abc", "1,2,3", "12.34,5", "4.1000,5", "1e5", "--3", "4,"]) {
  test(`"${malo}" se rechaza`, () => assert.throws(() => parsearNumero(malo, "valor")));
}
