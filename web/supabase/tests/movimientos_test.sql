-- Sprint 4 (migración 1200): registro, edición, verificación, desbloqueo y duplicados. No usa seed.sql.
begin;
create extension if not exists pgtap with schema extensions;
-- Independiente de los datos de las pruebas e2e: se vacía dentro de esta transacción (rollback)
delete from public.caja_ganancia; delete from public.ganancia_movimiento;
update public.comprobante_brasil set movimiento_id = null where movimiento_id is not null;   -- comprobantes apropiados (2100)
delete from public.movimiento_utilidad; delete from public.movimiento; delete from public.saldo_bucket;
delete from public.consecutivo where libro_id in (select id from public.libro where codigo in ('OPERADOR_LAURA', 'OPERADOR_SANTIAGO', 'COMNORTE'));
select plan(33);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1', 't4-laura@prueba.local', '{"nombre":"Laura T4"}'),
  ('00000000-0000-0000-0000-0000000000e2', 't4-seb@prueba.local', '{"nombre":"Seb T4"}'),
  ('00000000-0000-0000-0000-0000000000e3', 't4-admin@prueba.local', '{"nombre":"Admin T4"}'),
  ('00000000-0000-0000-0000-0000000000e4', 't4-comnorte@prueba.local', '{"nombre":"Comnorte T4"}');
insert into public.usuario_rol values
  ('00000000-0000-0000-0000-0000000000e1', 'operador'),
  ('00000000-0000-0000-0000-0000000000e2', 'operador'),
  ('00000000-0000-0000-0000-0000000000e3', 'administradora'),
  ('00000000-0000-0000-0000-0000000000e4', 'cliente_grande');
insert into public.libro_usuario (libro_id, usuario_id)
  select id, '00000000-0000-0000-0000-0000000000e1'::uuid from public.libro where codigo = 'OPERADOR_LAURA' union all
  select id, '00000000-0000-0000-0000-0000000000e2'::uuid from public.libro where codigo = 'OPERADOR_SANTIAGO' union all
  select id, '00000000-0000-0000-0000-0000000000e4'::uuid from public.libro where codigo = 'COMNORTE';
insert into public.moneda (id, nombre) values ('T4-S', 'T4SOL'), ('T4-C', 'T4COP') on conflict do nothing;
insert into public.contraparte (id, tipo, nombre) values ('CT-94001', 'CLIENTE', 'Cliente T4'), ('CT-94002', 'ALIADO', 'Comnorte T4') on conflict do nothing;
update public.libro set contraparte_id = 'CT-94002', operador_id = (select id from public.libro where codigo = 'OPERADOR_LAURA') where codigo = 'COMNORTE';

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
create or replace function pg_temp.libro(p_codigo text) returns text language sql as $$ select id::text from public.libro where codigo = p_codigo $$;
-- Datos base de un movimiento; cada prueba cambia lo que necesita
create or replace function pg_temp.mov(p_libro text, p_tx text, p_monto numeric default 100, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('libro_id', pg_temp.libro(p_libro), 'id_transaccion', p_tx, 'tipo', 'ENTRADA',
    'fecha', '2026-11-05', 'hora', '09:30', 'modalidad', 'transferencia', 'contraparte_id', 'CT-94001',
    'moneda_origen', 't4sol', 'moneda_destino', 'T4COP', 'monto_origen', p_monto) || p_extra;
$$;
create or replace function pg_temp.idm(p_tx text) returns uuid language sql as $$
  select id from public.movimiento where id_transaccion = p_tx and estado <> 'ANULADO' $$;
grant execute on function pg_temp.libro(text), pg_temp.mov(text, text, numeric, jsonb), pg_temp.idm(text) to authenticated;

-- ------------------------------------------------------------ STW-22 crear
select pg_temp.como('t4-laura@prueba.local');
select is((public.crear_movimiento(pg_temp.mov('OPERADOR_LAURA', 'TX-1'))).codigo, 'LN-0001', 'primer registro de Laura: LN-0001');
select is((public.crear_movimiento(pg_temp.mov('OPERADOR_LAURA', 'TX-2', 250))).codigo, 'LN-0002', 'consecutivo sin huecos: LN-0002');
select is((select estado::text || ' ' || modalidad || ' ' || moneda_origen from public.movimiento where id_transaccion = 'TX-1'),
  'BORRADOR TRANSFERENCIA T4SOL', 'queda en BORRADOR con textos normalizados');
select is((select to_char(fecha_operacion at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') from public.movimiento where id_transaccion = 'TX-1'),
  '2026-11-05 09:30', 'fecha + hora en hora de Bogotá (P-8, T-7)');
select throws_ok($$ select public.crear_movimiento(pg_temp.mov('OPERADOR_LAURA', 'TX-3', 0)) $$, null, 'El monto debe ser mayor que cero', 'P-21: monto positivo');
select throws_ok($$ select public.crear_movimiento(pg_temp.mov('OPERADOR_LAURA', 'TX-3', 10.555)) $$, null, 'El monto admite máximo 2 decimales', 'máximo 2 decimales');
select throws_like($$ select public.crear_movimiento(pg_temp.mov('OPERADOR_LAURA', 'TX-3', 10, '{"fecha":"2030-01-01"}')) $$, '%en el futuro%', 'fecha futura rechazada');
select throws_ok($$ select public.crear_movimiento(pg_temp.mov('OPERADOR_LAURA', 'TX-3', 10, '{"descuento_tasa":true}')) $$, '42501', null,
  'P-3: el operador no aplica el descuento ×0,95');
select throws_ok($$ select public.crear_movimiento(pg_temp.mov('OPERADOR_SANTIAGO', 'TX-3')) $$, '42501', null, 'Laura no registra en el libro de Santiago');
select throws_ok($$ insert into public.movimiento (codigo, libro_id, id_transaccion, tipo, fecha_operacion, modalidad, contraparte_id, moneda_origen, moneda_destino, monto_origen)
  values ('LN-9999', pg_temp.libro('OPERADOR_LAURA')::uuid, 'X', 'ENTRADA', now(), 'EFECTIVO', 'CT-94001', 'T4SOL', 'T4COP', 1) $$, '42501', null, 'no se inserta directo: solo por la función');
select throws_ok($$ update public.movimiento set monto_origen = 1 $$, '42501', null, 'no se actualiza directo');

-- ------------------------------------------------------------ STW-25 duplicados
select throws_like($$ select public.crear_movimiento(pg_temp.mov('OPERADOR_LAURA', '  tx-1 ', 999)) $$, '%ya está registrado en LN-0001%',
  'P-15: mismo id de transacción (sin importar espacios ni mayúsculas) = error');
select throws_like($$ select public.crear_movimiento(pg_temp.mov('OPERADOR_LAURA', 'TX-10')) $$, 'POSIBLE_DUPLICADO: LN-0001%',
  'mismo cliente, moneda, tipo, monto y día: pide confirmar');
select is((public.crear_movimiento(pg_temp.mov('OPERADOR_LAURA', 'TX-10'), true)).duplicado_confirmado, true,
  'confirmado: se registra y queda marcado');
select is((select count(*)::int from public.movimiento_parecido where id = pg_temp.idm('TX-1')), 1, 'la bandeja ve el par parecido');
select lives_ok($$ select public.crear_movimiento(pg_temp.mov('OPERADOR_LAURA', 'TX-11', 100, '{"fecha":"2026-11-06"}')) $$,
  'otro día con el mismo monto no es duplicado');
select pg_temp.como('t4-seb@prueba.local');
select throws_like($$ select public.crear_movimiento(pg_temp.mov('OPERADOR_SANTIAGO', 'TX-2')) $$, '%ya está registrado en LN-0002 (Laura)%',
  'P-15: el id de transacción es único entre libros');
select is((select count(*)::int from public.movimiento), 0, 'Santiago no ve los movimientos de Laura');
select is((public.crear_movimiento(pg_temp.mov('OPERADOR_SANTIAGO', 'TX-S1', 77))).codigo, 'SB-0001', 'cada libro tiene su consecutivo');

-- ------------------------------------------------------------ cliente grande
select pg_temp.como('t4-comnorte@prueba.local');
select is((select contraparte_id || ' ' || codigo || ' ' || (operador_id is not null)::text
             from public.crear_movimiento(pg_temp.mov('COMNORTE', 'TX-C1', 50, '{"contraparte_id":"CT-94001"}'))),
  'CT-94002 CN-0001 true', 'el cliente grande registra siempre a su propio CT y queda ligado a su operador');
select pg_temp.como('t4-laura@prueba.local');
select public.enviar_registros_cliente(array[pg_temp.idm('TX-C1')]);   -- STW-42: su operador lo envía a verificación
select is((select count(*)::int from public.movimiento where codigo = 'CN-0001'), 1, 'Laura ve los movimientos de su cliente grande');

-- ------------------------------------------------------------ STW-24 verificar / desbloquear
select throws_ok($$ select public.verificar_movimientos(array[pg_temp.idm('TX-1')]) $$, '42501', null, 'el operador no verifica');
select pg_temp.como('t4-admin@prueba.local');
select is(public.verificar_movimientos(array[pg_temp.idm('TX-1'), pg_temp.idm('TX-2'), pg_temp.idm('TX-C1')]) -> 'hechos',
  '["CN-0001", "LN-0001", "LN-0002"]'::jsonb, 'la administración verifica por lote');
select is(public.verificar_movimientos(array[pg_temp.idm('TX-1')]) -> 'omitidos' -> 0 ->> 'motivo', 'está verificado',
  'lo ya verificado se omite con su motivo');
select lives_ok($$ select public.crear_movimiento(pg_temp.mov('OPERADOR_LAURA', 'TX-A1', 5, '{"descuento_tasa":true}')) $$,
  'P-3: la administración sí aplica el descuento');
select pg_temp.como('t4-laura@prueba.local');
select throws_like($$ select public.editar_movimiento(pg_temp.idm('TX-1'), pg_temp.mov('OPERADOR_LAURA', 'TX-1', 101)) $$, '%verificado%',
  'T-3: verificado no lo edita el operador');
select pg_temp.como('t4-admin@prueba.local');
select throws_ok($$ select public.desbloquear_movimientos(array[pg_temp.idm('TX-1')], '') $$, null, 'Escriba el motivo del desbloqueo',
  'desbloquear exige motivo');
select is(public.desbloquear_movimientos(array[pg_temp.idm('TX-1')], 'monto mal escrito') -> 'hechos', '["LN-0001"]'::jsonb, 'desbloqueo con motivo');
select pg_temp.como('t4-laura@prueba.local');
select is((public.editar_movimiento(pg_temp.idm('TX-1'), pg_temp.mov('OPERADOR_LAURA', 'TX-1', 101))).monto_origen, 101.00::numeric,
  'desbloqueado vuelve a BORRADOR y se puede corregir');
select pg_temp.reset();
select is((select count(*)::int from public.auditoria where tabla = 'movimiento' and registro_id = pg_temp.idm('TX-1')::text), 4,
  'auditado: creación, verificación, desbloqueo y corrección');

-- ------------------------------------------------------------ anular borrador
select pg_temp.como('t4-laura@prueba.local');
select throws_ok($$ select public.anular_borrador(pg_temp.idm('TX-11'), '') $$, null, 'Escriba el motivo de la anulación', 'anular exige motivo');
select is((public.anular_borrador(pg_temp.idm('TX-11'), 'registrado por error')).estado::text, 'ANULADO', 'el borrador queda ANULADO, no se borra');
select lives_ok($$ select public.crear_movimiento(pg_temp.mov('OPERADOR_LAURA', 'TX-11', 100, '{"fecha":"2026-11-06"}')) $$,
  'anulado libera el id de transacción');
select pg_temp.reset();

select * from finish();
rollback;
