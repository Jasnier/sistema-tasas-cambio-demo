-- Migración 1600 (Sprint 6): recalcular bucket, ajustar utilidad, corregir, edición masiva, cierre de período,
-- comparación de saldos, resumen operativo y negociaciones.
begin;
create extension if not exists pgtap with schema extensions;
delete from public.caja_ganancia; delete from public.ganancia_movimiento;
update public.comprobante_brasil set movimiento_id = null where movimiento_id is not null;   -- comprobantes apropiados (2100)
delete from public.movimiento_utilidad; delete from public.movimiento; delete from public.saldo_bucket; delete from public.periodo;
delete from public.negociacion; delete from public.consecutivo_finanzas;
delete from public.consecutivo where libro_id in (select id from public.libro where codigo = 'OPERADOR_LAURA');
select plan(43);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b1', 't7-laura@prueba.local', '{"nombre":"Laura T7"}'),
  ('00000000-0000-0000-0000-0000000000b2', 't7-admin@prueba.local', '{"nombre":"Admin T7"}'),
  ('00000000-0000-0000-0000-0000000000b3', 't7-super@prueba.local', '{"nombre":"Super T7"}');
insert into public.usuario_rol values ('00000000-0000-0000-0000-0000000000b1', 'operador'), ('00000000-0000-0000-0000-0000000000b2', 'administradora'),
  ('00000000-0000-0000-0000-0000000000b3', 'superadmin');
insert into public.libro_usuario (libro_id, usuario_id) select id, '00000000-0000-0000-0000-0000000000b1'::uuid from public.libro where codigo = 'OPERADOR_LAURA';
insert into public.moneda (id, nombre) values ('T7-S', 'T7SOL'), ('T7-C', 'T7COP') on conflict do nothing;
insert into public.contraparte (id, tipo, nombre) values ('CT-97001', 'CLIENTE', 'Cliente T7') on conflict do nothing;
insert into public.tasa_cliente (id, moneda_origen, moneda_destino, modalidad, vigencia, valor, estado) values
  ('TB-T7-T', 'T7SOL', 'T7COP', 'TRANSFERENCIA', tstzrange('2026-10-01 00:00-05', 'infinity', '[]'), 1100, 'CERRADO'),
  ('TB-T7-E', 'T7SOL', 'T7COP', 'EFECTIVO', tstzrange('2026-10-01 00:00-05', 'infinity', '[]'), 1000, 'CERRADO');
insert into public.tasa_utilidad (id, moneda_origen, moneda_destino, puntos_efectivo, puntos_transferencia, vigencia, estado) values
  ('UT-T7', 'T7SOL', 'T7COP', 25, 20, tstzrange('2026-10-01 00:00-05', 'infinity', '[]'), 'CERRADO');

create or replace function pg_temp.como(p_correo text) returns void language plpgsql as $$
declare v_id uuid;
begin
  perform set_config('role', 'postgres', true);
  select id into v_id from public.usuario where correo = p_correo;
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.reset() returns void language sql as $$ select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true); $$;
create or replace function pg_temp.mov(p_tx text, p_tipo text, p_fecha text, p_monto numeric) returns uuid language sql as $$
  select (public.crear_movimiento(jsonb_build_object('libro_id', (select id from public.libro where codigo = 'OPERADOR_LAURA'),
    'id_transaccion', p_tx, 'tipo', p_tipo, 'fecha', p_fecha, 'hora', '10:00', 'modalidad', 'TRANSFERENCIA',
    'contraparte_id', 'CT-97001', 'moneda_origen', 'T7SOL', 'moneda_destino', 'T7COP', 'monto_origen', p_monto), true)).id;
$$;
create or replace function pg_temp.idm(p_tx text) returns uuid language sql as $$ select id from public.movimiento where id_transaccion = p_tx $$;
create or replace function pg_temp.saldo(p_mod text) returns numeric language sql as $$
  select saldo from public.saldo_bucket where contraparte_id = 'CT-97001' and moneda = 'T7COP' and modalidad = p_mod $$;
create or replace function pg_temp.util(p_tx text) returns numeric language sql as $$
  select u.utilidad from public.movimiento_utilidad u join public.movimiento m on m.id = u.movimiento_id where m.id_transaccion = p_tx $$;
grant execute on function pg_temp.mov(text, text, text, numeric), pg_temp.idm(text), pg_temp.saldo(text), pg_temp.util(text) to authenticated;

select pg_temp.como('t7-laura@prueba.local');
select pg_temp.mov('B0', 'ENTRADA', '2026-10-20', 10);    -- octubre (para el cierre)
select pg_temp.mov('B1', 'ENTRADA', '2026-11-03', 1000);
select pg_temp.mov('B2', 'SALIDA',  '2026-11-04', 500);
select pg_temp.mov('B3', 'ENTRADA', '2026-11-05', 100);
select pg_temp.como('t7-admin@prueba.local');
select public.verificar_movimientos(array[pg_temp.idm('B0'), pg_temp.idm('B1'), pg_temp.idm('B2'), pg_temp.idm('B3')]);
select public.aprobar_movimientos(array[pg_temp.idm('B0'), pg_temp.idm('B1'), pg_temp.idm('B2'), pg_temp.idm('B3')]);
select is(pg_temp.saldo('TRANSFERENCIA'), 671000.00::numeric, 'base: 11.000 + 1.100.000 − 550.000 + 110.000');

-- ------------------------------------------------------------ STW-40 comparación y STW-33 recalcular
select pg_temp.reset();
update public.saldo_bucket set saldo = 5 where contraparte_id = 'CT-97001';            -- descuadre a propósito
select pg_temp.como('t7-admin@prueba.local');
select is((select descuadrado from public.comparacion_saldos where contraparte_id = 'CT-97001'), true, 'STW-40: detecta el descuadre');
select is((select diferencia from public.comparacion_saldos where contraparte_id = 'CT-97001'), -670995.00::numeric, 'y la diferencia exacta');
select throws_ok($$ select public.recalcular_bucket('CT-97001', 'T7COP', 'TRANSFERENCIA') $$, '42501', null, 'STW-33: la administradora no recalcula un bucket');
select pg_temp.como('t7-super@prueba.local');
select is((public.recalcular_bucket('CT-97001', 'T7COP', 'TRANSFERENCIA') ->> 'saldo')::numeric, 671000.00, 'el superadmin lo recalcula');
select is((select descuadrado from public.comparacion_saldos where contraparte_id = 'CT-97001'), false, 'queda cuadrado');

-- ------------------------------------------------------------ STW-37 cierre de período
select pg_temp.como('t7-admin@prueba.local');
select is((select periodo_id from public.movimiento where id_transaccion = 'B0'), '2026-10', 'B0 quedó en octubre');
select throws_like($$ select public.cerrar_periodo('2026-11') $$, '%todavía no ha terminado%', 'no se cierra un mes que no ha terminado');
select is((public.cerrar_periodo('2026-10') ->> 'utilidad_total')::numeric, 200.00, 'cierre de octubre: utilidad 10 × 20 = 200');
select is((select estado from public.periodo where id = '2026-10'), 'CERRADO', 'octubre cerrado');
select throws_ok($$ select public.reabrir_periodo('2026-10', 'error') $$, '42501', null, 'la administradora no reabre');

-- ------------------------------------------------------------ STW-34 ajustar utilidad
select pg_temp.como('t7-laura@prueba.local');
select throws_ok($$ select public.ajustar_utilidad(array[pg_temp.idm('B1')], 'QUITAR', null, 'x y z') $$, '42501', null, 'el operador no ajusta utilidad');
select pg_temp.como('t7-admin@prueba.local');
select is((public.ajustar_utilidad(array[pg_temp.idm('B1')], 'QUITAR', null, 'cliente preferencial', true) ->> 'diferencia')::numeric, -20000.00,
  'vista previa: quitar la utilidad de B1 resta 20.000');
select is(pg_temp.util('B1'), 20000.00::numeric, 'la vista previa no cambia nada');
select is((public.ajustar_utilidad(array[pg_temp.idm('B1')], 'QUITAR', null, 'cliente preferencial') ->> 'ajustados')::int, 1, 'quitar utilidad');
select is((select u.utilidad::text || ' ' || u.marca_utilidad || ' ' || (u.tasa_adquisicion = m.tasa_aplicada)::text
             from public.movimiento_utilidad u join public.movimiento m on m.id = u.movimiento_id where m.id_transaccion = 'B1'),
  '0 UTILIDAD N/A true', 'T-9: utilidad 0 ⇒ tasa de adquisición = tasa del cliente, con marca');
select is(public.ajustar_utilidad(array[pg_temp.idm('B1'), pg_temp.idm('B2')], 'RESTAR', 5, 'negociado') -> 'omitidos' -> 0 ->> 'motivo',
  'ya tiene ajuste manual (UTILIDAD N/A)', 'P-35: respeta las marcas');
select is(pg_temp.util('B2'), 7500.00::numeric, 'restar 5 puntos a B2: 500 × (1120 − 5) − 550.000 = 7.500');
select throws_like($$ select public.ajustar_utilidad(array[pg_temp.idm('B3')], 'RESTAR', 5000, 'error') $$, '%no se aplicó nada%', 'si la tasa queda ≤ 0 no aplica');
select pg_temp.reset();
delete from public.rol_permiso where rol_id = 'administradora' and permiso = 'CERRAR_PERIODO';
select pg_temp.como('t7-admin@prueba.local');
select is(public.ajustar_utilidad(array[pg_temp.idm('B0')], 'QUITAR', null, 'cerrado') -> 'omitidos' -> 0 ->> 'motivo', 'período 2026-10 cerrado',
  'P-11: sin CERRAR_PERIODO no toca un período cerrado');
select throws_like($$ select public.corregir_movimiento(pg_temp.idm('B0'), '{"monto_origen": 20}', 'monto') $$, '%2026-10 está cerrado%',
  'ni lo corrige');
select pg_temp.reset();
insert into public.rol_permiso values ('administradora', 'CERRAR_PERIODO');

-- ------------------------------------------------------------ STW-35 corregir uno
select pg_temp.como('t7-laura@prueba.local');
select throws_ok($$ select public.corregir_movimiento(pg_temp.idm('B3'), '{"monto_origen": 200}', 'monto') $$, '42501', null, 'el operador no corrige');
select pg_temp.como('t7-admin@prueba.local');
select throws_like($$ select public.corregir_movimiento(pg_temp.idm('B3'), '{"tipo": "SALIDA"}', 'tipo') $$, 'El campo tipo no se corrige aquí', 'lista blanca de campos');
select throws_like($$ select public.corregir_movimiento(pg_temp.idm('B3'), '{"monto_origen": 100}', 'igual') $$, '%no hay cambios', 'sin cambios no hace nada');
select is((public.corregir_movimiento(pg_temp.idm('B3'), '{"monto_origen": 200}', 'monto mal escrito') -> 'resultados' -> 0 ->> 'saldo_post')::numeric,
  781000.00, 'B3 de 100 a 200: monto 220.000 y saldo 781.000');
select is(pg_temp.saldo('TRANSFERENCIA'), 781000.00::numeric, 'el bucket se actualiza en tiempo real');
select is((select corregido_motivo from public.movimiento where id_transaccion = 'B3'), 'monto mal escrito', 'queda el motivo');
-- B2 (salida) a EFECTIVO: en ese bucket no hay saldo → negativo
create temp table sim as select public.corregir_movimiento(pg_temp.idm('B2'), '{"modalidad": "EFECTIVO"}', 'era efectivo', false, true) j;
grant select on sim to authenticated;
select is((select jsonb_array_length(j -> 'negativos') from sim), 1, 'vista previa: avisa que EFECTIVO queda negativo');
select is((select modalidad from public.movimiento where id_transaccion = 'B2'), 'TRANSFERENCIA', 'la vista previa no cambia nada');
select throws_like($$ select public.corregir_movimiento(pg_temp.idm('B2'), '{"modalidad": "EFECTIVO"}', 'era efectivo') $$, 'SALDO_NEGATIVO:%',
  'P-33: sin confirmación no deja el saldo negativo');
select lives_ok($$ select public.corregir_movimiento(pg_temp.idm('B2'), '{"modalidad": "EFECTIVO"}', 'era efectivo', true) $$, 'con confirmación sí');
select is(pg_temp.saldo('TRANSFERENCIA') || ' / ' || pg_temp.saldo('EFECTIVO'), '1331000.00 / -500000.00',
  'los dos buckets recalculados: TRANSFERENCIA sin la salida, EFECTIVO con −500.000 (tasa 1.000)');
select is(pg_temp.util('B2'), 10000.00::numeric, 'la utilidad se recalcula conservando los 5 puntos restados: 500 × (1025 − 5) − 500.000');

-- ------------------------------------------------------------ STW-62 edición masiva
select throws_like($$ select public.corregir_masivo(array[pg_temp.idm('B1')], '{"monto_origen": 1}', 'x y z') $$, '%solo cambia modalidad o moneda destino%',
  'la edición masiva solo cambia modalidad o moneda destino');
select is((public.corregir_masivo(array[pg_temp.idm('B1'), pg_temp.idm('B3')], '{"modalidad": "EFECTIVO"}', 'todo era efectivo', false, true) ->> 'corregidos')::int, 2,
  'vista previa masiva: 2');
select is((public.corregir_masivo(array[pg_temp.idm('B1'), pg_temp.idm('B3')], '{"modalidad": "EFECTIVO"}', 'todo era efectivo') -> 'negativos'), '[]'::jsonb,
  'masiva aplicada sin negativos (las entradas cubren la salida)');
select is(pg_temp.saldo('EFECTIVO') || ' / ' || pg_temp.saldo('TRANSFERENCIA'), '700000.00 / 11000.00',
  'EFECTIVO: 1.000.000 − 500.000 + 200.000 (tasa 1.000); en TRANSFERENCIA queda solo B0');

-- ------------------------------------------------------------ STW-57 resumen operativo y STW-56 negociaciones
select is((select sum(operaciones)::int from public.resumen_operativo where contraparte_id = 'CT-97001'), 4, 'resumen operativo: 4 operaciones');
insert into public.negociacion (fecha, cliente, moneda, valor, peso, utilidad, responsable) values ('2026-11-02', 'cliente x', 't7cop', 1000000, 4100, 50000, 'mariana');
select is((select id || ' ' || periodo || ' ' || cliente || ' ' || moneda from public.negociacion), 'NEG-00001 2026-11 CLIENTE X T7COP', 'negociación con NEG- propio');
select throws_like($$ update public.negociacion set valor = 1 $$, 'Una negociación no se edita%', 'no se edita');
select pg_temp.como('t7-laura@prueba.local');
select is((select count(*)::int from public.resumen_operativo), 0, 'el operador no ve el resumen operativo (utilidad)');
select is((select count(*)::int from public.negociacion), 0, 'ni las negociaciones');
select pg_temp.como('t7-super@prueba.local');
select lives_ok($$ select public.reabrir_periodo('2026-10', 'faltó un movimiento') $$, 'el superadmin reabre con motivo');
select pg_temp.reset();

select * from finish();
rollback;
