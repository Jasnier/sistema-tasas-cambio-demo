-- Migración 2400: los operadores trabajan la bandeja de Brasil, sin ver los libros de los demás (P-1).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 't24-laura@prueba.local', '{"nombre":"Laura T24"}'),
  ('00000000-0000-0000-0000-0000000000a2', 't24-cliente@prueba.local', '{"nombre":"Cliente T24"}');
insert into public.usuario_rol values
  ('00000000-0000-0000-0000-0000000000a1', 'operador'),
  ('00000000-0000-0000-0000-0000000000a2', 'cliente_grande');
insert into public.libro_usuario (libro_id, usuario_id)
  select id, '00000000-0000-0000-0000-0000000000a1'::uuid from public.libro where codigo = 'OPERADOR_LAURA';
insert into public.comprobante_brasil (banco_id, fecha, id_tx, tipo, valor, remitente) values ('INTER_BETA', '2026-11-05', 'T24-A', 'ENTRADA', 100, 'Prueba T24');

create or replace function pg_temp.como(p_correo text) returns void language plpgsql as $$
declare v_id uuid;
begin
  perform set_config('role', 'postgres', true);
  select id into v_id from public.usuario where correo = p_correo;
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.reset() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;

select ok(exists (select 1 from public.rol_permiso where rol_id = 'operador' and permiso = 'BRASIL_APROPIAR'), 'el rol operador tiene BRASIL_APROPIAR');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'comprobante_brasil'),
  'la bandeja se actualiza sola: comprobante_brasil está en Realtime');

select pg_temp.como('t24-laura@prueba.local');
select is((select count(*) from public.comprobante_brasil where id_tx = 'T24-A'), 1::bigint, 'la operadora ve lo que Paula carga');
select is((public.tomar_comprobante((select id from public.comprobante_brasil where id_tx = 'T24-A'))).estado::text, 'EN_PROCESO',
  'la operadora toma un comprobante de la bandeja');
select ok(not exists (select 1 from public.libro where codigo = 'OPERADOR_SANTIAGO'),
  'P-1: la operadora sigue sin leer el libro de otro operador');
select ok((select count(*) from public.libros_destino_brasil()) >= 2
          and exists (select 1 from public.libros_destino_brasil() where codigo = 'OPERADOR_SANTIAGO'),
  'pero para apropiar ve la lista de libros destino (solo id, prefijo, nombre y tipo)');
select throws_ok($$ insert into public.comprobante_brasil (banco_id, fecha, id_tx, tipo, valor) values ('INTER_BETA', '2026-11-05', 'T24-B', 'ENTRADA', 1) $$,
  '42501', null, 'la operadora no carga comprobantes (eso es de Paula)');
select pg_temp.reset();

select pg_temp.como('t24-cliente@prueba.local');
select is((select count(*) from public.comprobante_brasil), 0::bigint, 'un cliente grande no ve la bandeja de Brasil');
select throws_ok($$ select * from public.libros_destino_brasil() $$, '42501', null, 'ni la lista de libros destino');
select pg_temp.reset();

select * from finish();
rollback;
