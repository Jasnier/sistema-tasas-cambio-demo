-- Migración 2900: arreglos de la auditoría (acceso de inactivos y sin rol, Brasil con rechazados, saldos por operador,
-- ganancia al corregir la moneda, protección del superadmin, comprobante anulado, permisos al entrar y períodos).
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000029d1', 't29-laura@prueba.local', '{"nombre":"Laura T29"}'),
  ('00000000-0000-0000-0000-0000000029d2', 't29-seb@prueba.local', '{"nombre":"Seb T29"}'),
  ('00000000-0000-0000-0000-0000000029d3', 't29-admin@prueba.local', '{"nombre":"Admin T29"}'),
  ('00000000-0000-0000-0000-0000000029d4', 't29-sinrol@prueba.local', '{"nombre":"Sin rol T29"}'),
  ('00000000-0000-0000-0000-0000000029d5', 't29-inactivo@prueba.local', '{"nombre":"Inactivo T29"}'),
  ('00000000-0000-0000-0000-0000000029d6', 't29-laz@prueba.local', '{"nombre":"LAZ T29"}'),
  ('00000000-0000-0000-0000-0000000029d7', 't29-super@prueba.local', '{"nombre":"Super T29"}'),
  ('00000000-0000-0000-0000-0000000029d8', 't29-paula@prueba.local', '{"nombre":"Paula T29"}');
insert into public.usuario_rol values
  ('00000000-0000-0000-0000-0000000029d1', 'operador'), ('00000000-0000-0000-0000-0000000029d2', 'operador'),
  ('00000000-0000-0000-0000-0000000029d3', 'administradora'), ('00000000-0000-0000-0000-0000000029d5', 'operador'),
  ('00000000-0000-0000-0000-0000000029d6', 'cliente_grande'), ('00000000-0000-0000-0000-0000000029d7', 'superadmin'),
  ('00000000-0000-0000-0000-0000000029d8', 'brasil');
insert into public.libro_usuario (libro_id, usuario_id)
  select id, '00000000-0000-0000-0000-0000000029d1'::uuid from public.libro where codigo = 'OPERADOR_LAURA' union all
  select id, '00000000-0000-0000-0000-0000000029d5'::uuid from public.libro where codigo = 'OPERADOR_LAURA' union all
  select id, '00000000-0000-0000-0000-0000000029d2'::uuid from public.libro where codigo = 'OPERADOR_SANTIAGO' union all
  select id, '00000000-0000-0000-0000-0000000029d6'::uuid from public.libro where codigo = 'LUCAS_ALZATE';
update public.usuario set activo = false where id = '00000000-0000-0000-0000-0000000029d5';

insert into public.moneda (id, nombre) values ('3', 'REAL') on conflict do nothing;
insert into public.moneda (id, nombre) values ('T29-C', 'T29COP'), ('T29-S', 'SOL'), ('T29-P', 'COP'), ('T29-U', 'USD') on conflict do nothing;
insert into public.contraparte (id, tipo, nombre) values ('CT-99101', 'CLIENTE', 'Cliente T29'), ('CT-99102', 'ALIADO', 'LAZ T29');
update public.libro set contraparte_id = 'CT-99102', usa_ganancias = true, operador_id = (select id from public.libro where codigo = 'OPERADOR_LAURA')
 where codigo = 'LUCAS_ALZATE';
insert into public.saldo_bucket (contraparte_id, moneda, modalidad, saldo, ultima_secuencia) values ('CT-99102', 'T29COP', 'TRANSFERENCIA', 25, 1);
-- Octubre (el seed tiene tasas desde noviembre: no se cruzan). Beneficio de LAZ: 20 en SOL, 10 en USD.
insert into public.tasa_cliente (id, moneda_origen, moneda_destino, modalidad, vigencia, valor, estado) values
  ('TB-T29-S', 'SOL', 'COP', 'TRANSFERENCIA', tstzrange('2026-10-01 00:00-05', '2026-10-31 23:59:59-05', '[]'), 1080, 'CERRADO'),
  ('TB-T29-U', 'USD', 'COP', 'TRANSFERENCIA', tstzrange('2026-10-01 00:00-05', '2026-10-31 23:59:59-05', '[]'), 4000, 'CERRADO');
insert into public.tasa_utilidad (id, moneda_origen, moneda_destino, puntos_efectivo, puntos_transferencia, vigencia, estado) values
  ('UT-T29-S', 'SOL', 'COP', 25, 30, tstzrange('2026-10-01 00:00-05', '2026-10-31 23:59:59-05', '[]'), 'CERRADO'),
  ('UT-T29-U', 'USD', 'COP', 50, 50, tstzrange('2026-10-01 00:00-05', '2026-10-31 23:59:59-05', '[]'), 'CERRADO');
insert into public.ajuste_cliente (id, contraparte_id, moneda_origen, moneda_destino, beneficio, vigencia) values
  ('AJ-T29-S', 'CT-99102', 'SOL', 'COP', 20, tstzrange('-infinity', 'infinity', '[]')),
  ('AJ-T29-U', 'CT-99102', 'USD', 'COP', 10, tstzrange('-infinity', 'infinity', '[]'));
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
create or replace function pg_temp.lib(p text) returns uuid language sql as $$ select id from t_libro where codigo = p $$;
create or replace function pg_temp.idc(p_tx text) returns uuid language sql as $$
  select id from public.comprobante_brasil where id_tx = p_tx and estado <> 'ANULADO' $$;
-- Toma y apropia como quien llama
create or replace function pg_temp.apropiar(p_tx text) returns text language plpgsql as $$
begin
  perform public.tomar_comprobante(pg_temp.idc(p_tx));
  return public.apropiar_comprobante(pg_temp.idc(p_tx), pg_temp.lib('OPERADOR_LAURA'), '09:00', 'TRANSFERENCIA', 'T29COP', null, null, 'CT-99101') ->> 'movimiento';
end $$;
create or replace function pg_temp.idm(p_tx text) returns uuid language sql as $$ select id from public.movimiento where id_transaccion = p_tx $$;
grant execute on function pg_temp.lib(text), pg_temp.idc(text), pg_temp.apropiar(text), pg_temp.idm(text) to authenticated;

-- ------------------------------------------------------------ 1. Sin rol o desactivado: no lee nada
select pg_temp.como('t29-sinrol@prueba.local');
select is((select count(*)::int from public.moneda), 0, 'un usuario sin rol no lee los catálogos');
select is((select count(*)::int from public.contraparte), 0, 'ni el catálogo de clientes');
select is((select count(*)::int from public.tasa_cliente), 0, 'ni las tasas');
select is((select count(*)::int from public.rol_permiso), 0, 'ni la tabla de roles y permisos');
select throws_ok($$ select public.responder_liberacion(gen_random_uuid(), true) $$, '42501', null,
  'responder_liberacion exige BRASIL_APROPIAR');
select pg_temp.como('t29-laura@prueba.local');
select is((select count(*)::int from public.contraparte where id like 'CT-991%'), 2, 'la operadora activa sigue viendo el catálogo de clientes');
select is((select count(*)::int from public.tasa_cliente where id like 'TB-T29-%'), 2, 'y las tasas');
select ok((select count(*) from public.moneda) > 0, 'y los catálogos');
select pg_temp.como('t29-inactivo@prueba.local');
select is((select count(*)::int from public.contraparte), 0, 'un usuario desactivado con la sesión viva ya no lee el catálogo de clientes');
select is((select count(*)::int from public.libro), 0, 'ni sus libros');
select is(public.mis_libros(), '{}'::uuid[], 'mis_libros() queda vacío para el desactivado');
select throws_ok($$ select public.enviar_registros_cliente('{}'::uuid[]) $$, '42501', null,
  'ni envía registros a verificación (enviar_registros_cliente exige REGISTRAR_MOVIMIENTO)');
select pg_temp.como('t29-laz@prueba.local');
select is((select string_agg(id, ',') from public.contraparte), 'CT-99102', 'el cliente grande sigue viendo solo su código');
select is((select count(*)::int from public.saldo_bucket where contraparte_id = 'CT-99102'), 1, 'y su saldo');
select pg_temp.reset();

-- ------------------------------------------------------------ 2. Un borrador no da acceso al saldo del cliente
insert into public.movimiento (codigo, libro_id, id_transaccion, tipo, fecha_operacion, modalidad, contraparte_id, moneda_origen, moneda_destino,
  monto_origen, estado)
values ('T29-BORR', pg_temp.lib('OPERADOR_LAURA'), 'T29-TX-BORR', 'ENTRADA', '2026-11-03 12:00-05', 'TRANSFERENCIA', 'CT-99101', 'T29COP', 'T29COP', 10, 'BORRADOR');
select pg_temp.como('t29-laura@prueba.local');
select is(public.puede_ver_ct('CT-99101'), false, 'con solo un borrador la operadora NO ve el saldo de ese cliente');
select is('CT-99101' = any(public.cts_de_mis_libros()), false, 'ni entra en la lista que usan las políticas');
select throws_ok($$ select * from public.estado_cuenta('CT-99101', 'T29COP', 'TRANSFERENCIA') $$, '42501', null, 'ni su estado de cuenta');
select pg_temp.reset();
insert into public.movimiento (codigo, libro_id, id_transaccion, tipo, fecha_operacion, modalidad, contraparte_id, moneda_origen, moneda_destino,
  monto_origen, estado, aprobado_en, tasa_aplicada, monto_destino, entrada, salida, saldo_anterior, saldo_post, secuencia_bucket, orden_aprobacion)
values ('T29-APR', pg_temp.lib('OPERADOR_LAURA'), 'T29-TX-APR', 'ENTRADA', '2026-11-03 12:00-05', 'TRANSFERENCIA', 'CT-99101', 'T29COP', 'T29COP',
  100, 'APROBADO', now(), 1, 100, 100, 0, 0, 100, 1, 929001);
select pg_temp.como('t29-laura@prueba.local');
select is(public.puede_ver_ct('CT-99101'), true, 'con un aprobado en su libro sí');
select pg_temp.como('t29-seb@prueba.local');
select is(public.puede_ver_ct('CT-99101'), false, 'el otro operador no');
select pg_temp.reset();

-- ------------------------------------------------------------ 3. Brasil: rechazar devuelve el comprobante y libera el id
select pg_temp.como('t29-paula@prueba.local');
insert into public.comprobante_brasil (banco_id, fecha, id_tx, tipo, valor, remitente) values
  ('INTER_BETA', '2026-11-05', 'T29-A', 'ENTRADA', 100, 'Uno'),
  ('INTER_BETA', '2026-11-05', 'T29-B', 'ENTRADA', 200, 'Dos'),
  ('INTER_BETA', '2026-11-05', 'T29-C', 'ENTRADA', 300, 'Tres');
select pg_temp.como('t29-laura@prueba.local');
select ok(pg_temp.apropiar('T29-A') like 'BRS-LN-%', 'Laura apropia T29-A');
select pg_temp.como('t29-admin@prueba.local');
select is(jsonb_array_length(public.rechazar_movimientos(array[pg_temp.idm('T29-A')], 'ese pago entra por otro lado') -> 'hechos'), 1,
  'la administración rechaza el BRS-');
select pg_temp.reset();
select is((select estado::text || ' ' || coalesce(movimiento_id::text, 'sin movimiento') from public.comprobante_brasil where id_tx = 'T29-A'),
  'PENDIENTE sin movimiento', 'al rechazar, el comprobante vuelve a la bandeja');
select ok((select envio_mensaje like 'Se rechazó BRS-LN-%: ese pago entra por otro lado' from public.comprobante_brasil where id_tx = 'T29-A'),
  'con el motivo del rechazo');
select pg_temp.como('t29-laura@prueba.local');
select ok(pg_temp.apropiar('T29-A') like 'BRS-LN-%', 'y se puede apropiar de nuevo: el BRS- rechazado no bloquea el id');
select pg_temp.reset();
-- Un registro manual con el mismo id que quedó rechazado ("entra por Brasil")
insert into public.movimiento (codigo, libro_id, id_transaccion, tipo, fecha_operacion, modalidad, contraparte_id, moneda_origen, moneda_destino,
  monto_origen, estado, rechazado_motivo)
values ('T29-RECH', pg_temp.lib('OPERADOR_LAURA'), 't29-b', 'ENTRADA', '2026-11-05 12:00-05', 'TRANSFERENCIA', 'CT-99101', 'REAL', 'T29COP', 200,
  'RECHAZADO', 'entra por Brasil');
select pg_temp.como('t29-laura@prueba.local');
select ok(pg_temp.apropiar('T29-B') like 'BRS-LN-%', 'un registro manual rechazado con el mismo id tampoco impide apropiar el comprobante');

-- ------------------------------------------------------------ 4. Comprobante anulado: se puede volver a cargar
select pg_temp.como('t29-paula@prueba.local');
update public.comprobante_brasil set estado = 'ANULADO', anulado_motivo = 'cargado por error' where id_tx = 'T29-C';
select lives_ok($$ insert into public.comprobante_brasil (banco_id, fecha, id_tx, tipo, valor, remitente)
                   values ('INTER_BETA', '2026-11-05', 'T29-C', 'ENTRADA', 300, 'Tres') $$,
  'después de anularlo, el mismo id se carga de nuevo en ese banco');
select throws_ok($$ insert into public.comprobante_brasil (banco_id, fecha, id_tx, tipo, valor, remitente)
                    values ('INTER_BETA', '2026-11-05', ' t29-c ', 'ENTRADA', 300, 'Tres') $$, '23505', null,
  'pero dos vivos con el mismo id siguen sin poderse');
select pg_temp.reset();

-- ------------------------------------------------------------ 5. Superadmin protegido
select pg_temp.como('t29-admin@prueba.local');
select throws_like($$ delete from public.usuario_rol where usuario_id = '00000000-0000-0000-0000-0000000029d7' and rol_id = 'superadmin' $$,
  '%quitar el rol superadmin%', 'la administradora no le quita el rol al superadmin');
select throws_like($$ update public.usuario set activo = false where id = '00000000-0000-0000-0000-0000000029d7' $$,
  '%modificar o desactivar a un superadmin%', 'ni lo desactiva');
select lives_ok($$ update public.usuario set activo = false where id = '00000000-0000-0000-0000-0000000029d2' $$,
  'a un usuario normal sí lo desactiva');
select lives_ok($$ delete from public.usuario_rol where usuario_id = '00000000-0000-0000-0000-0000000029d2' and rol_id = 'operador' $$,
  'y le quita un rol normal');
insert into public.usuario_permiso (usuario_id, permiso, otorgado_por)
  values ('00000000-0000-0000-0000-0000000029d1', 'VER_AUDITORIA', '00000000-0000-0000-0000-0000000029d2');
select pg_temp.como('t29-super@prueba.local');
select lives_ok($$ update public.usuario set nombre = 'Super T29 b' where id = '00000000-0000-0000-0000-0000000029d7' $$,
  'el superadmin sí modifica su perfil');
select pg_temp.reset();
select is((select otorgado_por from public.usuario_permiso where usuario_id = '00000000-0000-0000-0000-0000000029d1' and permiso = 'VER_AUDITORIA'),
  '00000000-0000-0000-0000-0000000029d3'::uuid, 'otorgado_por es quien delegó de verdad, no lo que mandó el navegador');

-- ------------------------------------------------------------ 6. Períodos con bloqueo
select is((select provolatile::text from pg_proc where proname = 'exigir_periodo_editable' and pronamespace = 'public'::regnamespace), 'v',
  'exigir_periodo_editable ya no es estable (toma el bloqueo del período)');
select lives_ok($$ select public.periodo_para('2026-10-10 10:00-05') $$, 'periodo_para sigue funcionando con el bloqueo compartido');

-- ------------------------------------------------------------ 7. Corregir la moneda de origen usa el beneficio del par nuevo
select pg_temp.como('t29-laz@prueba.local');
select (public.crear_movimiento(jsonb_build_object('libro_id', pg_temp.lib('LUCAS_ALZATE'),
    'id_transaccion', 'T29-G1', 'tipo', 'ENTRADA', 'fecha', '2026-10-10', 'hora', '10:00', 'modalidad', 'TRANSFERENCIA',
    'moneda_origen', 'USD', 'moneda_destino', 'COP', 'monto_origen', 100), true)).codigo;
select pg_temp.como('t29-laura@prueba.local');
select public.enviar_registros_cliente(array[pg_temp.idm('T29-G1')]);
select pg_temp.como('t29-admin@prueba.local');
select public.verificar_movimientos(array[pg_temp.idm('T29-G1')]);
select is((public.aprobar_movimientos(array[pg_temp.idm('T29-G1')]) ->> 'aprobados')::int, 1, 'se aprueba un movimiento de LAZ en USD');
select pg_temp.reset();
select is((select moneda_origen || ' ' || beneficio::numeric(10,2)::text || ' ' || utilidad::text from public.ganancia_movimiento where movimiento_id = pg_temp.idm('T29-G1')),
  'USD 10.00 1000.00', 'ganancia en USD: 100 × 10');
select pg_temp.como('t29-admin@prueba.local');
select public.corregir_movimiento(pg_temp.idm('T29-G1'), '{"moneda_origen": "SOL"}', 'era en soles');
select pg_temp.reset();
select is((select moneda_origen || ' ' || beneficio::numeric(10,2)::text || ' ' || utilidad::text from public.ganancia_movimiento where movimiento_id = pg_temp.idm('T29-G1')),
  'SOL 20.00 2000.00', 'al corregir a SOL la ganancia usa el beneficio de SOL (20), no el de USD');
select is((select sum(entrada - salida) from public.caja_ganancia where movimiento_id = pg_temp.idm('T29-G1')), 2000.00::numeric,
  'y la caja de ganancias queda en 100 × 20');

-- ------------------------------------------------------------ 8. Cliente grande desactivado: deja de ver su saldo
update public.usuario set activo = false where id = '00000000-0000-0000-0000-0000000029d6';
select pg_temp.como('t29-laz@prueba.local');
select is((select count(*)::int from public.saldo_bucket), 0, 'el cliente grande desactivado ya no ve su saldo');
select is((select count(*)::int from public.movimiento), 0, 'ni sus movimientos');
select pg_temp.reset();

select * from finish();
rollback;
