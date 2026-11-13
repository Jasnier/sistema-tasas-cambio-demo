-- Migración 1000: tasas con todos sus decimales. No usa seed.sql.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into public.moneda (id, nombre) values ('P-COP', 'PCOP'), ('P-SOL', 'PSOL') on conflict do nothing;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c2', 't-admin3@prueba.local', '{"nombre":"Admin"}');
insert into public.usuario_rol (usuario_id, rol_id) values ('00000000-0000-0000-0000-0000000000c2', 'administradora');

-- Como la importación (sin usuario de la app): una tasa publicada con valor ya redondeado a 6 decimales
insert into public.tasa_cliente (id, moneda_origen, moneda_destino, modalidad, vigencia, valor, estado)
values ('TB-P00001', 'PCOP', 'PSOL', 'TRANSFERENCIA', tstzrange('2026-05-13 20:01-05', '2026-05-14 20:00-05', '[]'), 0.000918, 'CERRADO');

select lives_ok($$ update public.tasa_cliente set valor = 0.0009182736455463728 where id = 'TB-P00001' $$,
  'la importación devuelve los decimales a una tasa cerrada (mismo valor a 6 decimales)');
select is((select valor from public.tasa_cliente where id = 'TB-P00001'), 0.0009182736455463728::numeric,
  'valor guardado sin redondear');
select throws_like($$ update public.tasa_cliente set valor = 0.00093 where id = 'TB-P00001' $$,
  '%solo se puede cambiar la vigencia hasta%', 'ni la importación cambia el valor de una tasa cerrada si es otro valor');

-- Un usuario de la app no puede usar la excepción
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000c2', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_like($$ update public.tasa_cliente set valor = 0.00091827364554637 where id = 'TB-P00001' $$,
  '%solo se puede cambiar la vigencia hasta%', 'la administradora no puede tocar el valor de una tasa cerrada, ni siquiera decimales');
insert into public.tasa_cliente (moneda_origen, moneda_destino, modalidad, vigencia, valor)
values ('PCOP', 'PSOL', 'EFECTIVO', public.vigencia('2027-01-01', '2027-02-01'), 0.0016129032258064516);
select is((select valor from public.tasa_cliente where modalidad = 'EFECTIVO' and moneda_origen = 'PCOP'),
  0.0016129032258064516::numeric, 'una tasa nueva desde la app conserva todos sus decimales');
reset role;
select is((public.tasa_vigente('PCOP', 'PSOL', 'TRANSFERENCIA', '2026-05-14 08:00-05')).valor, 0.0009182736455463728::numeric,
  'tasa_vigente devuelve el valor completo');

select * from finish();
rollback;
