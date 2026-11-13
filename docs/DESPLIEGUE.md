# Despliegue: local, Supabase Cloud y Vercel

| Entorno | Base de datos | Frontend | Para qué |
|---|---|---|---|
| **local** | Supabase en Docker (`npm run db:start`) | `npm run dev` | Desarrollo y pruebas; `db reset` sin miedo |
| **producción** | Proyecto de Supabase Cloud | Vercel (*Root Directory* = `web`) | Operación |

## Decisiones

| Decisión | Por qué |
|---|---|
| El entorno de desarrollo es local, no un proyecto en la nube | Más rápido, sin costo, y la base se puede recrear en segundos |
| Las migraciones solo se aplican desde el repositorio, nunca a mano en el Dashboard | Lo que llega a producción es exactamente lo que se probó |
| Una migración aplicada no se edita: se crea otra | El historial del esquema es reproducible |
| Las semillas nunca salen de local | `seed.sql` crea usuarios demo con contraseña conocida |
| Sin registro abierto en producción | Los usuarios se invitan; nadie puede crearse una cuenta solo |
| Base y servidor en la misma región | Cada consulta es un viaje corto |

## 1. Proyecto de Supabase

En el Dashboard del proyecto:

| Dónde | Valor |
|---|---|
| Authentication → Sign In / Providers → *Allow new users to sign up* | **Desactivado** |
| Authentication → URL Configuration → *Site URL* y *Redirect URLs* | el dominio de Vercel (+ `/**`) |
| Authentication → Policies → largo mínimo de contraseña | **10** |
| Authentication → Emails → SMTP | SMTP propio (el integrado solo envía unos pocos correos por hora) |
| Database → Backups | Respaldos diarios (plan Pro) antes de cargar datos reales |

No usar `supabase config push`: subiría la configuración local (registro abierto, URL 127.0.0.1).

## 2. Variables

**Vercel** → *Settings → Environment Variables*: `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
(Dashboard de Supabase → Project Settings → API Keys).

**Desde el computador**, para aplicar migraciones: crear `web/.env.entornos.local` (git lo ignora) con la cadena de
conexión del *Session pooler*:

```
SUPABASE_DB_URL_PROD=postgresql://postgres.<ref>:<contraseña>@<region>.pooler.supabase.com:5432/postgres
```

## 3. Aplicar migraciones

Desde `web/`:

```bash
npm run db:push:prod                                     # muestra qué falta, no cambia nada
npm run db:push:prod -- --aplicar --confirmo-produccion  # corre pgTAP local y aplica
```

`scripts/db-push.mjs` se niega a aplicar si la rama no es `main`, si hay cambios sin commitear o si la cadena apunta a
una base local, y siempre corre las pruebas pgTAP antes.

## 4. Primer usuario

1. Authentication → Users → *Invite user* con el correo del superadmin.
2. Cambiar el correo en [`web/scripts/bootstrap-superadmin.sql`](../web/scripts/bootstrap-superadmin.sql) y ejecutarlo
   en el SQL Editor. Si ya existe un superadmin, no hace nada.
3. El superadmin invita al resto y asigna roles desde la aplicación (*Roles y permisos*).
