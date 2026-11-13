-- Migración 1700 (Sprint 7): flujo cliente → operador → aprobación, saldo del cliente, ganancias y caja (ejemplo doc 03 §4.3).
begin;
create extension if not exists pgtap with schema extensions;
delete from public.caja_ganancia; delete from public.ganancia_movimiento;
update public.comprobante_brasil set movimiento_id = null where movimiento_id is not null;   -- comprobantes apropiados (2100)
delete from public.movimiento_utilidad; delete from public.movimiento; delete from public.saldo_bucket; delete from public.periodo;
delete from public.consecutivo where libro_id in (select id from public.libro where codigo in ('LUCAS_ALZATE', 'OPERADOR_LAURA'));
select plan(25);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 't8-laz@prueba.local', '{"nombre":"LAZ T8"}'),
  ('00000000-0000-0000-0000-0000000000c2', 't8-laura@prueba.local', '{"nombre":"Laura T8"}'),
  ('00000000-0000-0000-0000-0000000000c3', 't8-admin@prueba.local', '{"nombre":"Admin T8"}'),
  ('00000000-0000-0000-0000-0000000000c4', 't8-comnorte@prueba.local', '{"nombre":"Comnorte T8"}'),
  ('00000000-0000-0000-0000-0000000000c5', 't8-super@prueba.local', '{"nombre":"Super T8"}');
insert into public.usuario_rol values ('00000000-0000-0000-0000-0000000000c1', 'cliente_grande'), ('00000000-0000-0000-0000-0000000000c2', 'operador'),
  ('00000000-0000-0000-0000-0000000000c3', 'administradora'), ('00000000-0000-0000-0000-0000000000c4', 'cliente_grande'), ('00000000-0000-0000-0000-0000000000c5', 'superadmin');
insert into public.libro_usuario (libro_id, usuario_id)
  select id, '00000000-0000-0000-0000-0000000000c1'::uuid from public.libro where codigo = 'LUCAS_ALZATE' union all
  select id, '00000000-0000-0000-0000-0000000000c2'::uuid from public.libro where codigo = 'OPERADOR_LAURA' union all
  select id, '00000000-0000-0000-0000-0000000000c4'::uuid from public.libro where codigo = 'COMNORTE';
insert into public.moneda (id, nombre) values ('T8-S', 'SOL'), ('T8-C', 'COP'), ('T8-U', 'USD') on conflict do nothing;
insert into public.contraparte (id, tipo, nombre) values ('CT-98001', 'ALIADO', 'LAZ T8'), ('CT-98002', 'ALIADO', 'Comnorte T8') on conflict do nothing;
update public.libro set contraparte_id = 'CT-98001', usa_ganancias = true, operador_id = (select id from public.libro where codigo = 'OPERADOR_LAURA') where codigo = 'LUCAS_ALZATE';
update public.libro set contraparte_id = 'CT-98002', operador_id = (select id from public.libro where codigo = 'OPERADOR_LAURA') where codigo = 'COMNORTE';
insert into public.recibido_en (id, nombre, descuento_fijo, descuento_moneda) values ('T8-BCP', 'Agente BCP T8', 15, 'SOL') on conflict do nothing;
-- Octubre (el seed tiene tasas desde noviembre: no se cruzan)
insert into public.tasa_cliente (id, moneda_origen, moneda_destino, modalidad, vigencia, valor, estado) values
  ('TB-T8-S', 'SOL', 'COP', 'TRANSFERENCIA', tstzrange('2026-10-01 00:00-05', '2026-10-31 23:59:59-05', '[]'), 1080, 'CERRADO'),
  ('TB-T8-U', 'USD', 'COP', 'TRANSFERENCIA', tstzrange('2026-10-01 00:00-05', '2026-10-31 23:59:59-05', '[]'), 4000, 'CERRADO');
insert into public.tasa_utilidad (id, moneda_origen, moneda_destino, puntos_efectivo, puntos_transferencia, vigencia, estado) values
  ('UT-T8-S', 'SOL', 'COP', 25, 30, tstzrange('2026-10-01 00:00-05', '2026-10-31 23:59:59-05', '[]'), 'CERRADO'),
  ('UT-T8-U', 'USD', 'COP', 50, 50, tstzrange('2026-10-01 00:00-05', '2026-10-31 23:59:59-05', '[]'), 'CERRADO');
insert into public.ajuste_cliente (id, contraparte_id, moneda_origen, moneda_destino, beneficio, vigencia) values
  ('AJ-T8-S', 'CT-98001', 'SOL', 'COP', 20, tstzrange('-infinity', 'infinity', '[]')),
  ('AJ-T8-U', 'CT-98001', 'USD', 'COP', 10, tstzrange('-infinity', 'infinity', '[]'));

create or replace function pg_temp.como(p_correo text) returns void language plpgsql as $$
declare v_id uuid;
begin
  perform set_config('role', 'postgres', true);
  select id into v_id from public.usuario where correo = p_correo;
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.reset() returns void language sql as $$ select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true); $$;
create or replace function pg_temp.mov(p_tx text, p_mo text, p_monto numeric, p_rec text default null) returns uuid language sql as $$
  select (public.crear_movimiento(jsonb_build_object('libro_id', (select id from public.libro where codigo = 'LUCAS_ALZATE'),
    'id_transaccion', p_tx, 'tipo', 'ENTRADA', 'fecha', '2026-10-10', 'hora', '10:00', 'modalidad', 'TRANSFERENCIA',
    'moneda_origen', p_mo, 'moneda_destino', 'COP', 'monto_origen', p_monto, 'recibido_en_id', p_rec), true)).id;
$$;
create or replace function pg_temp.idm(p_tx text) returns uuid language sql as $$ select id from public.movimiento where id_transaccion = p_tx $$;
create or replace function pg_temp.disponible() returns numeric language sql as $$
  select disponible from public.caja_ganancia_resumen where libro_id = (select id from public.libro where codigo = 'LUCAS_ALZATE') $$;
grant execute on function pg_temp.mov(text, text, numeric, text), pg_temp.idm(text), pg_temp.disponible() to authenticated;

-- ------------------------------------------------------------ STW-42 flujo
select pg_temp.como('t8-laz@prueba.local');
select pg_temp.mov('L1', 'SOL', 1000, 'T8-BCP');
select pg_temp.mov('L2', 'SOL', 500);
select pg_temp.mov('L3', 'USD', 100);
select is(public.enviar_registros_cliente(array[pg_temp.idm('L1')]) -> 'omitidos' -> 0 ->> 'motivo', 'solo lo envía el operador que atiende a ese cliente',
  'el cliente grande solo registra: no envía');
select pg_temp.como('t8-admin@prueba.local');
select is(public.verificar_movimientos(array[pg_temp.idm('L1')]) -> 'omitidos' -> 0 ->> 'motivo', 'su operador todavía no lo envía',
  'un borrador del cliente no se verifica hasta que su operador lo envía');
select pg_temp.como('t8-comnorte@prueba.local');
select is(public.enviar_registros_cliente(array[pg_temp.idm('L1')]) -> 'hechos', '[]'::jsonb, 'otro cliente tampoco');
select pg_temp.como('t8-laura@prueba.local');
select is((select count(*)::int from public.movimiento where id_transaccion like 'L_' and estado = 'BORRADOR'), 3, 'el operador ve los registros del libro de su cliente');
select is(public.enviar_registros_cliente(array[pg_temp.idm('L1'), pg_temp.idm('L2'), pg_temp.idm('L3')]) -> 'hechos', '["LAZ-0001", "LAZ-0002", "LAZ-0003"]'::jsonb,
  'STW-42: el operador que lo atiende los envía a verificación');
select is((select estado::text || ' ' || (enviado_en is not null)::text || ' ' || (enviado_por = '00000000-0000-0000-0000-0000000000c2')::text
             from public.movimiento where id_transaccion = 'L1'), 'ENVIADO_OPERADOR true true', 'queda enviado, con fecha y quién lo envió');
select is(public.enviar_registros_cliente(array(select id from public.movimiento where libro_id = (select id from public.libro where codigo = 'OPERADOR_LAURA'))) -> 'hechos',
  '[]'::jsonb, 'enviar es solo para registros de clientes grandes');
select pg_temp.como('t8-laz@prueba.local');
select throws_like($$ select public.editar_movimiento(pg_temp.idm('L1'), jsonb_build_object('monto_origen', 1)) $$, '%enviado_operador%',
  'P-31: lo enviado ya no lo edita el cliente');
select pg_temp.como('t8-admin@prueba.local');
select public.verificar_movimientos(array[pg_temp.idm('L1'), pg_temp.idm('L2'), pg_temp.idm('L3')]);
select is((public.aprobar_movimientos(array[pg_temp.idm('L1'), pg_temp.idm('L2'), pg_temp.idm('L3')]) ->> 'aprobados')::int, 3, 'la administración aprueba los 3');

-- ------------------------------------------------------------ STW-43 ganancias (doc 03 §4.3)
select is((select row(beneficio, tasa_cliente, monto_base, utilidad)::text from public.ganancia_movimiento where movimiento_id = pg_temp.idm('L1')),
  '(20.000000,1080.000000,985.00,19700.00)', 'LAZ-0001: (1000 − 15 BCP) × 20 = 19.700; tasa cliente = 1.100 − 20');
select is((select utilidad from public.ganancia_movimiento where movimiento_id = pg_temp.idm('L2')), 10000.00::numeric, 'LAZ-0002: 500 × 20 = 10.000');
select is((select utilidad from public.ganancia_movimiento where movimiento_id = pg_temp.idm('L3')), 1000.00::numeric, 'LAZ-0003 (USD): se calcula, 100 × 10');

-- ------------------------------------------------------------ STW-44 caja
select is((select string_agg(codigo || ' ' || entrada::text || ' ' || saldo::text, ' | ' order by id) from public.caja_ganancia_saldo),
  'UTIL-LAZ-0001 19700.00 19700.00 | UTIL-LAZ-0002 10000.00 29700.00', 'P-20: a la caja solo SOL y REAL, con saldo acumulado');
select is((select utilidad_total::text || ' / ' || disponible::text || ' / ' || operaciones from public.caja_ganancia_resumen
           where libro_id = (select id from public.libro where codigo = 'LUCAS_ALZATE')), '29700.00 / 29700.00 / 2', 'tablero: utilidad, disponible y operaciones');

-- ------------------------------------------------------------ STW-41 lo que ve cada uno
select pg_temp.como('t8-laz@prueba.local');
select is((select count(*)::int from public.caja_ganancia), 2, 'el cliente ve su caja');
select is((select saldo from public.saldo_bucket where contraparte_id = 'CT-98001' and moneda = 'COP'), 2034500.00::numeric,
  'P-2: el cliente ve el saldo global de su código (1.083.500 + 550.000 + 401.000)');
select pg_temp.como('t8-comnorte@prueba.local');
select is((select count(*)::int from public.caja_ganancia), 0, 'otro cliente no ve esa caja');
select is((select count(*)::int from public.saldo_bucket where contraparte_id = 'CT-98001'), 0, 'ni ese saldo');
select pg_temp.como('t8-laura@prueba.local');
select is((select count(*)::int from public.caja_ganancia), 0, 'el operador no ve las ganancias del cliente');

-- ------------------------------------------------------------ anular y corregir dejan AJUSTE (el mayor no se reescribe)
select pg_temp.como('t8-admin@prueba.local');
select public.anular_movimiento(pg_temp.idm('L2'), 'registrado dos veces');
select is((select tipo::text || ' ' || salida::text from public.caja_ganancia where codigo = 'AJU-LAZ-0002-2'), 'AJUSTE 10000.00',
  'anular LAZ-0002 deja un ajuste de −10.000');
select is(pg_temp.disponible(), 19700.00::numeric, 'disponible 19.700');
select public.corregir_movimiento(pg_temp.idm('L1'), '{"monto_origen": 2000}', 'monto mal escrito');
select is(pg_temp.disponible(), 39700.00::numeric, 'corregir LAZ-0001 a 2.000: (2000 − 15) × 20 = 39.700 (ajuste +20.000)');
select is((select count(*)::int from public.caja_ganancia where movimiento_id = pg_temp.idm('L1')), 2, 'UTIL + 1 AJUSTE');
select throws_ok($$ select public.recalcular_ganancias((select id from public.libro where codigo = 'LUCAS_ALZATE')) $$, '42501', null,
  'P-20: la administradora no recalcula ganancias');
select pg_temp.como('t8-super@prueba.local');
select is((public.recalcular_ganancias((select id from public.libro where codigo = 'LUCAS_ALZATE')) ->> 'ajustes')::int, 0,
  'el superadmin recalcula; si todo cuadra no agrega nada');
select pg_temp.reset();

select * from finish();
rollback;
