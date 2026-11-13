-- Migración 2000: el operador ve solo los saldos de sus clientes; estado de cuenta con los movimientos de todos los
-- libros (los ajenos marcados y sin detalle); el cliente grande solo ve su código en el catálogo; un CT por cliente grande.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1', 't20-laura@prueba.local', '{"nombre":"Laura T20"}'),
  ('00000000-0000-0000-0000-0000000000e2', 't20-seb@prueba.local', '{"nombre":"Seb T20"}'),
  ('00000000-0000-0000-0000-0000000000e3', 't20-laz@prueba.local', '{"nombre":"LAZ T20"}'),
  ('00000000-0000-0000-0000-0000000000e4', 't20-admin@prueba.local', '{"nombre":"Admin T20"}');
insert into public.usuario_rol values ('00000000-0000-0000-0000-0000000000e1', 'operador'), ('00000000-0000-0000-0000-0000000000e2', 'operador'),
  ('00000000-0000-0000-0000-0000000000e3', 'cliente_grande'), ('00000000-0000-0000-0000-0000000000e4', 'administradora');
insert into public.libro_usuario (libro_id, usuario_id)
  select id, '00000000-0000-0000-0000-0000000000e1'::uuid from public.libro where codigo = 'OPERADOR_LAURA' union all
  select id, '00000000-0000-0000-0000-0000000000e2'::uuid from public.libro where codigo = 'OPERADOR_SANTIAGO' union all
  select id, '00000000-0000-0000-0000-0000000000e3'::uuid from public.libro where codigo = 'LUCAS_ALZATE';

-- CT-97001 está en los dos operadores; CT-97002 solo en Santiago; CT-97003 es el cliente grande LAZ (lo atiende Laura)
insert into public.contraparte (id, tipo, nombre) values
  ('CT-97001', 'CLIENTE', 'Compartido T20'), ('CT-97002', 'CLIENTE', 'Solo Seb T20'), ('CT-97003', 'ALIADO', 'LAZ T20');
update public.libro set contraparte_id = 'CT-97003', operador_id = (select id from public.libro where codigo = 'OPERADOR_LAURA')
 where codigo = 'LUCAS_ALZATE';
insert into public.moneda (id, nombre) values ('T20-C', 'T20COP') on conflict do nothing;

-- Aprobados en orden: en CT-97001 Laura entra 100, Santiago sale 30, Laura entra 50 → 100, 70, 120
create temp table t20 (n int, libro text, ct text, tipo text, monto numeric, saldo numeric, fecha date);
insert into t20 values
  (1, 'OPERADOR_LAURA', 'CT-97001', 'ENTRADA', 100, 100, '2026-11-01'), (2, 'OPERADOR_SANTIAGO', 'CT-97001', 'SALIDA', 30, 70, '2026-11-02'),
  (3, 'OPERADOR_LAURA', 'CT-97001', 'ENTRADA', 50, 120, '2026-11-03'), (4, 'OPERADOR_SANTIAGO', 'CT-97002', 'ENTRADA', 10, 10, '2026-11-01'),
  (5, 'LUCAS_ALZATE', 'CT-97003', 'ENTRADA', 40, 40, '2026-11-01'), (6, 'OPERADOR_LAURA', 'CT-97003', 'SALIDA', 15, 25, '2026-11-02');
insert into public.movimiento (codigo, libro_id, id_transaccion, tipo, fecha_operacion, modalidad, contraparte_id, moneda_origen, moneda_destino,
  monto_origen, estado, aprobado_en, tasa_aplicada, monto_destino, entrada, salida, saldo_anterior, saldo_post, secuencia_bucket, orden_aprobacion, tercero)
select 'T20-' || n, (select id from public.libro where codigo = t.libro), 'T20-TX-' || n, t.tipo::public.tipo_mov,
       (t.fecha::timestamp + time '12:00') at time zone 'America/Bogota', 'TRANSFERENCIA', t.ct, 'T20COP', 'T20COP', t.monto, 'APROBADO', now(), 1, t.monto,
       case when t.tipo = 'ENTRADA' then t.monto else 0 end, case when t.tipo = 'SALIDA' then t.monto else 0 end,
       t.saldo - case when t.tipo = 'ENTRADA' then t.monto else -t.monto end, t.saldo,
       row_number() over (partition by t.ct order by n), 920000 + n, 'Tercero ' || n
  from t20 t;
insert into public.saldo_bucket (contraparte_id, moneda, modalidad, saldo, ultima_secuencia) values
  ('CT-97001', 'T20COP', 'TRANSFERENCIA', 120, 3), ('CT-97002', 'T20COP', 'TRANSFERENCIA', 10, 1), ('CT-97003', 'T20COP', 'TRANSFERENCIA', 25, 2);

create or replace function pg_temp.como(p_correo text) returns void language plpgsql as $$
declare v_id uuid;
begin
  perform set_config('role', 'postgres', true);
  select id into v_id from public.usuario where correo = p_correo;
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.reset() returns void language sql as $$ select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true); $$;
create or replace function pg_temp.mis_cts() returns text language sql as $$
  select string_agg(contraparte_id, ',' order by contraparte_id) from public.saldo_bucket where contraparte_id like 'CT-970%' $$;
grant execute on function pg_temp.mis_cts() to authenticated;

-- ------------------------------------------------------------ 1. saldos solo de sus clientes
select pg_temp.como('t20-laura@prueba.local');
select is(pg_temp.mis_cts(), 'CT-97001,CT-97003', 'Laura ve el compartido y el de su cliente grande, no el de solo Santiago');
select is((select count(*)::int from public.saldo_cliente where contraparte_id like 'CT-970%'), 2, 'la vista saldo_cliente hereda el filtro');
select pg_temp.como('t20-seb@prueba.local');
select is(pg_temp.mis_cts(), 'CT-97001,CT-97002', 'Santiago ve el compartido y el suyo');
select pg_temp.como('t20-admin@prueba.local');
select is(pg_temp.mis_cts(), 'CT-97001,CT-97002,CT-97003', 'la administración ve todos');
select pg_temp.como('t20-laz@prueba.local');
select is(pg_temp.mis_cts(), 'CT-97003', 'el cliente grande solo su código');

-- ------------------------------------------------------------ 2. estado de cuenta compartido
select pg_temp.como('t20-laura@prueba.local');
select is((select string_agg(codigo || ':' || es_propio::text || ':' || saldo_post::text, ' ' order by secuencia_bucket)
             from public.estado_cuenta('CT-97001', 'T20COP', 'TRANSFERENCIA')),
  'T20-1:true:100.00 T20-2:false:70.00 T20-3:true:120.00', 'Laura ve los tres movimientos en orden, el de Santiago marcado como ajeno');
select is((select id_transaccion is null and tercero is null from public.estado_cuenta('CT-97001', 'T20COP', 'TRANSFERENCIA') where codigo = 'T20-2'),
  true, 'del ajeno no ve id de transacción ni tercero');
select is((select id_transaccion from public.estado_cuenta('CT-97001', 'T20COP', 'TRANSFERENCIA') where codigo = 'T20-1'),
  'T20-TX-1', 'del propio sí');
select is((select libro_nombre from public.estado_cuenta('CT-97001', 'T20COP', 'TRANSFERENCIA') where codigo = 'T20-2'),
  'Santiago', 'dice de qué libro es el ajeno (aunque Laura no pueda leer ese libro)');
select is((select count(*)::int from public.movimiento where codigo = 'T20-2'), 0, 'pero la fila del movimiento ajeno sigue sin verse (RLS)');
select throws_ok($$ select * from public.estado_cuenta('CT-97002', 'T20COP', 'TRANSFERENCIA') $$, '42501', null,
  'no ve el estado de cuenta de un cliente que no es suyo');
select is((select string_agg(codigo, ' ' order by secuencia_bucket) from public.estado_cuenta('CT-97001', 'T20COP', 'TRANSFERENCIA', '2026-11-02', '2026-11-02')),
  'T20-2', 'filtra por fechas en hora de Bogotá');
select is(public.saldo_bucket_antes('CT-97001', 'T20COP', 'TRANSFERENCIA', '2026-11-03'), 70.00::numeric, 'saldo antes de una fecha, con movimientos ajenos');
select throws_ok($$ select public.saldo_bucket_antes('CT-97002', 'T20COP', 'TRANSFERENCIA', '2026-11-03') $$, '42501', null,
  'ni el saldo previo de un cliente ajeno');

select pg_temp.como('t20-laz@prueba.local');
select is((select string_agg(codigo || ':' || es_propio::text, ' ' order by secuencia_bucket) from public.estado_cuenta('CT-97003', 'T20COP', 'TRANSFERENCIA')),
  'T20-5:true T20-6:false', 'el cliente grande ve también lo que su operador registró a su código, como ajeno');
select pg_temp.como('t20-admin@prueba.local');
select is((select bool_and(es_propio) from public.estado_cuenta('CT-97001', 'T20COP', 'TRANSFERENCIA')), true, 'para la administración todo es propio');

-- ------------------------------------------------------------ 3. catálogo de contrapartes
select pg_temp.como('t20-laz@prueba.local');
select is((select string_agg(id, ',') from public.contraparte), 'CT-97003', 'el cliente grande solo ve su propio código en el catálogo');
select pg_temp.como('t20-laura@prueba.local');
select is((select count(*)::int from public.contraparte where id like 'CT-970%'), 3, 'el operador ve el catálogo completo');

-- ------------------------------------------------------------ 4. un CT, un cliente grande
select pg_temp.reset();
select throws_ok($$ update public.libro set contraparte_id = 'CT-97003' where codigo = 'COMNORTE' $$, '23505', null,
  'dos clientes grandes activos no comparten código CT');
set local role anon;
select throws_ok($$ select * from public.estado_cuenta('CT-97001', 'T20COP', 'TRANSFERENCIA') $$, '42501', null, 'sin sesión no hay estado de cuenta');

select * from finish();
rollback;
