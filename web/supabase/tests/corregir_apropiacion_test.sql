-- Migración 2600: corregir una apropiación de Brasil y solicitar la liberación.
begin;
create extension if not exists pgtap with schema extensions;
delete from public.solicitud_liberacion;
select plan(22);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 't26-laura@prueba.local', '{"nombre":"Laura T26"}'),
  ('00000000-0000-0000-0000-0000000000c2', 't26-seb@prueba.local', '{"nombre":"Seb T26"}'),
  ('00000000-0000-0000-0000-0000000000c3', 't26-admin@prueba.local', '{"nombre":"Admin T26"}');
insert into public.usuario_rol values
  ('00000000-0000-0000-0000-0000000000c1', 'operador'),
  ('00000000-0000-0000-0000-0000000000c2', 'operador'),
  ('00000000-0000-0000-0000-0000000000c3', 'administradora');
insert into public.moneda (id, nombre) values ('3', 'REAL') on conflict do nothing;
insert into public.moneda (id, nombre) values ('T26-C', 'T26COP') on conflict do nothing;
insert into public.contraparte (id, tipo, nombre) values ('CT-96101', 'CLIENTE', 'Cliente T26') on conflict do nothing;
insert into public.comprobante_brasil (banco_id, fecha, id_tx, tipo, valor, remitente) values
  ('INTER_BETA', '2026-11-05', 'T26-A', 'ENTRADA', 100, 'Uno'),
  ('INTER_BETA', '2026-11-05', 'T26-B', 'ENTRADA', 200, 'Dos'),
  ('INTER_BETA', '2026-11-05', 'T26-C', 'ENTRADA', 300, 'Tres'),
  ('INTER_BETA', '2026-11-05', 'T26-D', 'ENTRADA', 400, 'Cuatro');
create temp table t_libro as select id, codigo from public.libro;
grant select on t_libro to authenticated;

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
create or replace function pg_temp.idc(p_tx text) returns uuid language sql as $$ select id from public.comprobante_brasil where id_tx = p_tx $$;
create or replace function pg_temp.lib(p text) returns uuid language sql as $$ select id from t_libro where codigo = p $$;
-- Toma y apropia como quien llama
create or replace function pg_temp.apropiar(p_tx text, p_libro text) returns text language plpgsql as $$
begin
  perform public.tomar_comprobante(pg_temp.idc(p_tx));
  return public.apropiar_comprobante(pg_temp.idc(p_tx), pg_temp.lib(p_libro), '09:00', 'TRANSFERENCIA', 'T26COP', null, null, 'CT-96101') ->> 'movimiento';
end $$;
create or replace function pg_temp.mov(p_tx text) returns text language sql as $$
  select m.estado::text || ' ' || l.codigo from public.comprobante_brasil c join public.movimiento m on m.id = c.movimiento_id join public.libro l on l.id = m.libro_id where c.id_tx = p_tx
$$;

-- ------------------------------------------------------------ 1. Laura se equivoca de libro y lo corrige ella misma
select pg_temp.como('t26-laura@prueba.local');
select pg_temp.apropiar('T26-A', 'OPERADOR_SANTIAGO');     -- se equivocó: era para su libro
select pg_temp.reset();
select is(pg_temp.mov('T26-A'), 'BORRADOR OPERADOR_SANTIAGO', 'Laura apropió T26-A al libro equivocado');
create temp table t_brs as select movimiento_id as id from public.comprobante_brasil where id_tx = 'T26-A';
grant select on t_brs to authenticated;
select pg_temp.como('t26-seb@prueba.local');
select throws_ok($$ select public.corregir_apropiacion(pg_temp.idc('T26-A'), 'no es mío') $$, '42501', null,
  'Santiago no corrige lo que apropió Laura (debe solicitarlo)');
select pg_temp.reset();
select pg_temp.como('t26-laura@prueba.local');
select throws_like($$ select public.corregir_apropiacion(pg_temp.idc('T26-A'), '') $$, '%motivo%', 'corregir pide motivo');
select is((public.corregir_apropiacion(pg_temp.idc('T26-A'), 'era para mi libro')).bloqueado_por, '00000000-0000-0000-0000-0000000000c1'::uuid,
  'al corregir, el comprobante queda tomado a nombre de Laura');
select pg_temp.reset();
select is((select estado::text || ': ' || anulado_motivo from public.movimiento where id = (select id from t_brs)),
  'ANULADO: Corrección de apropiación: era para mi libro', 'el BRS- del libro equivocado queda anulado con el motivo');
select is((select estado::text || ' ' || coalesce(movimiento_id::text, 'sin movimiento') from public.comprobante_brasil where id_tx = 'T26-A'),
  'EN_PROCESO sin movimiento', 'el comprobante vuelve, sin el movimiento viejo');
select pg_temp.como('t26-laura@prueba.local');
select ok(public.apropiar_comprobante(pg_temp.idc('T26-A'), pg_temp.lib('OPERADOR_LAURA'), '09:00', 'TRANSFERENCIA', 'T26COP', null, null, 'CT-96101') ->> 'movimiento' like 'BRS-LN-%',
  'y Laura lo apropia al libro correcto');
select pg_temp.reset();
select is(pg_temp.mov('T26-A'), 'BORRADOR OPERADOR_LAURA', 'ahora el BRS- está en el libro de Laura');

-- ------------------------------------------------------------ 2. Santiago necesita uno que apropió Laura
select pg_temp.como('t26-laura@prueba.local');
select pg_temp.apropiar('T26-B', 'OPERADOR_LAURA');
select throws_like($$ select public.solicitar_liberacion(pg_temp.idc('T26-B'), 'lo quiero') $$, '%puede corregirlo directamente%',
  'quien lo apropió no se lo solicita a sí mismo');
select pg_temp.reset();
select pg_temp.como('t26-seb@prueba.local');
select lives_ok($$ select public.solicitar_liberacion(pg_temp.idc('T26-B'), 'Ese pago es de mi cliente') $$, 'Santiago solicita la liberación');
select throws_like($$ select public.solicitar_liberacion(pg_temp.idc('T26-B'), 'otra vez') $$, '%Ya hay una solicitud%', 'no se duplica la solicitud');
select throws_ok($$ select public.responder_liberacion((select id from public.solicitud_liberacion limit 1), true) $$, '42501', null,
  'quien pidió no se la responde');
select pg_temp.reset();
select pg_temp.como('t26-laura@prueba.local');
select results_eq($$ select comprobante, solicitante, apropiador, estado from public.solicitudes_liberacion() where estado = 'PENDIENTE' $$,
  $$ select (select codigo from public.comprobante_brasil where id_tx = 'T26-B'), 'Seb T26'::text, 'Laura T26'::text, 'PENDIENTE'::text $$,
  'a Laura le llega la solicitud con el nombre de quien la pide');
select is((public.responder_liberacion((select id from public.solicitud_liberacion where estado = 'PENDIENTE'), true)).estado, 'ACEPTADA',
  'Laura acepta');
select pg_temp.reset();
select is((select estado::text || ' ' || bloqueado_por::text from public.comprobante_brasil where id_tx = 'T26-B'),
  'EN_PROCESO 00000000-0000-0000-0000-0000000000c2', 'el comprobante pasa directo a Santiago para que lo apropie');
select is((select count(*) from public.movimiento m join public.comprobante_brasil c on m.id_transaccion = c.id_tx
            where c.id_tx = 'T26-B' and m.estado <> 'ANULADO'), 0::bigint, 'el BRS- de Laura quedó anulado');

-- ------------------------------------------------------------ 3. Rechazo con motivo
select pg_temp.como('t26-laura@prueba.local');
select pg_temp.apropiar('T26-C', 'OPERADOR_LAURA');
select pg_temp.reset();
select pg_temp.como('t26-seb@prueba.local');
select public.solicitar_liberacion(pg_temp.idc('T26-C'), 'creo que es mío');
select pg_temp.reset();
select pg_temp.como('t26-laura@prueba.local');
select throws_like($$ select public.responder_liberacion((select id from public.solicitud_liberacion where estado = 'PENDIENTE'), false) $$,
  '%por qué no lo libera%', 'rechazar pide motivo');
select is((public.responder_liberacion((select id from public.solicitud_liberacion where estado = 'PENDIENTE'), false, 'Es de Comnorte, ya lo confirmé')).estado,
  'RECHAZADA', 'Laura rechaza con motivo');
select pg_temp.reset();
select is(pg_temp.mov('T26-C'), 'BORRADOR OPERADOR_LAURA', 'al rechazar, la apropiación sigue igual');

-- ------------------------------------------------------------ 4. Verificado: solo la administración
select pg_temp.como('t26-laura@prueba.local');
select pg_temp.apropiar('T26-D', 'OPERADOR_LAURA');
select pg_temp.reset();
update public.movimiento set estado = 'VERIFICADO', verificado_en = now()
 where id = (select movimiento_id from public.comprobante_brasil where id_tx = 'T26-D');
select pg_temp.como('t26-laura@prueba.local');
select throws_like($$ select public.corregir_apropiacion(pg_temp.idc('T26-D'), 'me equivoqué') $$, '%verificado: pida a la administración%',
  'verificado: la operadora ya no lo corrige');
select pg_temp.reset();
select pg_temp.como('t26-admin@prueba.local');
select lives_ok($$ select public.corregir_apropiacion(pg_temp.idc('T26-D'), 'corrección de la administración') $$, 'la administración sí lo corrige');
select pg_temp.reset();
alter table public.movimiento drop constraint aprobado_completo;   -- solo en esta prueba (rollback): simula un aprobado
update public.movimiento set estado = 'APROBADO' where id = (select movimiento_id from public.comprobante_brasil where id_tx = 'T26-C');
select pg_temp.como('t26-admin@prueba.local');
select throws_like($$ select public.corregir_apropiacion(pg_temp.idc('T26-C'), 'x x x') $$, '%ya está aprobado%',
  'aprobado: se anula desde Movimientos (recalcula el saldo)');
select pg_temp.reset();

select * from finish();
rollback;
