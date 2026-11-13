-- Migración 2300 (STW-32): qué tablas transmite Supabase Realtime. Que la RLS se respete por usuario lo prueba
-- scripts/e2e-tiempo-real.mjs (necesita el servicio de Realtime, no solo la base).
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'movimiento'),
  'movimiento se transmite en tiempo real (bandejas)');
select ok(not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'movimiento_utilidad'),
  'la utilidad de la casa NO se transmite');
select ok((select relrowsecurity from pg_class where oid = 'public.movimiento'::regclass),
  'movimiento tiene RLS: Realtime solo entrega a quien puede leer la fila');

select * from finish();
rollback;
