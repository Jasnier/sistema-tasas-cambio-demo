-- STW-16: carga de comprobantes de Brasil (migración 0900). No usa seed.sql.
begin;
create extension if not exists pgtap with schema extensions;
-- Independiente de los datos que dejen las pruebas e2e: se vacía dentro de esta transacción (rollback)
delete from public.comprobante_brasil; delete from public.consecutivo_banco;
select plan(20);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b1', 't-paula@prueba.local', '{"nombre":"Paula"}'),
  ('00000000-0000-0000-0000-0000000000b2', 't-apropia@prueba.local', '{"nombre":"Apropia"}'),
  ('00000000-0000-0000-0000-0000000000b3', 't-oper2@prueba.local', '{"nombre":"Oper"}'),
  ('00000000-0000-0000-0000-0000000000b4', 't-admin2@prueba.local', '{"nombre":"Admin"}');
insert into public.usuario_rol (usuario_id, rol_id) values
  ('00000000-0000-0000-0000-0000000000b1', 'brasil'),
  ('00000000-0000-0000-0000-0000000000b2', 'brasil_operador'),
  ('00000000-0000-0000-0000-0000000000b3', 'cliente_grande'),   -- sin permisos de Brasil (los operadores sí apropian desde la 2400)
  ('00000000-0000-0000-0000-0000000000b4', 'administradora');

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

-- ------------------------------------------------------------------ carga
select pg_temp.como('t-paula@prueba.local');
insert into public.comprobante_brasil (banco_id, fecha, id_tx, remitente, tipo, valor, estado, codigo)
values ('BTG_GAMMA', '2026-11-10', '  E2E-001 ', ' Maria ', 'ENTRADA', 1500.50, 'APLICADO', 'X');
select is((select codigo from public.comprobante_brasil where id_tx = 'E2E-001'), 'BR-BTG_GAMMA-00001',
  'el código lo pone la base: BR-<banco>-00001 (se ignora el que mande la app)');
select is((select estado::text from public.comprobante_brasil where id_tx = 'E2E-001'), 'PENDIENTE',
  'un comprobante nuevo siempre entra PENDIENTE');
select is((select remitente from public.comprobante_brasil where id_tx = 'E2E-001'), 'Maria', 'textos sin espacios al borde');
select is((select creado_por from public.comprobante_brasil where id_tx = 'E2E-001'),
  '00000000-0000-0000-0000-0000000000b1'::uuid, 'creado_por = quien carga');
insert into public.comprobante_brasil (banco_id, fecha, id_tx, tipo, valor) values ('BTG_GAMMA', '2026-11-10', 'E2E-002', 'SALIDA', 20);
insert into public.comprobante_brasil (banco_id, fecha, id_tx, tipo, valor) values ('CORA_BETA', '2026-11-10', 'E2E-001', 'ENTRADA', 20);
select results_eq($$ select codigo from public.comprobante_brasil where id_tx like 'E2E-%' order by codigo $$,
  $$ values ('BR-BTG_GAMMA-00001'), ('BR-BTG_GAMMA-00002'), ('BR-CORA_BETA-00001') $$,
  'consecutivo propio por banco; el mismo id_tx puede existir en otro banco (P-15)');
select throws_ok($$ insert into public.comprobante_brasil (banco_id, fecha, id_tx, tipo, valor)
                    values ('BTG_GAMMA', '2026-11-11', 'e2e-001', 'ENTRADA', 5) $$,
  '23505', null, 'P-15: id_tx repetido en el mismo banco se rechaza (sin importar mayúsculas)');
select throws_ok($$ insert into public.comprobante_brasil (banco_id, fecha, id_tx, tipo, valor)
                    values ('BTG_GAMMA', '2026-11-11', 'E2E-009', 'ENTRADA', 0) $$, '23514', null, 'el valor debe ser positivo');
select throws_ok($$ insert into public.comprobante_brasil (banco_id, fecha, id_tx, tipo, valor)
                    values ('BTG_GAMMA', '2026-11-11', '   ', 'ENTRADA', 5) $$, '23514', null, 'id_tx obligatorio');

-- ------------------------------------------------------------------ edición y anulación
select lives_ok($$ update public.comprobante_brasil set valor = 1600 where id_tx = 'E2E-001' and banco_id = 'BTG_GAMMA' $$,
  'un comprobante PENDIENTE se puede corregir');
select throws_like($$ update public.comprobante_brasil set banco_id = 'CORA_BETA' where id_tx = 'E2E-002' $$,
  '%no se cambian%', 'el banco no se cambia');
select throws_like($$ update public.comprobante_brasil set estado = 'APLICADO' where id_tx = 'E2E-002' $$,
  '%lo asigna la apropiación%', 'la carga no marca APLICADO');
select throws_ok($$ update public.comprobante_brasil set estado = 'ANULADO' where id_tx = 'E2E-002' $$,
  '23514', null, 'anular exige motivo');
select lives_ok($$ update public.comprobante_brasil set estado = 'ANULADO', anulado_motivo = 'Cargado dos veces' where id_tx = 'E2E-002' $$,
  'anular con motivo');
select is((select anulado_por from public.comprobante_brasil where id_tx = 'E2E-002'),
  '00000000-0000-0000-0000-0000000000b1'::uuid, 'queda quién anuló');
update public.comprobante_brasil set valor = 1 where id_tx = 'E2E-002';
select is((select valor from public.comprobante_brasil where id_tx = 'E2E-002'), 20.00::numeric,
  'un anulado ya no se modifica (RLS lo oculta para editar)');
delete from public.comprobante_brasil where id_tx = 'E2E-001';
select is((select count(*) from public.comprobante_brasil where id_tx = 'E2E-001'), 2::bigint, 'nadie borra comprobantes');
select pg_temp.reset();

-- ------------------------------------------------------------------ quién ve
select pg_temp.como('t-apropia@prueba.local');
select is((select count(*) from public.comprobante_brasil where id_tx like 'E2E-%'), 3::bigint, 'quien apropia ve los comprobantes');
select throws_ok($$ insert into public.comprobante_brasil (banco_id, fecha, id_tx, tipo, valor) values ('BTG_GAMMA', '2026-11-10', 'E2E-050', 'ENTRADA', 5) $$,
  '42501', null, 'quien apropia no carga');
select pg_temp.reset();
select pg_temp.como('t-oper2@prueba.local');
select is((select count(*) from public.comprobante_brasil), 0::bigint, 'quien no tiene permisos de Brasil (cliente grande) no ve los comprobantes');
select pg_temp.reset();

select ok((select count(*) from public.auditoria where tabla = 'comprobante_brasil') >= 5, 'cargas, correcciones y anulación auditadas');

select * from finish();
rollback;
