-- Sprint 5 (migración 1400): cálculo (ejemplos del doc 02 §3.8), aprobación por lote, saldos, vista previa y permisos.
begin;
create extension if not exists pgtap with schema extensions;
delete from public.caja_ganancia; delete from public.ganancia_movimiento;
update public.comprobante_brasil set movimiento_id = null where movimiento_id is not null;   -- comprobantes apropiados (2100)
delete from public.movimiento_utilidad; delete from public.movimiento; delete from public.saldo_bucket;
delete from public.consecutivo where libro_id in (select id from public.libro where codigo = 'OPERADOR_LAURA');
select plan(32);

-- ------------------------------------------------------------ STW-28: la fórmula (doc 02 §3.8, sacada del código del madre)
-- SOL→COP, B=1150, Ben=5, U=20, m=1000, AGENTE BCP (−15), ENTRADA, saldo 500 000
select is((select row(monto_efectivo, tasa_aplicada, tasa_adquisicion, monto_destino, valor_adquisicion, utilidad, entrada, salida, saldo_post)::text
             from public.calcular_movimiento('ENTRADA', 1000, 'SOL', 'COP', 15, 1150, 5, 20, false, 500000)),
  '(985,1155,1170,1137675.00,1152450,14775.00,1137675.00,0,1637675.00)', 'ejemplo 3.8: BCP −15, beneficio y utilidad');
select is((select row(tasa_aplicada, monto_destino, valor_adquisicion, utilidad)::text
             from public.calcular_movimiento('ENTRADA', 1000, 'SOL', 'COP', 15, 1150, 5, 20, true, 500000)),
  '(1097.25,1080791.25,1152450,71658.75)', 'ejemplo 3.8 con descuento ×0,95: la adquisición no cambia');
select throws_like($$ select public.calcular_movimiento('SALIDA', 1000, 'SOL', 'SOL', 0, 1, 0.01, 0.03, false, 800) $$,
  'Saldo insuficiente: disponible 800%faltan 200%', 'SOL→SOL salida 1000 con saldo 800: rechazo, faltan 200');
select is((select row(tasa_aplicada, tasa_adquisicion, valor_adquisicion, utilidad, saldo_post)::text
             from public.calcular_movimiento('SALIDA', 1000, 'SOL', 'SOL', 0, 1, 0.01, 0.03, false, 2000)),
  '(1,1.02,1020.00,20.00,1000.00)', 'mismo par: tasa 1, adquisición B+U−Ben, saldo 1000');
select is((public.calcular_movimiento('SALIDA', 100, 'COP', 'COP', 0, 1, 0, 0, false, 100)).saldo_post, 0.00::numeric,
  'una salida igual al saldo sí se permite');
select is((public.calcular_movimiento('ENTRADA', 333.33, 'REAL', 'COP', 0, 721.37, 0, 10, false, 0)).monto_destino, 240454.26::numeric,
  'monto destino redondeado a 2 decimales (333,33 × 721,37 = 240 454,2621)');
select throws_like($$ select public.calcular_movimiento('ENTRADA', 10, 'SOL', 'COP', 15, 1150, 0, 20, false, 0) $$,
  '%no alcanza para el descuento fijo%', 'el monto no puede quedar en cero o negativo tras el −15');

-- ------------------------------------------------------------ datos de la prueba
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 't5-laura@prueba.local', '{"nombre":"Laura T5"}'),
  ('00000000-0000-0000-0000-0000000000f3', 't5-admin@prueba.local', '{"nombre":"Admin T5"}');
insert into public.usuario_rol values ('00000000-0000-0000-0000-0000000000f1', 'operador'), ('00000000-0000-0000-0000-0000000000f3', 'administradora');
insert into public.libro_usuario (libro_id, usuario_id) select id, '00000000-0000-0000-0000-0000000000f1'::uuid from public.libro where codigo = 'OPERADOR_LAURA';
insert into public.moneda (id, nombre) values ('T5-S', 'T5SOL'), ('T5-C', 'T5COP') on conflict do nothing;
insert into public.contraparte (id, tipo, nombre) values ('CT-95001', 'CLIENTE', 'Cliente T5'), ('CT-95002', 'CLIENTE', 'Otro T5') on conflict do nothing;
insert into public.recibido_en (id, nombre, descuento_fijo, descuento_moneda) values ('T5-BCP', 'Agente BCP T5', 15, 'T5SOL') on conflict do nothing;
insert into public.tasa_cliente (id, moneda_origen, moneda_destino, modalidad, vigencia, valor, estado) values
  ('TB-T5-1', 'T5SOL', 'T5COP', 'TRANSFERENCIA', tstzrange('2026-11-01 00:00-05', '2026-11-05 23:59:59-05', '[]'), 1100, 'CERRADO'),
  ('TB-T5-2', 'T5SOL', 'T5COP', 'TRANSFERENCIA', tstzrange('2026-11-06 00:00-05', 'infinity', '[]'), 1150, 'CERRADO'),
  ('TB-T5-3', 'T5SOL', 'T5COP', 'EFECTIVO', tstzrange('2026-11-01 00:00-05', 'infinity', '[]'), 1000, 'MODIFICABLE'),
  ('TB-T5-4', 'T5COP', 'T5COP', 'TRANSFERENCIA', tstzrange('2026-11-01 00:00-05', 'infinity', '[]'), 1, 'CERRADO');
insert into public.tasa_utilidad (id, moneda_origen, moneda_destino, puntos_efectivo, puntos_transferencia, vigencia, estado) values
  ('UT-T5-1', 'T5SOL', 'T5COP', 25, 20, tstzrange('2026-11-01 00:00-05', 'infinity', '[]'), 'CERRADO'),
  ('UT-T5-2', 'T5COP', 'T5COP', 0, 0, tstzrange('2026-11-01 00:00-05', 'infinity', '[]'), 'CERRADO');
insert into public.ajuste_cliente (id, contraparte_id, moneda_origen, moneda_destino, beneficio, vigencia) values
  ('AJ-T5-1', 'CT-95001', 'T5SOL', 'T5COP', 5, tstzrange('-infinity', 'infinity', '[]'));

create or replace function pg_temp.como(p_correo text) returns void language plpgsql as $$
declare v_id uuid;
begin
  perform set_config('role', 'postgres', true);
  select id into v_id from public.usuario where correo = p_correo;
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.reset() returns void language sql as $$ select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true); $$;
create or replace function pg_temp.mov(p_tx text, p_tipo text, p_fecha text, p_monto numeric, p_extra jsonb default '{}') returns uuid language sql as $$
  select (public.crear_movimiento(jsonb_build_object('libro_id', (select id from public.libro where codigo = 'OPERADOR_LAURA'),
    'id_transaccion', p_tx, 'tipo', p_tipo, 'fecha', p_fecha, 'hora', '10:00', 'modalidad', 'TRANSFERENCIA',
    'contraparte_id', 'CT-95001', 'moneda_origen', 'T5SOL', 'moneda_destino', 'T5COP', 'monto_origen', p_monto) || p_extra, true)).id;
$$;
create or replace function pg_temp.idm(p_tx text) returns uuid language sql as $$ select id from public.movimiento where id_transaccion = p_tx $$;
grant execute on function pg_temp.mov(text, text, text, numeric, jsonb), pg_temp.idm(text) to authenticated;

select pg_temp.como('t5-laura@prueba.local');
select pg_temp.mov('A1', 'ENTRADA', '2026-11-04', 1000, '{"recibido_en_id":"T5-BCP"}');  -- tasa vieja 1100, BCP
select pg_temp.mov('A2', 'SALIDA',  '2026-11-07', 500);                                    -- tasa nueva 1150
select pg_temp.mov('A3', 'SALIDA',  '2026-11-07', 9999);                                   -- saldo insuficiente
select pg_temp.mov('A4', 'ENTRADA', '2026-11-07', 10, '{"modalidad":"EFECTIVO"}');         -- tasa EFECTIVO no publicada
select pg_temp.mov('A5', 'ENTRADA', '2026-11-08', 50);                                     -- queda en borrador
select pg_temp.reset();
select pg_temp.como('t5-admin@prueba.local');
select public.verificar_movimientos(array[pg_temp.idm('A1'), pg_temp.idm('A2'), pg_temp.idm('A3'), pg_temp.idm('A4')]);

-- ------------------------------------------------------------ permisos
select pg_temp.como('t5-laura@prueba.local');
select throws_ok($$ select public.aprobar_movimientos(array[pg_temp.idm('A1')]) $$, '42501', null, 'el operador no aprueba');

-- ------------------------------------------------------------ vista previa: calcula y no guarda nada
select pg_temp.como('t5-admin@prueba.local');
select is((public.aprobar_movimientos(array[pg_temp.idm('A1'), pg_temp.idm('A2')], true) ->> 'aprobados')::int, 2, 'vista previa: 2 se aprobarían');
select is((select count(*)::int from public.movimiento where estado = 'APROBADO'), 0, 'vista previa: no aprueba nada');
select is((select count(*)::int from public.saldo_bucket), 0, 'vista previa: no toca saldos');
select is((select count(*)::int from public.movimiento where aprobacion_error is not null), 0, 'vista previa: no marca errores');

-- ------------------------------------------------------------ STW-29: aprobación real
create temp table r5 as select public.aprobar_movimientos(array[pg_temp.idm('A3'), pg_temp.idm('A2'), pg_temp.idm('A1'), pg_temp.idm('A4'), pg_temp.idm('A5')]) as j;
grant select on r5 to authenticated;
select is((select (j ->> 'aprobados')::int || '/' || (j ->> 'con_error')::int from r5), '2/3', 'lote: 2 aprobados y 3 con error, cada uno por su lado');
select is((select string_agg(e ->> 'codigo', ',') from r5, jsonb_array_elements(j -> 'resultados') e), 'LN-0001,LN-0002,LN-0003,LN-0004,LN-0005',
  'se procesan por fecha + hora de la operación, no en el orden en que se seleccionaron');
select is((select row(tasa_cliente_id, tasa_aplicada, monto_efectivo, monto_destino, entrada, saldo_anterior, saldo_post, secuencia_bucket)::text
             from public.movimiento where id_transaccion = 'A1'),
  '(TB-T5-1,1105.000000,985.00,1088425.00,1088425.00,0.00,1088425.00,1)', 'A1: tasa vigente ese día (1100) + beneficio 5, BCP −15');
select is((select row(tasa_cliente_id, tasa_aplicada, monto_destino, salida, saldo_anterior, saldo_post, secuencia_bucket)::text
             from public.movimiento where id_transaccion = 'A2'),
  '(TB-T5-2,1155.000000,577500.00,577500.00,1088425.00,510925.00,2)', 'A2: tasa nueva (1150), salida descuenta del saldo');
select is((select row(tasa_adquisicion, utilidad, beneficio, puntos_utilidad, ajuste_id, tasa_utilidad_id)::text
             from public.movimiento_utilidad where movimiento_id = pg_temp.idm('A2')),
  '(1170.000000,7500.00000000,5.000000,20.000000,AJ-T5-1,UT-T5-1)', 'utilidad = monto × (U − Ben) = 500 × 15');
select is((select saldo from public.saldo_bucket where contraparte_id = 'CT-95001' and moneda = 'T5COP' and modalidad = 'TRANSFERENCIA'),
  510925.00::numeric, 'STW-30: saldo del bucket = último saldo_post');
select alike((select aprobacion_error from public.movimiento where id_transaccion = 'A3'), 'Saldo insuficiente: disponible 510.925,00%',
  'A3 queda verificado con el motivo (saldo insuficiente)');
select is((select estado::text from public.movimiento where id_transaccion = 'A3'), 'VERIFICADO', 'el que falla no cambia de estado');
select alike((select aprobacion_error from public.movimiento where id_transaccion = 'A4'), 'No existe tasa vigente T5SOL → T5COP efectivo%',
  'A4: la tasa EFECTIVO no está publicada (MODIFICABLE no cuenta)');
select alike((select r.e ->> 'error' from r5, jsonb_array_elements(j -> 'resultados') r(e) where r.e ->> 'codigo' = 'LN-0005'),
  'Está borrador%', 'un borrador no se aprueba');
select is(public.desbloquear_movimientos(array[pg_temp.idm('A1')], 'cambiar algo') -> 'omitidos' -> 0 ->> 'motivo',
  'ya está aprobado (solo corrección auditada)', 'un aprobado no se desbloquea');
select is((public.aprobar_movimientos(array[pg_temp.idm('A1')]) -> 'resultados' -> 0 ->> 'error'), 'Está aprobado (solo se aprueba lo verificado)',
  'no se aprueba dos veces');

-- un segundo intento, ahora con saldo: A3 por 400 (cabe en 510 925 / 1155 ≈ 442)
select pg_temp.reset();
update public.movimiento set monto_origen = 400 where id_transaccion = 'A3';
select pg_temp.como('t5-admin@prueba.local');
select is((public.aprobar_movimientos(array[pg_temp.idm('A3')]) ->> 'aprobados')::int, 1, 'reintento: ahora sí aprueba');
select is((select aprobacion_error from public.movimiento where id_transaccion = 'A3'), null, 'al aprobar se limpia el error anterior');
select is((select secuencia_bucket from public.movimiento where id_transaccion = 'A3'), 3::bigint, 'la secuencia del bucket sigue: 3');

-- ------------------------------------------------------------ lo que ve el operador
select pg_temp.como('t5-laura@prueba.local');
select is((select tasa_aplicada::text || ' ' || monto_destino::text from public.movimiento where id_transaccion = 'A1'), '1105.000000 1088425.00',
  'el operador ve la tasa y el monto destino de lo aprobado');
select is((select count(*)::int from public.movimiento_utilidad), 0, 'el operador NO ve la utilidad ni la tasa de adquisición');
select is((select count(*)::int from public.saldo_bucket), 1, 'el operador ve saldos (VER_REPORTES)');
select is((select tasa_aplicada from public.movimiento where id_transaccion = 'A5'), null, 'un borrador no tiene tasa (solo se calcula al aprobar)');
select throws_ok($$ update public.saldo_bucket set saldo = 0 $$, '42501', null, 'nadie cambia un saldo a mano');
select pg_temp.reset();

select * from finish();
rollback;
