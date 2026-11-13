-- Migración 2100: la apropiación de Brasil crea el movimiento BRS- en la web (sin envío a Sheets).
begin;
create extension if not exists pgtap with schema extensions;
delete from public.comprobante_brasil; delete from public.consecutivo_banco; delete from public.consecutivo_brs;
select plan(24);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 't21-paula@prueba.local', '{"nombre":"Paula T21"}'),
  ('00000000-0000-0000-0000-0000000000f2', 't21-apro@prueba.local', '{"nombre":"Apro T21"}'),
  ('00000000-0000-0000-0000-0000000000f3', 't21-laura@prueba.local', '{"nombre":"Laura T21"}');
insert into public.usuario_rol values
  ('00000000-0000-0000-0000-0000000000f1', 'brasil'),
  ('00000000-0000-0000-0000-0000000000f2', 'brasil_operador'),
  ('00000000-0000-0000-0000-0000000000f3', 'operador');
insert into public.libro_usuario (libro_id, usuario_id)
  select id, '00000000-0000-0000-0000-0000000000f3'::uuid from public.libro where codigo = 'OPERADOR_LAURA';
insert into public.moneda (id, nombre) values ('3', 'REAL') on conflict do nothing;
insert into public.moneda (id, nombre) values ('T21-C', 'T21COP') on conflict do nothing;
insert into public.contraparte (id, tipo, nombre) values ('CT-95001', 'CLIENTE', 'Cliente T21'), ('CT-95002', 'ALIADO', 'Comnorte T21') on conflict do nothing;
update public.libro set contraparte_id = 'CT-95002', operador_id = (select id from public.libro where codigo = 'OPERADOR_LAURA') where codigo = 'COMNORTE';

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
create or replace function pg_temp.libro(p_codigo text) returns uuid language sql as $$ select id from t_libro where codigo = p_codigo $$;
create or replace function pg_temp.apropiar(p_comp uuid, p_libro text, p_moneda text default 'T21COP') returns jsonb language sql as $$
  select public.apropiar_comprobante(p_comp, pg_temp.libro(p_libro), '09:15', 'transferencia', p_moneda, null, null, 'CT-95001')
$$;

-- Un BRS-LN alto que ya existía (devuelto por Sheets antes del cambio): el consecutivo sigue desde ahí
insert into public.comprobante_brasil (banco_id, fecha, id_tx, tipo, valor, estado, codigo_brs)
  values ('INTER_BETA', '2026-10-01', 'T21-VIEJO', 'ENTRADA', 1, 'APLICADO', 'BRS-LN-90822');

select pg_temp.como('t21-paula@prueba.local');
insert into public.comprobante_brasil (banco_id, fecha, id_tx, tipo, valor, remitente, observacion) values
  ('INTER_BETA', '2026-11-05', 'T21-A', 'ENTRADA', 1250.40, 'Maria Souza', 'pix'),
  ('INTER_BETA', '2026-11-05', 'T21-CG', 'ENTRADA', 300, 'Pedro', null),
  ('INTER_BETA', '2026-11-05', 'T21-DUP', 'ENTRADA', 80, 'Ana', null);
insert into public.comprobante_brasil (banco_id, fecha, tipo, valor, remitente) values ('INTER_BETA', '2026-11-06', 'SALIDA', 45, 'Pago T21');
select pg_temp.reset();

-- ------------------------------------------------------------ apropiar crea el movimiento
select pg_temp.como('t21-apro@prueba.local');
select throws_like($$ select pg_temp.apropiar(pg_temp.idc('T21-A'), 'OPERADOR_LAURA') $$, '%Primero tome%', 'sin tomarlo no se apropia');
select public.tomar_comprobante(pg_temp.idc('T21-A'));
select throws_ok($$ select public.preparar_apropiacion(pg_temp.idc('T21-A'), pg_temp.libro('OPERADOR_LAURA'), '09:15', 'EFECTIVO', 'T21COP', null, null, 'CT-95001') $$,
  '42501', null, 'preparar_apropiacion ya es solo un paso interno');
select is(pg_temp.apropiar(pg_temp.idc('T21-A'), 'OPERADOR_LAURA') ->> 'movimiento', 'BRS-LN-90823',
  'crea BRS-LN-NNNNN siguiendo el mayor código BRS-LN que ya existía');
select pg_temp.reset();
select results_eq($$ select m.estado::text, m.tipo::text, m.moneda_origen, m.moneda_destino, m.monto_origen, m.id_transaccion,
                            m.tercero, m.modalidad, m.contraparte_id, to_char(m.fecha_operacion at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI')
                       from public.movimiento m where m.codigo = 'BRS-LN-90823' $$,
  $$ values ('BORRADOR', 'ENTRADA', 'REAL', 'T21COP', 1250.40::numeric(20,2), 'T21-A', 'Maria Souza', 'TRANSFERENCIA', 'CT-95001', '2026-11-05 09:15') $$,
  'el movimiento lleva los datos del comprobante (REAL, monto, ID, remitente) y queda en BORRADOR');
select is((select libro_id from public.movimiento where codigo = 'BRS-LN-90823'), pg_temp.libro('OPERADOR_LAURA'), 'va al libro destino elegido');
select ok((select observaciones like 'Brasil % · pix' from public.movimiento where codigo = 'BRS-LN-90823'), 'la observación cita el comprobante');
select results_eq($$ select c.estado::text, c.codigo_brs, (c.movimiento_id = m.id), c.apropiado_por, c.bloqueado_por
                       from public.comprobante_brasil c join public.movimiento m on m.codigo = c.codigo_brs where c.id_tx = 'T21-A' $$,
  $$ values ('APLICADO', 'BRS-LN-90823', true, '00000000-0000-0000-0000-0000000000f2'::uuid, null::uuid) $$,
  'el comprobante queda APLICADO, enlazado al movimiento y sin toma');

-- La operadora lo ve en su libro y puede editar lo suyo, pero no los datos del banco
select pg_temp.como('t21-laura@prueba.local');
select is((select count(*) from public.movimiento where codigo = 'BRS-LN-90823'), 1::bigint, 'la operadora del libro destino ve el movimiento');
select throws_like($$ select public.editar_movimiento((select id from public.movimiento where codigo = 'BRS-LN-90823'),
    jsonb_build_object('id_transaccion', 'T21-A', 'tipo', 'ENTRADA', 'fecha', '2026-11-05', 'hora', '09:15', 'modalidad', 'TRANSFERENCIA',
      'contraparte_id', 'CT-95001', 'moneda_origen', 'REAL', 'moneda_destino', 'T21COP', 'monto_origen', 999), true) $$,
  '%viene de un comprobante de Brasil%', 'el monto que vino del banco no se edita');
select lives_ok($$ select public.editar_movimiento((select id from public.movimiento where codigo = 'BRS-LN-90823'),
    jsonb_build_object('id_transaccion', 'T21-A', 'tipo', 'ENTRADA', 'fecha', '2026-11-05', 'hora', '10:00', 'modalidad', 'EFECTIVO',
      'contraparte_id', 'CT-95001', 'moneda_origen', 'REAL', 'moneda_destino', 'T21COP', 'monto_origen', 1250.40, 'observaciones', 'ajustado'), true) $$,
  'hora, modalidad y observaciones sí se corrigen');

-- Anular el borrador devuelve el comprobante a la bandeja
select lives_ok($$ select public.anular_borrador((select id from public.movimiento where codigo = 'BRS-LN-90823'), 'era de otro libro') $$, 'anular el borrador');
select pg_temp.reset();
select results_eq($$ select estado::text, movimiento_id, codigo_brs, envio_mensaje from public.comprobante_brasil where id_tx = 'T21-A' $$,
  $$ values ('PENDIENTE', null::uuid, null::text, 'Se anuló BRS-LN-90823: era de otro libro') $$,
  'al anular el movimiento, el comprobante vuelve a la bandeja pendiente y dice por qué');
select pg_temp.como('t21-apro@prueba.local');
select public.tomar_comprobante(pg_temp.idc('T21-A'));
select is(pg_temp.apropiar(pg_temp.idc('T21-A'), 'OPERADOR_SANTIAGO') ->> 'movimiento', 'BRS-SB-00001',
  'se reapropia a otro libro con un código nuevo (el ID ya no choca con el anulado)');
select is((select envio_mensaje from public.comprobante_brasil where id_tx = 'T21-A'), null, 'al reapropiar se borra el aviso');

-- ------------------------------------------------------------ cliente grande
select public.tomar_comprobante(pg_temp.idc('T21-CG'));
select is(pg_temp.apropiar(pg_temp.idc('T21-CG'), 'COMNORTE') ->> 'movimiento', 'BRS-CN-00001', 'a un cliente grande: BRS-CN-');
select pg_temp.reset();
select results_eq($$ select m.contraparte_id, m.operador_id, c.contraparte_id from public.movimiento m join public.comprobante_brasil c on c.movimiento_id = m.id
                      where m.codigo = 'BRS-CN-00001' $$,
  $$ values ('CT-95002', (select id from public.libro where codigo = 'OPERADOR_LAURA'), 'CT-95002') $$,
  'en un cliente grande va su propio CT y el operador que lo atiende (que lo envía a verificación)');

-- ------------------------------------------------------------ salida sin ID y errores
select pg_temp.como('t21-apro@prueba.local');
select public.tomar_comprobante((select id from public.comprobante_brasil where remitente = 'Pago T21'));
select alike(pg_temp.apropiar((select id from public.comprobante_brasil where remitente = 'Pago T21'), 'OPERADOR_LAURA') ->> 'movimiento', 'BRS-LN-%',
  'una salida sin ID del banco también se apropia');
select pg_temp.reset();
select is((select m.id_transaccion = c.codigo and m.tipo = 'SALIDA'
             from public.comprobante_brasil c join public.movimiento m on m.id = c.movimiento_id where c.remitente = 'Pago T21'), true,
  'usa el código del comprobante como id de transacción');

-- El mismo ID ya registrado en otro movimiento: error y nada a medias
select pg_temp.como('t21-laura@prueba.local');
select public.crear_movimiento(jsonb_build_object('libro_id', pg_temp.libro('OPERADOR_LAURA'), 'id_transaccion', 't21-dup ', 'tipo', 'ENTRADA',
  'fecha', '2026-11-05', 'hora', '08:00', 'modalidad', 'TRANSFERENCIA', 'contraparte_id', 'CT-95001',
  'moneda_origen', 'REAL', 'moneda_destino', 'T21COP', 'monto_origen', 80), true);
select pg_temp.como('t21-apro@prueba.local');
select public.tomar_comprobante(pg_temp.idc('T21-DUP'));
select throws_like($$ select pg_temp.apropiar(pg_temp.idc('T21-DUP'), 'OPERADOR_LAURA') $$, '%ya está registrado%',
  'si el ID ya está en otro movimiento, no se apropia');
select results_eq($$ select estado::text, bloqueado_por, movimiento_id, libro_destino_id from public.comprobante_brasil where id_tx = 'T21-DUP' $$,
  $$ values ('EN_PROCESO', '00000000-0000-0000-0000-0000000000f2'::uuid, null::uuid, null::uuid) $$,
  'el error no deja nada a medias: sigue en proceso a su nombre');
select throws_like($$ select pg_temp.apropiar(pg_temp.idc('T21-DUP'), 'OPERADOR_LAURA', 'NO-EXISTE') $$, '%', 'una moneda destino que no existe no se apropia');
select pg_temp.reset();

-- ------------------------------------------------------------ el envío a Sheets ya no existe
select hasnt_function('public', 'confirmar_apropiacion', 'ya no hay confirmación del envío a Sheets');
select hasnt_function('public', 'error_apropiacion', 'ya no hay error de envío a Sheets');
select hasnt_column('public', 'libro', 'webapp_url', 'los libros ya no guardan URL de Sheets');

select * from finish();
rollback;
