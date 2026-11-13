# web — aplicación Next.js + Supabase

Guía técnica de la carpeta `web/`. La visión general del proyecto está en el [README principal](../README.md) y el
despliegue en [docs/DESPLIEGUE.md](../docs/DESPLIEGUE.md).

## Levantar en local

Requisitos: Node 20+ y Docker Desktop encendido.

```bash
npm install
npm run db:start                 # Supabase local en Docker (la primera vez descarga imágenes)
cp .env.example .env.local       # ya trae la clave por defecto del Supabase local
npm run dev                      # http://localhost:3000
```

Usuarios demo (solo local, contraseña `Local123!`):

| Correo | Rol |
|---|---|
| superadmin@tasas.local | superadmin |
| admin@tasas.local | administradora |
| laura@tasas.local, santiago@tasas.local | operador |
| comnorte@tasas.local, laz@tasas.local | cliente grande |
| paula@tasas.local | brasil |

Supabase Studio local: http://127.0.0.1:54323

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run db:reset` | Recrea la base local desde las migraciones + `supabase/seed.sql` |
| `npm run db:test` | Pruebas pgTAP de `supabase/tests/` |
| `npm run test:unit` | Pruebas unitarias con `node:test` |
| `npm run smoke -- <url>` | Recorre cada pantalla con cada rol (requiere la app corriendo) |
| `npm run e2e`, `e2e:brasil`, `e2e:tiempo-real` | Flujos completos contra Supabase local |
| `npm run oro -- <export.json>` | Pruebas de oro del cálculo contra un export del sistema anterior |
| `npm run importar:historial`, `importar:brasil`, `conciliar` | Migración del historial y conciliación de saldos |
| `npm run db:push:prod` | Aplica migraciones en producción (ver [DESPLIEGUE](../docs/DESPLIEGUE.md)) |

## Base de datos

- Migraciones en `supabase/migrations/`: una migración aplicada nunca se edita, se crea otra.
- La autorización real vive en la base: `tiene_permiso(codigo)`, `es_superadmin()` y RLS. La UI solo oculta.
- Los permisos `solo_superadmin` (`RECALCULAR_BUCKET`, `RECALCULAR_GANANCIAS`) no se pueden asignar ni delegar (trigger).
- Toda tabla de negocio lleva el trigger `auditar()`.
- Dinero en `numeric`, nunca `float`. Nada se borra: se anula.

## Importar el catálogo (CORE)

```bash
node scripts/importar-core.mjs scripts/fixtures/core-ejemplo.json            # simula y muestra el reporte
node scripts/importar-core.mjs scripts/fixtures/core-ejemplo.json --aplicar  # guarda en local
```

Importa monedas, empresas, medios de pago (con descuentos fijos por moneda), clientes y aliados, tasas cliente, tabla
de utilidad y beneficios, y liga cada libro de cliente grande a su contraparte. Cada fila que no entra queda en el
reporte con su motivo. Se puede repetir sin duplicar. El archivo de ejemplo es **inventado**.

## Pruebas de oro del cálculo

Comparan el cálculo de la web (`calcular_movimiento`) con lo que guardó el libro madre del sistema anterior,
movimiento por movimiento: tasa aplicada, monto destino, saldo, tasa de adquisición y utilidad.

```bash
npm run oro -- scripts/fixtures/movimientos-ejemplo.json
```

El detalle de cada diferencia queda en un `..._REPORTE_ORO.csv` junto al JSON. El archivo de ejemplo es **inventado**.
