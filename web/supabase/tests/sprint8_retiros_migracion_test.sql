-- Migración 1800 (Sprint 8): retiros de la caja (STW-45/47), código de gasto en la importación (STW-59), conciliación (STW-50).
begin;
create extension if not exists pgtap with schema extensions;
delete from public.caja_ganancia; delete from public.consecutivo_finanzas where serie like 'RET-%';
select plan(23);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d7', 't9-laz@prueba.local', '{"nombre":"LAZ T9"}'),
  ('00000000-0000-0000-0000-0000000000d8', 't9-comnorte@prueba.local', '{"nombre":"Comnorte T9"}'),
  ('00000000-0000-0000-0000-0000000000d9', 't9-admin@prueba.local', '{"nombre":"Admin T9"}');
insert into public.usuario_rol values ('00000000-0000-0000-0000-0000000000d7', 'cliente_grande'), ('00000000-0000-0000-0000-0000000000d8', 'cliente_grande'),
  ('00000000-0000-0000-0000-0000000000d9', 'administradora');
insert into public.libro_usuario (libro_id, usuario_id)
  select id, '00000000-0000-0000-0000-0000000000d7'::uuid from public.libro where codigo = 'LUCAS_ALZATE' union all
  select id, '00000000-0000-0000-0000-0000000000d8'::uuid from public.libro where codigo = 'COMNORTE';
update public.libro set usa_ganancias = true, usa_retiros = true where codigo = 'LUCAS_ALZATE';
update public.libro set usa_ganancias = true, usa_retiros = false where codigo = 'COMNORTE';
-- caja con 29.700 (como el ejemplo de LAZ)
insert into public.caja_ganancia (libro_id, codigo, tipo, entrada)
  select id, 'UTIL-T9-1', 'UTILIDAD', 29700 from public.libro where codigo = 'LUCAS_ALZATE';
insert into public.caja_ganancia (libro_id, codigo, tipo, entrada)
  select id, 'UTIL-T9-2', 'UTILIDAD', 1000 from public.libro where codigo = 'COMNORTE';

create or replace function pg_temp.como(p_correo text) returns void language plpgsql as $$
declare v_id uuid;
begin
  perform set_config('role', 'postgres', true);
  select id into v_id from public.usuario where correo = p_correo;
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.reset() returns void language sql as $$ select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true); $$;
create or replace function pg_temp.laz() returns uuid language sql as $$ select id from public.libro where codigo = 'LUCAS_ALZATE' $$;
create or replace function pg_temp.disp(p text) returns numeric language sql as $$
  select disponible from public.caja_ganancia_resumen where libro_id = (select id from public.libro where codigo = p) $$;
grant execute on function pg_temp.laz(), pg_temp.disp(text) to authenticated;

-- ------------------------------------------------------------ STW-45 retiros (doc 03 §4.3: retiro 25.000 → quedan 4.700; uno de 5.000 falla)
select pg_temp.como('t9-laz@prueba.local');
select is((public.registrar_retiro(pg_temp.laz(), 25000.50, 'retiro de prueba')).codigo, 'RET-LAZ-0001', 'retiro con código propio y decimales (P-20)');
select is(pg_temp.disp('LUCAS_ALZATE'), 4699.50::numeric, 'disponible 29.700 − 25.000,50 = 4.699,50');
select throws_like($$ select public.registrar_retiro(pg_temp.laz(), 5000, 'x') $$, 'Saldo insuficiente en la caja: disponible 4.699,50, retiro 5.000,00',
  'no se retira más de lo disponible');
select throws_like($$ select public.registrar_retiro(pg_temp.laz(), 0, 'x') $$, '%mayor que cero', 'monto positivo');
select throws_like($$ select public.registrar_retiro(pg_temp.laz(), 1.005, 'x') $$, '%2 decimales', 'máximo 2 decimales');
select is((select total_retirado from public.caja_ganancia_resumen where libro_id = pg_temp.laz()), 25000.50::numeric, 'tablero: total retirado');
select pg_temp.como('t9-comnorte@prueba.local');
select throws_like($$ select public.registrar_retiro((select id from public.libro where codigo = 'COMNORTE'), 10, 'x') $$, '%no tiene activados los retiros%',
  'STW-47: sin el módulo de retiros activado no se retira');
select throws_ok($$ select public.registrar_retiro(pg_temp.laz(), 10, 'x') $$, '42501', null, 'un cliente no retira de la caja de otro');
select pg_temp.como('t9-laz@prueba.local');
select throws_ok($$ select public.anular_retiro('RET-LAZ-0001', 'error') $$, '42501', null, 'el cliente no anula retiros');
select pg_temp.como('t9-admin@prueba.local');
select is((public.anular_retiro('RET-LAZ-0001', 'registrado por error')).entrada, 25000.50::numeric, 'la administración anula con un ajuste (no borra)');
select is(pg_temp.disp('LUCAS_ALZATE') || ' / ' || (select total_retirado from public.caja_ganancia_resumen where libro_id = pg_temp.laz()),
  '29700.00 / 0.00', 'disponible y retirado vuelven a como estaban');
select throws_like($$ select public.anular_retiro('RET-LAZ-0001', 'otra vez') $$, '%ya está anulado', 'no se anula dos veces');

-- ------------------------------------------------------------ STW-59 la importación conserva el código G- de Sheets
select pg_temp.reset();
insert into public.gasto (id, fecha, tipo, valor) values ('G-777', '2026-04-10', 'arriendo', 100);
select is((select id || ' ' || periodo || ' ' || tipo from public.gasto where id = 'G-777'), 'G-777 2026-04 ARRIENDO', 'importado sin usuario: conserva G-777');

-- ------------------------------------------------------------ STW-50 la conciliación solo la ve la administración
select pg_temp.como('t9-laz@prueba.local');
select is((select count(*)::int from public.conciliacion_corrida), 0, 'un cliente no ve la conciliación');
select pg_temp.reset();

-- ------------------------------------------------------------ migración 1900: orden de aprobación explícito (P-9)
select ok(not has_function_privilege('authenticated', 'public.siguiente_codigo(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.siguiente_codigo(uuid)', 'execute'), 'nadie fuera del sistema gasta números del consecutivo');
-- Tres aprobados en un bucket; se invierte a propósito su fecha de aprobación: el recálculo debe seguir el orden de aprobación
insert into public.contraparte (id, tipo, nombre) values ('CT-99001', 'CLIENTE', 'Orden T9') on conflict do nothing;
insert into public.moneda (id, nombre) values ('T9-C', 'T9COP') on conflict do nothing;
insert into public.movimiento (codigo, libro_id, id_transaccion, tipo, fecha_operacion, modalidad, contraparte_id, moneda_origen, moneda_destino,
  monto_origen, estado, aprobado_en, tasa_aplicada, monto_destino, entrada, salida, saldo_post, orden_aprobacion)
select 'T9-' || n, (select id from public.libro where codigo = 'OPERADOR_LAURA'), 'T9-TX-' || n, case when n = 2 then 'SALIDA' else 'ENTRADA' end::public.tipo_mov,
       '2026-11-01'::timestamptz, 'TRANSFERENCIA', 'CT-99001', 'T9COP', 'T9COP', 100, 'APROBADO', '2026-11-05'::timestamptz - n * interval '1 hour',
       1, 100, case when n = 2 then 0 else 100 end, case when n = 2 then 100 else 0 end, 0, 900000 + n
  from generate_series(1, 3) n;
select is((public.recalcular_saldos_bucket('CT-99001', 'T9COP', 'TRANSFERENCIA') ->> 'primer_negativo'), null,
  'orden 1 entrada, 2 salida, 3 entrada: sin negativos aunque las fechas de aprobación estén al revés');
select is((select string_agg(codigo || '=' || saldo_post::text, ' ' order by secuencia_bucket) from public.movimiento where contraparte_id = 'CT-99001'),
  'T9-1=100.00 T9-2=0.00 T9-3=100.00', 'el saldo sigue orden_aprobacion, no aprobado_en');
update public.movimiento set estado = 'VERIFICADO', verificado_en = now(), orden_aprobacion = null where codigo = 'T9-3';
update public.movimiento set estado = 'APROBADO' where codigo = 'T9-3';
select isnt((select orden_aprobacion from public.movimiento where codigo = 'T9-3'), null, 'al aprobar toma un número de la secuencia');
-- 1900 §3: la utilidad por período no la ve cualquiera
create temp table t9lib as select id from public.libro where codigo = 'OPERADOR_LAURA';
grant select on t9lib to authenticated;
select pg_temp.como('t9-laz@prueba.local');
select throws_ok($$ select utilidad_total from public.periodo limit 1 $$, '42501', null, 'un cliente no lee la utilidad de la casa por período');
select lives_ok($$ select id, estado from public.periodo limit 1 $$, 'pero sí el id y el estado del período');
select is((select count(*)::int from public.periodo_resumen), 0, 'ni el resumen de períodos');
select throws_ok($$ select * from public.posibles_duplicados(jsonb_build_object('libro_id', (select id from t9lib),
  'id_transaccion', 'X', 'tipo', 'ENTRADA', 'fecha', '2026-11-01', 'hora', '10:00', 'modalidad', 'TRANSFERENCIA', 'contraparte_id', 'CT-99001',
  'moneda_origen', 'T9COP', 'moneda_destino', 'T9COP', 'monto_origen', 100)) $$, '42501', null, 'un cliente no sondea duplicados de otro libro');
select pg_temp.reset();
select ok(not has_function_privilege('anon', 'public.tiene_permiso(text, uuid)', 'execute'), 'sin sesión no se consultan permisos');

select * from finish();
rollback;
