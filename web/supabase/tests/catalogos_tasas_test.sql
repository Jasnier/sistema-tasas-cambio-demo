-- Pruebas STW-12 a STW-15 (catálogos, ajustes, tasas cliente, utilidad).
-- Ejecutar: npx supabase test db   (o psql dentro de una transacción; todo se revierte)
-- No depende de seed.sql: crea sus propios usuarios dentro de la transacción.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

-- ---------------------------------------------------------------- usuarios de prueba
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 't-super@prueba.local', '{"nombre":"Super"}'),
  ('00000000-0000-0000-0000-0000000000a2', 't-admin@prueba.local', '{"nombre":"Admin"}'),
  ('00000000-0000-0000-0000-0000000000a3', 't-oper@prueba.local',  '{"nombre":"Oper"}');
alter table public.usuario_rol disable trigger trg_proteger_usuario_rol;   -- solo para sembrar el superadmin
insert into public.usuario_rol (usuario_id, rol_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'superadmin'),
  ('00000000-0000-0000-0000-0000000000a2', 'administradora'),
  ('00000000-0000-0000-0000-0000000000a3', 'operador');
alter table public.usuario_rol enable trigger trg_proteger_usuario_rol;

-- La prueba parte de catálogos vacíos: quita los datos de ejemplo de seed.sql (se revierte al final)
set local session_replication_role = replica;   -- sin triggers ni FKs solo para este vaciado
update public.libro set contraparte_id = null;
delete from public.ajuste_cliente; delete from public.tasa_utilidad; delete from public.tasa_cliente;
delete from public.recibido_en; delete from public.empresa; delete from public.contraparte;
delete from public.banco_brasil; delete from public.moneda;
set local session_replication_role = origin;

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

-- ================================================================ STW-12 catálogos
select pg_temp.como('t-admin@prueba.local');
insert into public.moneda (id, nombre, orden) values ('901', '  cop ', 1), ('902', 'usd', 2), ('903', 'Sol', 3);
select is((select nombre from public.moneda where id = '901'), 'COP', 'T-6: el nombre se guarda normalizado (mayúsculas, sin espacios)');
select lives_ok($$ insert into public.empresa (id, nombre) values ('E-T1', 'Empresa Prueba') $$, 'administradora crea una empresa');
insert into public.contraparte (id, tipo, nombre) values ('CT-9001', 'CLIENTE', 'cliente prueba'), ('CT-9002', 'ALIADO', 'aliado prueba');
insert into public.recibido_en (id, nombre, descuento_fijo, descuento_moneda) values ('R-BCP', 'agente bcp', 15, 'sol');
select is(public.descuento_recibido('R-BCP', 'SOL'), 15::numeric, 'P-4/P-36: AGENTE BCP resta 15 en SOL');
select is(public.descuento_recibido('R-BCP', 'USD'), 0::numeric, 'P-36: AGENTE BCP no resta en otra moneda');
delete from public.moneda where id = '903';
select is((select count(*) from public.moneda where id = '903'), 1::bigint, 'nadie borra catálogos desde la app (se desactivan)');
select throws_ok($$ insert into public.contraparte (id, tipo, nombre) values ('C-1', 'CLIENTE', 'x') $$,
  '23514', null, 'el código de contraparte debe ser CT-nn');
select pg_temp.reset();

select pg_temp.como('t-oper@prueba.local');
select throws_ok($$ insert into public.moneda (id, nombre) values ('999', 'EUR') $$, '42501', null, 'un operador no crea monedas');
select is((select count(*) from public.moneda where id in ('901','902')), 2::bigint, 'un operador sí lee los catálogos');
select pg_temp.reset();

select throws_ok($$ insert into public.modalidad (id) values ('CHEQUE') $$, '23514', null, 'P-6: solo EFECTIVO y TRANSFERENCIA');
select throws_ok($$ update public.libro set contraparte_id = 'CT-0000' where codigo = 'COMNORTE' $$,
  '23503', null, 'libro.contraparte_id apunta al catálogo de contrapartes');

-- ================================================================ STW-14 tasas cliente
select pg_temp.como('t-admin@prueba.local');
insert into public.tasa_cliente (id, moneda_origen, moneda_destino, modalidad, vigencia, valor) values
  ('TB-T00001', 'usd', 'cop', 'efectivo', public.vigencia('2026-11-01 00:00-05', '2026-11-30 23:59:59-05'), 4100),
  ('TB-T00002', 'USD', 'COP', 'EFECTIVO', public.vigencia('2026-11-15 00:00-05', '2026-12-31 23:59:59-05'), 4200),
  ('TB-T00003', 'COP', 'COP', 'EFECTIVO', public.vigencia('2026-01-01 00:00-05', '2026-12-31 23:59:59-05'), 777);
select is((select valor from public.tasa_cliente where id = 'TB-T00003'), 1::numeric, 'origen = destino ⇒ valor 1');
select is((select estado::text from public.tasa_cliente where id = 'TB-T00001'), 'MODIFICABLE', 'una tasa nueva es borrador');
select throws_like($$ insert into public.tasa_cliente (moneda_origen, moneda_destino, modalidad, vigencia, valor, estado)
                      values ('USD','COP','TRANSFERENCIA', public.vigencia('2027-01-01','2027-02-01'), 1, 'CERRADO') $$,
  '%se crea como MODIFICABLE%', 'no se crea una tasa ya cerrada');
select throws_like($$ update public.tasa_cliente set estado = 'CERRADO' where id = 'TB-T00001' $$,
  '%use "cerrar"%', 'no se publica con un update directo');
select throws_ok($$ insert into public.tasa_cliente (moneda_origen, moneda_destino, modalidad, vigencia, valor)
                    values ('USD','COP','EFECTIVO', public.vigencia('2027-02-01','2027-01-01'), 1) $$,
  '23514', null, 'vigencia inválida (desde >= hasta)');

select lives_ok($$ select public.cerrar_tasa('TB-T00001') $$, 'cerrar_tasa publica la tasa');
select throws_like($$ select public.cerrar_tasa('TB-T00002') $$, '%se solapa con la tasa cerrada TB-T00001%',
  'no se publican dos tasas solapadas');
select lives_ok($$ select public.cerrar_tasa('TB-T00002', true) $$, 'con recorte: la anterior termina donde empieza la nueva');
select is((select upper(vigencia) from public.tasa_cliente where id = 'TB-T00001'),
  '2026-11-15 00:00-05'::timestamptz - interval '1 microsecond', 'recorte sin hueco (−1 µs)');
select is((public.tasa_vigente('USD', 'COP', 'EFECTIVO', '2026-11-14 23:59:59.999999-05')).id, 'TB-T00001', 'tasa vigente antes del corte');
select is((public.tasa_vigente(' usd', 'cop', 'Efectivo', '2026-11-15 00:00-05')).id, 'TB-T00002', 'tasa vigente en el corte (desde inclusive, textos normalizados)');
select is((public.tasa_vigente('USD', 'COP', 'EFECTIVO', '2026-12-31 23:59:59-05')).id, 'TB-T00002', 'hasta inclusive');
select throws_like($$ update public.tasa_cliente set valor = 1 where id = 'TB-T00002' $$,
  '%solo se puede cambiar la vigencia hasta%', 'una tasa cerrada no cambia de valor');
select lives_ok($$ update public.tasa_cliente set vigencia = public.vigencia(lower(vigencia), '2027-01-31') where id = 'TB-T00002' $$,
  'en una tasa cerrada sí se cambia la vigencia hasta (a futuro)');
-- TB-T00001 rige desde el 1-nov; acortarla al 5-nov (ya pasó) cambiaría la tasa de operaciones hechas
select throws_like($$ update public.tasa_cliente set vigencia = public.vigencia(lower(vigencia), now() - interval '2 days') where id = 'TB-T00001' $$,
  '%Solo el superadmin%', 'acortar al pasado una tasa cerrada es solo del superadmin');
delete from public.tasa_cliente where id = 'TB-T00002';
select is((select count(*) from public.tasa_cliente where id = 'TB-T00002'), 1::bigint, 'una tasa cerrada no se borra (RLS)');
select pg_temp.reset();
select throws_like($$ delete from public.tasa_cliente where id = 'TB-T00002' $$, '%no se puede borrar%',
  'ni siquiera sin RLS se borra una tasa cerrada (trigger)');
select pg_temp.como('t-super@prueba.local');
select lives_ok($$ update public.tasa_cliente set vigencia = public.vigencia(lower(vigencia), now() - interval '2 days') where id = 'TB-T00001' $$,
  'el superadmin sí puede corregir al pasado');
select pg_temp.reset();

select pg_temp.como('t-oper@prueba.local');
select throws_ok($$ select public.cerrar_tasa('TB-T00003') $$, '42501', null, 'un operador no publica tasas');
select pg_temp.reset();

-- ================================================================ STW-15 utilidad
select pg_temp.como('t-admin@prueba.local');
insert into public.tasa_utilidad (id, moneda_origen, moneda_destino, puntos_efectivo, puntos_transferencia, vigencia) values
  ('UT-T1', 'USD', 'COP', 30, 20, public.vigencia('2026-01-01', '2026-12-31 23:59:59')),
  ('UT-T2', 'USD', 'COP', 35, 25, public.vigencia('2026-06-01', '2027-12-31'));
select lives_ok($$ select public.cerrar_utilidad('UT-T1') $$, 'cerrar_utilidad publica la utilidad');
select throws_like($$ select public.cerrar_utilidad('UT-T2') $$, '%se solapa%', 'P-6: la utilidad tiene el mismo control de solapamiento');
select pg_temp.reset();
select pg_temp.como('t-oper@prueba.local');
select is((select count(*) from public.tasa_utilidad), 0::bigint, 'un operador no ve la utilidad (margen de la casa)');
select pg_temp.reset();

-- ================================================================ STW-13 ajustes (beneficio)
select pg_temp.como('t-admin@prueba.local');
insert into public.ajuste_cliente (id, contraparte_id, moneda_origen, moneda_destino, beneficio, vigencia)
values ('AJ-T1', 'CT-9001', 'USD', 'COP', 10, tstzrange('-infinity', 'infinity', '[]'));
select throws_like($$ update public.ajuste_cliente set beneficio = 12 where id = 'AJ-T1' $$,
  '%ya rige%', 'P-5: el beneficio vigente no se edita (no afecta históricos)');
select lives_ok($$ select public.cambiar_beneficio('CT-9001', 'usd', 'cop', 12, '2026-12-01 00:00-05') $$,
  'cambiar_beneficio cierra el actual y crea el nuevo');
select is((public.beneficio_vigente('CT-9001', 'USD', 'COP', '2026-11-20')).beneficio, 10::numeric, 'una operación anterior conserva el beneficio viejo');
select is((public.beneficio_vigente('CT-9001', 'USD', 'COP', '2026-12-02')).beneficio, 12::numeric, 'una operación nueva usa el beneficio nuevo');
select pg_temp.reset();

-- ================================================================ auditoría
select ok((select count(*) from public.auditoria where tabla = 'tasa_cliente' and registro_id = 'TB-T00001') >= 3,
  'STW-11: crear, recortar y cerrar la tasa quedaron auditados');

select * from finish();
rollback;
