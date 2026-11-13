-- =====================================================================
-- SOLO ENTORNO LOCAL: usuarios de prueba. Contraseña de todos: Local123!
-- Nunca ejecutar en staging ni producción.
-- =====================================================================
create or replace function pg_temp.crear_usuario(p_correo text, p_nombre text, p_rol text, p_libro text default null)
returns void language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_correo,
          crypt('Local123!', gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', jsonb_build_object('nombre', p_nombre),
          now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text, jsonb_build_object('sub', v_id::text, 'email', p_correo), 'email', now(), now(), now());
  insert into public.usuario_rol (usuario_id, rol_id) values (v_id, p_rol);
  if p_libro is not null then
    insert into public.libro_usuario (libro_id, usuario_id) select id, v_id from public.libro where codigo = p_libro;
  end if;
end $$;

select pg_temp.crear_usuario('superadmin@tasas.local', 'Super Admin', 'superadmin');
select pg_temp.crear_usuario('admin@tasas.local',      'Mariana (administradora)', 'administradora');
select pg_temp.crear_usuario('laura@tasas.local',       'Laura (operador)',       'operador',       'OPERADOR_LAURA');
select pg_temp.crear_usuario('santiago@tasas.local',  'Santiago (operador)',  'operador',       'OPERADOR_SANTIAGO');
select pg_temp.crear_usuario('comnorte@tasas.local',     'Comnorte (cliente)',      'cliente_grande', 'COMNORTE');
select pg_temp.crear_usuario('laz@tasas.local',        'Lucas Alzate (cliente)', 'cliente_grande', 'LUCAS_ALZATE');
select pg_temp.crear_usuario('paula@tasas.local',      'Paula (Brasil)',        'brasil');

-- Ejemplo de P-1: Comnorte y LAZ los atiende Laura (dato de prueba, no real)
update public.libro set operador_id = (select id from public.libro where codigo = 'OPERADOR_LAURA')
 where codigo in ('COMNORTE', 'LUCAS_ALZATE');

-- ---------------------------------------------------------------------
-- Catálogos y tasas de EJEMPLO (valores ficticios, solo para probar pantallas)
-- ---------------------------------------------------------------------
insert into public.moneda (id, nombre, orden) values ('1', 'COP', 1), ('2', 'USD', 2), ('3', 'REAL', 3), ('4', 'SOL', 4);
insert into public.empresa (id, nombre, orden) values ('EM-01', 'Empresa demo', 1);
insert into public.recibido_en (id, nombre, orden, descuento_fijo, descuento_moneda) values
  ('RE-01', 'Bancolombia', 1, 0, null),
  ('RE-02', 'Agente BCP', 2, 15, 'SOL');
insert into public.contraparte (id, tipo, nombre) values
  ('CT-69', 'CLIENTE', 'Cliente demo 69'),
  ('CT-70', 'CLIENTE', 'Comnorte'),
  ('CT-72', 'CLIENTE', 'Lucas Alzate'),
  ('CT-90', 'ALIADO',  'Aliado demo');
update public.libro set contraparte_id = 'CT-70' where codigo = 'COMNORTE';
update public.libro set contraparte_id = 'CT-72' where codigo = 'LUCAS_ALZATE';

insert into public.tasa_cliente (moneda_origen, moneda_destino, modalidad, vigencia, valor, estado) values
  ('SOL', 'COP', 'TRANSFERENCIA', tstzrange('2026-11-01 00:00-05', 'infinity', '[]'), 1080, 'CERRADO'),
  ('REAL', 'COP', 'TRANSFERENCIA', tstzrange('2026-11-01 00:00-05', 'infinity', '[]'), 720, 'CERRADO'),
  ('USD', 'COP', 'EFECTIVO', tstzrange('2026-11-15 00:00-05', 'infinity', '[]'), 3950, 'MODIFICABLE');
insert into public.tasa_utilidad (moneda_origen, moneda_destino, puntos_efectivo, puntos_transferencia, vigencia, estado) values
  ('SOL', 'COP', 25, 20, tstzrange('2026-11-01 00:00-05', 'infinity', '[]'), 'CERRADO'),
  ('REAL', 'COP', 12, 10, tstzrange('2026-11-01 00:00-05', 'infinity', '[]'), 'CERRADO'),
  ('COP', 'COP', 0, 0, tstzrange('2026-11-01 00:00-05', 'infinity', '[]'), 'CERRADO');
insert into public.tasa_cliente (moneda_origen, moneda_destino, modalidad, vigencia, valor, estado) values
  ('COP', 'COP', 'TRANSFERENCIA', tstzrange('2026-11-01 00:00-05', 'infinity', '[]'), 1, 'CERRADO');
insert into public.ajuste_cliente (contraparte_id, moneda_origen, moneda_destino, beneficio, vigencia) values
  ('CT-72', 'SOL', 'COP', 20, tstzrange('-infinity', 'infinity', '[]'));

-- ---------------------------------------------------------------------
-- Movimientos de EJEMPLO (Sprint 4): se crean con las mismas funciones que usa la app,
-- "como" cada usuario, para que la bandeja y el detalle tengan datos que mirar.
-- ---------------------------------------------------------------------
create or replace function pg_temp.como(p_correo text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', (select id from public.usuario where correo = p_correo), 'role', 'authenticated')::text, false);
$$;
create or replace function pg_temp.m(p_libro text, p_tx text, p_tipo text, p_dias int, p_hora text, p_ct text, p_mo text, p_md text,
                                     p_monto numeric, p_tercero text default null, p_confirmar boolean default false) returns uuid language sql as $$
  select (public.crear_movimiento(jsonb_build_object(
    'libro_id', (select id from public.libro where codigo = p_libro), 'id_transaccion', p_tx, 'tipo', p_tipo,
    'fecha', to_char((now() at time zone 'America/Bogota')::date - p_dias, 'YYYY-MM-DD'), 'hora', p_hora,
    'modalidad', 'TRANSFERENCIA', 'contraparte_id', p_ct, 'moneda_origen', p_mo, 'moneda_destino', p_md,
    'monto_origen', p_monto, 'tercero', p_tercero, 'recibido_en_id', 'RE-01'), p_confirmar)).id;
$$;

select pg_temp.como('laura@tasas.local');
select pg_temp.m('OPERADOR_LAURA', '4470012001', 'ENTRADA', 3, '09:15', 'CT-69', 'SOL', 'COP', 1250.00, 'María Pérez');
select pg_temp.m('OPERADOR_LAURA', '4470012002', 'ENTRADA', 2, '10:40', 'CT-90', 'REAL', 'COP', 3800.50, 'Aliado demo');
select pg_temp.m('OPERADOR_LAURA', '4470012003', 'SALIDA',  2, '15:05', 'CT-69', 'COP', 'COP', 2500000.00, 'Pago proveedor');
select pg_temp.m('OPERADOR_LAURA', '4470012004', 'ENTRADA', 1, '08:20', 'CT-72', 'SOL', 'COP', 640.00, 'Lucas A.');
select pg_temp.m('OPERADOR_LAURA', '4470012005', 'ENTRADA', 1, '11:55', 'CT-72', 'SOL', 'COP', 640.00, 'Lucas A.', true);  -- parecido confirmado
select pg_temp.m('OPERADOR_LAURA', '4470012006', 'ENTRADA', 0, '09:00', 'CT-69', 'USD', 'COP', 300.00);
select pg_temp.como('santiago@tasas.local');
select pg_temp.m('OPERADOR_SANTIAGO', '5580020001', 'ENTRADA', 1, '13:10', 'CT-90', 'SOL', 'COP', 980.00, 'Aliado demo');
select pg_temp.m('OPERADOR_SANTIAGO', '5580020002', 'SALIDA',  0, '16:45', 'CT-69', 'COP', 'COP', 750000.00);
select pg_temp.como('comnorte@tasas.local');
select pg_temp.m('COMNORTE', '6690030001', 'ENTRADA', 0, '10:05', 'CT-70', 'SOL', 'COP', 2100.00, 'Caja Comnorte');
select pg_temp.como('laura@tasas.local');   -- su operador lo envía a verificación (STW-42)
select public.enviar_registros_cliente(array(select id from public.movimiento where id_transaccion = '6690030001'));
select pg_temp.como('admin@tasas.local');
select public.verificar_movimientos(array(select id from public.movimiento where id_transaccion in ('4470012001', '4470012002', '5580020001')));
-- Sprint 5: dos ya aprobados (tasa, monto COP y saldo calculados por el Motor); LN-0002 queda verificado para probar
select public.aprobar_movimientos(array(select id from public.movimiento where id_transaccion in ('4470012001', '5580020001')));
-- Sprint 7: LAZ (cliente grande con ganancias) registra, envía a Laura y la administración aprueba
select pg_temp.como('laz@tasas.local');
select public.crear_movimiento(jsonb_build_object('libro_id', (select id from public.libro where codigo = 'LUCAS_ALZATE'),
  'id_transaccion', '7710040001', 'tipo', 'ENTRADA', 'fecha', to_char((now() at time zone 'America/Bogota')::date - 1, 'YYYY-MM-DD'), 'hora', '09:40',
  'modalidad', 'TRANSFERENCIA', 'moneda_origen', 'SOL', 'moneda_destino', 'COP', 'monto_origen', 1000, 'recibido_en_id', 'RE-02', 'tercero', 'Pago agente BCP'));
select public.crear_movimiento(jsonb_build_object('libro_id', (select id from public.libro where codigo = 'LUCAS_ALZATE'),
  'id_transaccion', '7710040002', 'tipo', 'ENTRADA', 'fecha', to_char((now() at time zone 'America/Bogota')::date - 1, 'YYYY-MM-DD'), 'hora', '15:10',
  'modalidad', 'TRANSFERENCIA', 'moneda_origen', 'SOL', 'moneda_destino', 'COP', 'monto_origen', 500, 'recibido_en_id', 'RE-01'));
select public.crear_movimiento(jsonb_build_object('libro_id', (select id from public.libro where codigo = 'LUCAS_ALZATE'),
  'id_transaccion', '7710040003', 'tipo', 'ENTRADA', 'fecha', to_char((now() at time zone 'America/Bogota')::date, 'YYYY-MM-DD'), 'hora', '08:00',
  'modalidad', 'TRANSFERENCIA', 'moneda_origen', 'SOL', 'moneda_destino', 'COP', 'monto_origen', 300, 'recibido_en_id', 'RE-01'));
select pg_temp.como('laura@tasas.local');   -- Laura atiende a LAZ: envía dos y deja uno en borrador
select public.enviar_registros_cliente(array(select id from public.movimiento where id_transaccion in ('7710040001', '7710040002')));
select pg_temp.como('admin@tasas.local');
select public.verificar_movimientos(array(select id from public.movimiento where id_transaccion in ('7710040001', '7710040002')));
select public.aprobar_movimientos(array(select id from public.movimiento where id_transaccion in ('7710040001', '7710040002')));

-- Sprint 8: LAZ retira 5.000 de su caja (queda disponible 24.700)
select pg_temp.como('laz@tasas.local');
select public.registrar_retiro((select id from public.libro where codigo = 'LUCAS_ALZATE'), 5000, 'Retiro de ejemplo');

-- Migración 1500: un rechazo de cliente grande (lo hace Laura, su operador) y gastos de ejemplo
select pg_temp.como('laura@tasas.local');
select public.rechazar_movimientos(array(select id from public.movimiento where id_transaccion = '6690030001'), 'El comprobante no se lee: envíelo de nuevo');
select pg_temp.como('admin@tasas.local');
insert into public.gasto (fecha, tipo, proveedor, descripcion, valor, tipo_abono, oficina) values
  ((now() at time zone 'America/Bogota')::date - 5, 'ARRIENDO', 'Inmobiliaria demo', 'Oficina centro', 2500000, 'TRANSFERENCIA', 'CENTRO'),
  ((now() at time zone 'America/Bogota')::date - 3, 'SERVICIOS', 'Empresa de energía', 'Luz y agua', 380000, 'TRANSFERENCIA', 'CENTRO'),
  ((now() at time zone 'America/Bogota')::date - 1, 'PAPELERÍA', 'Papelería demo', null, 85000, 'EFECTIVO', 'NORTE');
insert into public.negociacion (fecha, cliente, contraparte_id, moneda, valor, peso, utilidad, responsable, observacion) values
  ((now() at time zone 'America/Bogota')::date - 2, 'Aliado demo', 'CT-90', 'USD', 15000, 3950, 450000, 'Mariana', 'Ejemplo inventado');
select set_config('request.jwt.claims', '', false);
