#!/usr/bin/env bash
# Ensayo de la migración (STW-49/50) en una base APARTE del Supabase local ("migracion"): no toca la base de desarrollo
# ni producción. Crea la estructura con todas las migraciones, importa el CORE y el historial reales y concilia.
#
#   bash scripts/ensayo-migracion.sh ../dev/datos/EXPORT_CORE_….json ../dev/datos/EXPORT_MOVIMIENTOS_….json [../dev/datos/EXPORT_HISTORIAL_….json]
#
# Ojo: `supabase db reset` recrea el contenedor y borra esta base; se vuelve a crear corriendo este script.
set -euo pipefail
cd "$(dirname "$0")/.."
CORE="${1:?Falta el export del CORE}"; MOV="${2:?Falta el export de movimientos}"; HIST="${3:-}"
DB=migracion

echo "1/4 Base de ensayo '$DB' con la estructura actual (sin datos de prueba)…"
docker exec supabase_db_web bash -c "
  psql -U postgres -qtAc 'drop database if exists $DB' && psql -U postgres -qtAc 'create database $DB' &&
  psql -U postgres -d $DB -q -c 'create extension btree_gist with schema public; create schema extensions;
    create extension pgcrypto with schema extensions; create extension \"uuid-ossp\" with schema extensions;' &&
  pg_dump -U postgres -d postgres --schema=public --schema=auth --schema=supabase_migrations --no-publications --no-subscriptions \
    --exclude-table-data='public.*' --exclude-table-data='auth.*' 2>/dev/null | psql -U postgres -d $DB -q >/dev/null 2>&1;
  pg_dump -U postgres -d postgres --data-only -t public.rol -t public.permiso -t public.rol_permiso -t public.modalidad -t public.banco_brasil 2>/dev/null \
    | psql -U postgres -d $DB -q >/dev/null 2>&1;
  pg_dump -U postgres -d postgres --data-only --column-inserts -t public.libro 2>/dev/null | sed -E \"s/'CT-[0-9]+'/NULL/g\" \
    | psql -U postgres -d $DB -q >/dev/null 2>&1;
  psql -U postgres -d $DB -qtAc 'update public.libro set operador_id = null'"
echo "2/4 CORE…";       node scripts/importar-core.mjs "$CORE" --db=$DB --aplicar | grep -E "^Export|filas con problema" || true
echo "3/4 Historial…";  node scripts/importar-historial.mjs "$MOV" ${HIST:+--historial="$HIST"} --db=$DB --aplicar
echo "4/4 Conciliación…"; node scripts/conciliar-saldos.mjs "$MOV" --db=$DB || true
