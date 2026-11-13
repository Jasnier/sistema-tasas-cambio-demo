-- Pruebas de seguridad (Sprint 1). Ejecutar: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- Simula una petición de la app como el usuario indicado
create or replace function pg_temp.como(p_correo text) returns void language plpgsql as $$
declare v_id uuid;
begin
  select id into v_id from public.usuario where correo = p_correo;
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.reset() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;

-- 1-4: permisos efectivos por rol
select pg_temp.como('superadmin@tasas.local');
select ok(public.tiene_permiso('RECALCULAR_BUCKET'), 'superadmin tiene permisos solo_superadmin');
select pg_temp.reset();
select pg_temp.como('admin@tasas.local');
select ok(public.tiene_permiso('GESTIONAR_ROLES'), 'administradora gestiona roles (P-22)');
select ok(not public.tiene_permiso('RECALCULAR_BUCKET'), 'administradora NO recalcula bucket (T-8)');
select pg_temp.reset();
select pg_temp.como('laura@tasas.local');
select ok(not public.tiene_permiso('APROBAR_MOVIMIENTO'), 'operador no aprueba');
select pg_temp.reset();

-- 5-6: la administradora no puede darse ni dar permisos de superadmin
select pg_temp.como('admin@tasas.local');
select throws_like(
  $$ insert into public.rol_permiso (rol_id, permiso) values ('administradora', 'RECALCULAR_BUCKET') $$,
  '%solo puede tenerlo el superadmin%', 'no se asigna un permiso solo_superadmin a un rol');
select throws_like(
  $$ insert into public.usuario_rol (usuario_id, rol_id) select id, 'superadmin' from public.usuario where correo = 'laura@tasas.local' $$,
  '%Solo el superadmin%', 'no se asigna el rol superadmin');

-- 7-8: P-30 delegar un permiso a una persona
select lives_ok(
  $$ insert into public.usuario_permiso (usuario_id, permiso) select id, 'FINANZAS' from public.usuario where correo = 'laura@tasas.local' $$,
  'administradora cede FINANZAS a Laura');
select pg_temp.reset();
select pg_temp.como('laura@tasas.local');
select ok(public.tiene_permiso('FINANZAS'), 'Laura tiene FINANZAS por delegación');

-- 9: un operador no puede cambiar permisos (RLS)
select throws_ok(
  $$ insert into public.rol_permiso (rol_id, permiso) values ('operador', 'APROBAR_MOVIMIENTO') $$,
  '42501', null, 'operador no modifica rol_permiso');

-- 10: un operador solo ve su libro y los de sus clientes
select results_eq(
  $$ select codigo from public.libro order by codigo $$,
  $$ values ('COMNORTE'), ('LUCAS_ALZATE'), ('OPERADOR_LAURA') $$,
  'Laura ve su libro y sus clientes grandes (P-1)');
select pg_temp.reset();

-- 11: la delegación quedó auditada
select ok(exists (select 1 from public.auditoria where tabla = 'usuario_permiso' and accion = 'INSERT'
                  and despues ->> 'permiso' = 'FINANZAS'), 'delegación auditada');

-- 12: la auditoría no se puede borrar desde la app
select pg_temp.como('admin@tasas.local');
select throws_ok($$ delete from public.auditoria $$, '42501', null, 'auditoría inmutable');
select pg_temp.reset();

-- 13: consecutivos sin repetir
-- Independiente de los datos (seed y e2e ya usan LN-): se reinicia dentro de la transacción (rollback)
delete from public.consecutivo where libro_id = (select id from public.libro where codigo = 'OPERADOR_LAURA');
select is(
  (select array_agg(public.siguiente_codigo((select id from public.libro where codigo = 'OPERADOR_LAURA'))) from generate_series(1, 3)),
  array['LN-0001', 'LN-0002', 'LN-0003'],
  'consecutivo LN- sin saltos ni repetidos');

select * from finish();
rollback;
