-- Sprint 3 Brasil (migración 1100): clases, saldo, Binance, toma/apropiación, conciliación. No usa seed.sql.
begin;
create extension if not exists pgtap with schema extensions;
-- Independiente de los datos que dejen las pruebas e2e: se vacía dentro de esta transacción (rollback)
delete from public.comprobante_brasil; delete from public.consecutivo_banco;
select plan(23);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d1', 't3-paula@prueba.local', '{"nombre":"Paula"}'),
  ('00000000-0000-0000-0000-0000000000d2', 't3-apro1@prueba.local', '{"nombre":"Apro1"}'),
  ('00000000-0000-0000-0000-0000000000d3', 't3-apro2@prueba.local', '{"nombre":"Apro2"}');
insert into public.usuario_rol values
  ('00000000-0000-0000-0000-0000000000d1', 'brasil'),
  ('00000000-0000-0000-0000-0000000000d2', 'brasil_operador'),
  ('00000000-0000-0000-0000-0000000000d3', 'brasil_operador');
insert into public.moneda (id, nombre) values ('T3-R', 'T3REAL'), ('T3-C', 'T3COP') on conflict do nothing;
insert into public.moneda (id, nombre) values ('3', 'REAL') on conflict do nothing;   -- moneda de origen de lo apropiado (2100)
insert into public.contraparte (id, tipo, nombre) values ('CT-93001', 'CLIENTE', 'Cliente T3') on conflict do nothing;

-- Ids de libros leídos como postgres: quien apropia ya no lee la tabla libro (2400, P-1)
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

-- ------------------------------------------------------------ clases (Paula)
select pg_temp.como('t3-paula@prueba.local');
insert into public.comprobante_brasil (banco_id, fecha, clase, tipo, valor, observacion)
  values ('INTER_BETA', '2026-11-01', 'SALDO_INICIAL', 'ENTRADA', 1000, 'saldo inicial');
insert into public.comprobante_brasil (banco_id, fecha, id_tx, tipo, valor, remitente) values
  ('INTER_BETA', '2026-11-02', 'T3-A', 'ENTRADA', 500, 'Maria'),
  ('INTER_BETA', '2026-11-02', 'T3-B', 'ENTRADA', 500, 'Maria'),      -- duplicado probable de T3-A
  ('INTER_BETA', '2026-11-03', 'T3-C', 'ENTRADA', 200, 'Pedro');
insert into public.comprobante_brasil (banco_id, fecha, tipo, valor, remitente) values ('INTER_BETA', '2026-11-03', 'SALIDA', 100, 'Pago');
insert into public.comprobante_brasil (banco_id, fecha, clase, tipo, valor, tasa_binance, remitente, observacion)
  values ('INTER_BETA', '2026-11-03', 'BINANCE', 'SALIDA', 540, 5.4, '5,4', 'BINANCE');
select is((select usdt from public.comprobante_brasil where clase = 'BINANCE' and banco_id = 'INTER_BETA'), 100.00000000::numeric,
  'Binance: USDT = total BRL / tasa (540 / 5,4 = 100)');
select throws_ok($$ insert into public.comprobante_brasil (banco_id, fecha, clase, tipo, valor) values ('INTER_BETA', '2026-11-03', 'BINANCE', 'SALIDA', 1) $$,
  '23514', null, 'Binance exige tasa');
select throws_ok($$ insert into public.comprobante_brasil (banco_id, fecha, tipo, valor) values ('INTER_BETA', '2026-11-03', 'ENTRADA', 1) $$,
  '23514', null, 'una entrada de comprobante exige ID de transacción');
select lives_ok($$ insert into public.comprobante_brasil (banco_id, fecha, tipo, valor) values ('INTER_BETA', '2026-11-04', 'SALIDA', 1) $$,
  'una salida puede no tener ID (doc 03 §5.2)');
select throws_like($$ update public.comprobante_brasil set codigo_brs = 'BRS-LN-1' where id_tx = 'T3-A' $$,
  '%no editables desde la carga%', 'la carga no toca los campos de apropiación');
select pg_temp.reset();

-- ------------------------------------------------------------ STW-17 saldo de cierre
select results_eq($$ select fecha::text, saldo_cierre from public.resumen_brasil_dia where banco_id = 'INTER_BETA' order by fecha $$,
  $$ values ('2026-11-01', 1000::numeric), ('2026-11-02', 2000::numeric), ('2026-11-03', 1560::numeric), ('2026-11-04', 1559::numeric) $$,
  'saldo de cierre por día = acumulado (saldo inicial + entradas − salidas, Binance incluida)');

-- ------------------------------------------------------------ STW-18 toma y apropiación
select pg_temp.como('t3-paula@prueba.local');
select throws_ok($$ select public.tomar_comprobante(pg_temp.idc('T3-A')) $$, '42501', null, 'Paula (solo carga) no apropia');
select pg_temp.reset();
select pg_temp.como('t3-apro1@prueba.local');
select is((public.tomar_comprobante(pg_temp.idc('T3-A'))).estado::text, 'EN_PROCESO', 'quien apropia toma el comprobante');
select throws_like($$ select public.tomar_comprobante((select id from public.comprobante_brasil where clase = 'SALDO_INICIAL' and banco_id = 'INTER_BETA')) $$,
  '%no se apropia%', 'un saldo inicial no se apropia');
select is((select count(*) from public.libros_destino_brasil()), 11::bigint, 'quien apropia ve los libros destino (función de la 2400)');
select pg_temp.reset();
select pg_temp.como('t3-apro2@prueba.local');
select throws_like($$ select public.tomar_comprobante(pg_temp.idc('T3-A')) $$, '%otra persona%', 'P-18: mientras otro lo tiene, no se puede tomar');
select throws_like($$ select public.apropiar_comprobante(pg_temp.idc('T3-A'), (select id from t_libro where codigo = 'OPERADOR_LAURA'),
                     '10:00', 'EFECTIVO', 'T3COP', null, null, 'CT-93001') $$, '%Primero tome%', 'solo quien lo tomó prepara la apropiación');
select pg_temp.reset();
update public.comprobante_brasil set bloqueado_en = now() - interval '11 minutes' where id_tx = 'T3-A';   -- pasan 11 minutos
select pg_temp.como('t3-apro2@prueba.local');
select is((public.tomar_comprobante(pg_temp.idc('T3-A'))).bloqueado_por, '00000000-0000-0000-0000-0000000000d3'::uuid,
  'P-18: a los 10 minutos se libera y otra persona lo puede tomar');
select throws_like($$ select public.apropiar_comprobante(pg_temp.idc('T3-A'), (select id from t_libro where codigo = 'BRASIL'),
                     '10:00', 'EFECTIVO', 'T3COP', null, null, 'CT-93001') $$, '%libro destino válido%', 'el destino debe ser un operador o cliente grande');
select throws_like($$ select public.apropiar_comprobante(pg_temp.idc('T3-A'), (select id from t_libro where codigo = 'OPERADOR_LAURA'),
                     null, 'EFECTIVO', 'T3COP', null, null, 'CT-93001') $$, '%hora%', 'la hora es obligatoria');
-- 2100: apropiar crea el movimiento BRS- en la web (antes se enviaba a Sheets y se confirmaba)
select lives_ok($$ select public.apropiar_comprobante(pg_temp.idc('T3-A'), (select id from t_libro where codigo = 'OPERADOR_LAURA'),
                     '10:30', 'efectivo', 't3cop', null, null, 'CT-93001') $$, 'apropiar');
select is((select modalidad || '/' || moneda_destino from public.comprobante_brasil where id_tx = 'T3-A'), 'EFECTIVO/T3COP', 'modalidad y moneda normalizadas');
select is((select estado::text from public.comprobante_brasil where id_tx = 'T3-A'), 'APLICADO', 'apropiar deja el comprobante APLICADO');
select is((select (codigo_brs like 'BRS-LN-%')::text || ' ' || (apropiado_por = '00000000-0000-0000-0000-0000000000d3')::text from public.comprobante_brasil where id_tx = 'T3-A'),
  'true true', 'queda el código BRS y quién apropió');
select throws_like($$ select public.tomar_comprobante(pg_temp.idc('T3-A')) $$, '%no está disponible%', 'un comprobante se apropia una sola vez');
select throws_like($$ select public.apropiar_comprobante(pg_temp.idc('T3-B'), (select id from t_libro where codigo = 'OPERADOR_LAURA'),
                     '10:30', 'EFECTIVO', 'T3COP', null, null, 'CT-93001') $$, '%Primero tome%', 'sin tomarlo no se apropia');

-- toma y liberación
select is((public.tomar_comprobante(pg_temp.idc('T3-C'))).estado::text, 'EN_PROCESO', 'tomar otro comprobante');
select public.liberar_comprobante(pg_temp.idc('T3-C'));
select is((select estado::text from public.comprobante_brasil where id_tx = 'T3-C'), 'PENDIENTE', 'liberar lo devuelve a pendiente');
select pg_temp.reset();


select * from finish();
rollback;
