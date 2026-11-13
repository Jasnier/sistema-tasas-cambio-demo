-- P-17: lista oficial de bancos de Brasil (migración 0700)
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select is((select count(*) from public.banco_brasil where activo), 7::bigint, 'P-17: 7 bancos activos');
select results_eq(
  $$ select id from public.banco_brasil order by orden $$,
  $$ values ('CORA_ALFA'), ('SICOOB_ALFA'), ('SICOOB_GAMMA'), ('CORA_BETA'), ('INTER_BETA'), ('BTG_GAMMA'), ('INTER_GAMMA') $$,
  'en el orden de las hojas de Brasil Paula');
select is((select hoja_origen from public.banco_brasil where id = 'CORA_ALFA'), 'BANCO  CORA ALFA',
  'hoja_origen conserva el nombre exacto de la hoja (doble espacio) para la migración');
select is((select hoja_origen from public.banco_brasil where id = 'CORA_BETA'), 'BANCO CORA BETA ',
  'hoja_origen conserva el espacio final de la hoja');

select * from finish();
rollback;
