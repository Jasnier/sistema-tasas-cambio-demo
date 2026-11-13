-- Migración 1300: la fecha de un comprobante no puede estar en el futuro. No usa seed.sql.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select lives_ok($$ insert into public.comprobante_brasil (banco_id, fecha, id_tx, tipo, valor)
  values ('BTG_GAMMA', (now() at time zone 'America/Bogota')::date, 'F-HOY', 'ENTRADA', 1) $$, 'hoy se acepta');
select lives_ok($$ insert into public.comprobante_brasil (banco_id, fecha, id_tx, tipo, valor)
  values ('BTG_GAMMA', (now() at time zone 'America/Bogota')::date + 1, 'F-MANANA', 'ENTRADA', 1) $$, 'mañana se acepta (carga justo después de medianoche)');
select throws_like($$ insert into public.comprobante_brasil (banco_id, fecha, id_tx, tipo, valor)
  values ('BTG_GAMMA', (now() at time zone 'America/Bogota')::date + 30, 'F-MES', 'ENTRADA', 1) $$,
  '%está en el futuro%', 'un mes adelante se rechaza (caso real: 3-dic en vez de 3-nov)');
select throws_like($$ update public.comprobante_brasil set fecha = fecha + 40 where id_tx = 'F-HOY' $$,
  '%está en el futuro%', 'tampoco se puede corregir hacia el futuro');

select * from finish();
rollback;
