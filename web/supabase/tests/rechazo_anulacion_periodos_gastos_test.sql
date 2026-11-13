-- Migración 1500: rechazo (STW-31), períodos (STW-61), anular con recálculo (STW-36), gastos (STW-55).
begin;
create extension if not exists pgtap with schema extensions;
delete from public.caja_ganancia; delete from public.ganancia_movimiento;
update public.comprobante_brasil set movimiento_id = null where movimiento_id is not null;   -- comprobantes apropiados (2100)
delete from public.movimiento_utilidad; delete from public.movimiento; delete from public.saldo_bucket; delete from public.periodo;
delete from public.gasto; delete from public.consecutivo_finanzas;
delete from public.consecutivo where libro_id in (select id from public.libro where codigo in ('OPERADOR_LAURA', 'COMNORTE'));
select plan(28);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 't6-laura@prueba.local', '{"nombre":"Laura T6"}'),
  ('00000000-0000-0000-0000-0000000000a2', 't6-comnorte@prueba.local', '{"nombre":"Comnorte T6"}'),
  ('00000000-0000-0000-0000-0000000000a3', 't6-admin@prueba.local', '{"nombre":"Admin T6"}');
insert into public.usuario_rol values ('00000000-0000-0000-0000-0000000000a1', 'operador'), ('00000000-0000-0000-0000-0000000000a2', 'cliente_grande'),
  ('00000000-0000-0000-0000-0000000000a3', 'administradora');
insert into public.libro_usuario (libro_id, usuario_id)
  select id, '00000000-0000-0000-0000-0000000000a1'::uuid from public.libro where codigo = 'OPERADOR_LAURA' union all
  select id, '00000000-0000-0000-0000-0000000000a2'::uuid from public.libro where codigo = 'COMNORTE';
insert into public.moneda (id, nombre) values ('T6-C', 'T6COP') on conflict do nothing;
insert into public.contraparte (id, tipo, nombre) values ('CT-96001', 'CLIENTE', 'Cliente T6'), ('CT-96002', 'ALIADO', 'Comnorte T6') on conflict do nothing;
update public.libro set contraparte_id = 'CT-96002', operador_id = (select id from public.libro where codigo = 'OPERADOR_LAURA') where codigo = 'COMNORTE';
insert into public.tasa_cliente (id, moneda_origen, moneda_destino, modalidad, vigencia, valor, estado) values
  ('TB-T6', 'T6COP', 'T6COP', 'TRANSFERENCIA', tstzrange('2026-01-01 00:00-05', 'infinity', '[]'), 1, 'CERRADO');
insert into public.tasa_utilidad (id, moneda_origen, moneda_destino, puntos_efectivo, puntos_transferencia, vigencia, estado) values
  ('UT-T6', 'T6COP', 'T6COP', 0, 0, tstzrange('2026-01-01 00:00-05', 'infinity', '[]'), 'CERRADO');

create or replace function pg_temp.como(p_correo text) returns void language plpgsql as $$
declare v_id uuid;
begin
  perform set_config('role', 'postgres', true);
  select id into v_id from public.usuario where correo = p_correo;
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.reset() returns void language sql as $$ select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true); $$;
create or replace function pg_temp.mov(p_libro text, p_tx text, p_tipo text, p_fecha text, p_monto numeric) returns uuid language sql as $$
  select (public.crear_movimiento(jsonb_build_object('libro_id', (select id from public.libro where codigo = p_libro),
    'id_transaccion', p_tx, 'tipo', p_tipo, 'fecha', p_fecha, 'hora', '10:00', 'modalidad', 'TRANSFERENCIA',
    'contraparte_id', 'CT-96001', 'moneda_origen', 'T6COP', 'moneda_destino', 'T6COP', 'monto_origen', p_monto), true)).id;
$$;
create or replace function pg_temp.idm(p_tx text) returns uuid language sql as $$ select id from public.movimiento where id_transaccion = p_tx and estado not in ('ANULADO', 'RECHAZADO') $$;
create or replace function pg_temp.est(p_tx text) returns text language sql as $$ select string_agg(estado::text, ',' order by creado_en) from public.movimiento where id_transaccion = p_tx $$;
grant execute on function pg_temp.mov(text, text, text, text, numeric), pg_temp.idm(text), pg_temp.est(text) to authenticated;

-- ------------------------------------------------------------ STW-31 rechazo
select pg_temp.como('t6-laura@prueba.local');
select pg_temp.mov('OPERADOR_LAURA', 'R1', 'ENTRADA', '2026-11-02', 100);
select pg_temp.como('t6-comnorte@prueba.local');
select pg_temp.mov('COMNORTE', 'R2', 'ENTRADA', '2026-11-02', 50);
select pg_temp.como('t6-laura@prueba.local');
select throws_ok($$ select public.rechazar_movimientos(array[pg_temp.idm('R2')], '') $$, null,
  'Escriba el motivo del rechazo (lo verán el operador y el cliente)', 'rechazar exige motivo');
select is(public.rechazar_movimientos(array[pg_temp.idm('R1'), pg_temp.idm('R2')], 'comprobante ilegible'),
  '{"hechos": ["CN-0001"], "omitidos": [{"codigo": "LN-0001", "motivo": "es de un libro de operador: se anula, no se rechaza"}]}'::jsonb,
  'P-13: el operador rechaza lo de su cliente grande, no lo propio');
select pg_temp.como('t6-comnorte@prueba.local');
select is((select rechazado_motivo from public.movimiento where id_transaccion = 'R2'), 'comprobante ilegible', 'el cliente ve el motivo del rechazo');
select lives_ok($$ select pg_temp.mov('COMNORTE', 'R2', 'ENTRADA', '2026-11-02', 55) $$, 'rechazado libera el id de transacción: se registra bien');
select pg_temp.como('t6-admin@prueba.local');
select is(public.rechazar_movimientos(array[pg_temp.idm('R1')], 'datos errados') -> 'hechos', '["LN-0001"]'::jsonb, 'la administración rechaza cualquier libro');

-- ------------------------------------------------------------ STW-61 períodos + base para STW-36
select pg_temp.como('t6-laura@prueba.local');
select pg_temp.mov('OPERADOR_LAURA', 'A1', 'ENTRADA', '2026-10-15', 1000);
select pg_temp.mov('OPERADOR_LAURA', 'A2', 'SALIDA',  '2026-11-03', 300);
select pg_temp.mov('OPERADOR_LAURA', 'A3', 'SALIDA',  '2026-11-04', 600);
select pg_temp.mov('OPERADOR_LAURA', 'A4', 'ENTRADA', '2026-11-05', 50);
select pg_temp.como('t6-admin@prueba.local');
select public.verificar_movimientos(array[pg_temp.idm('A1'), pg_temp.idm('A2'), pg_temp.idm('A3'), pg_temp.idm('A4')]);
select pg_temp.reset();
insert into public.periodo (id, inicio, fin, estado) values ('2026-10', '2026-10-01', '2026-10-31', 'CERRADO');   -- octubre ya cerrado
select pg_temp.como('t6-admin@prueba.local');
select is((public.aprobar_movimientos(array[pg_temp.idm('A1'), pg_temp.idm('A2'), pg_temp.idm('A3'), pg_temp.idm('A4')]) ->> 'aprobados')::int, 4, 'aprobados 4');
select is((select string_agg(periodo_id, ',' order by codigo) from public.movimiento where id_transaccion in ('A1', 'A2')), '2026-11,2026-11',
  'P-10: octubre cerrado → el de octubre va al siguiente abierto; el de noviembre a noviembre');
select is((select count(*)::int from public.periodo where id = '2026-11' and estado = 'ABIERTO'), 1, 'P-34: el período de noviembre se creó solo');
select is((select string_agg(saldo_post::text, ',' order by secuencia_bucket) from public.movimiento where id_transaccion like 'A_' and estado = 'APROBADO'),
  '1000.00,700.00,100.00,150.00', 'saldos: 1000 → 700 → 100 → 150');

-- ------------------------------------------------------------ STW-36 anular con recálculo
select pg_temp.como('t6-laura@prueba.local');
select throws_ok($$ select public.anular_movimiento(pg_temp.idm('A2'), 'error') $$, '42501', null, 'el operador no anula un aprobado');
select pg_temp.como('t6-admin@prueba.local');
select throws_like($$ select public.anular_movimiento(pg_temp.idm('A1'), 'entrada duplicada') $$,
  'SALDO_NEGATIVO: al anular LN-0002, el saldo de CT-96001 (T6COP · transferencia) queda negativo desde LN-0003 (-300,00)%',
  'P-33: si al anular queda saldo negativo, pide confirmación');
select is(pg_temp.est('A1'), 'APROBADO', 'sin confirmación no se anula nada');
select is((public.anular_movimiento(pg_temp.idm('A2'), 'salida registrada dos veces') -> 'recalculo' ->> 'actualizados')::int, 2,
  'anular la salida de 300: se recalculan los 2 posteriores');
select is((select string_agg(saldo_anterior::text || '→' || saldo_post::text, ',' order by secuencia_bucket) from public.movimiento where id_transaccion in ('A1', 'A3', 'A4') and estado = 'APROBADO'),
  '0.00→1000.00,1000.00→400.00,400.00→450.00', 'T-8: saldos posteriores recalculados en tiempo real');
select is((select saldo from public.saldo_bucket where contraparte_id = 'CT-96001' and moneda = 'T6COP'), 450.00::numeric, 'el saldo del bucket queda en 450');
select is(pg_temp.est('A2'), 'ANULADO', 'el anulado no se borra: queda ANULADO');
select is((select anulado_motivo from public.movimiento where id_transaccion = 'A2'), 'salida registrada dos veces', 'con su motivo');
select is((public.anular_movimiento(pg_temp.idm('A1'), 'entrada duplicada', true) -> 'recalculo' ->> 'primer_negativo'), 'LN-0004',
  'confirmado: se anula aunque quede negativo');
select is((select saldo from public.saldo_bucket where contraparte_id = 'CT-96001' and moneda = 'T6COP'), -550.00::numeric, 'saldo -550 (−600 + 50)');
select throws_like($$ select public.anular_movimiento(pg_temp.idm('A4'), '') $$, 'Escriba el motivo%', 'anular exige motivo');
select pg_temp.reset();
update public.periodo set estado = 'CERRADO' where id = '2026-11';
insert into public.usuario_rol values ('00000000-0000-0000-0000-0000000000a1', 'administradora');   -- truco: alguien con ANULAR pero sin CERRAR_PERIODO
delete from public.rol_permiso where rol_id = 'administradora' and permiso = 'CERRAR_PERIODO';
select pg_temp.como('t6-laura@prueba.local');
select throws_like($$ select public.anular_movimiento(pg_temp.idm('A4'), 'cierre') $$, 'El período 2026-11 está cerrado%', 'P-11: período cerrado solo con CERRAR_PERIODO');
select pg_temp.reset();

-- ------------------------------------------------------------ STW-55 gastos
select pg_temp.como('t6-admin@prueba.local');
insert into public.gasto (fecha, tipo, proveedor, valor, oficina) values ('2026-11-03', ' arriendo ', 'Inmobiliaria', 1500000, 'centro');
insert into public.gasto (fecha, tipo, valor) values ('2026-10-28', 'Servicios', 230000.5);
select is((select string_agg(id || ' ' || periodo || ' ' || tipo, ',' order by id) from public.gasto), 'G-0001 2026-11 ARRIENDO,G-0002 2026-10 SERVICIOS',
  'consecutivo G- propio, período por fecha, tipo normalizado');
select throws_like($$ update public.gasto set valor = 1 where id = 'G-0001' $$, 'Un gasto no se edita%', 'un gasto no se edita');
select throws_ok($$ update public.gasto set estado = 'ANULADO' where id = 'G-0001' $$, '23514', null, 'anular exige motivo');
select lives_ok($$ update public.gasto set estado = 'ANULADO', anulado_motivo = 'duplicado' where id = 'G-0001' $$, 'se anula con motivo');
select throws_ok($$ insert into public.gasto (fecha, tipo, valor) values ('2026-11-03', 'X', 0) $$, '23514', null, 'valor positivo');
select throws_ok($$ delete from public.gasto $$, '42501', null, 'nadie borra un gasto');
select pg_temp.como('t6-comnorte@prueba.local');
select is((select count(*)::int from public.gasto), 0, 'sin FINANZAS no se ven los gastos');
select pg_temp.reset();

select * from finish();
rollback;
