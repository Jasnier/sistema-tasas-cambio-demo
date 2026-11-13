-- Migración 2500: apropiadores_brasil() da el nombre de quien apropió, solo a quien trabaja con Brasil,
-- y solo de usuarios que de verdad apropiaron (no abre la tabla usuario).
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 't25-op@prueba.local', '{"nombre":"Operadora T25"}'),
  ('00000000-0000-0000-0000-0000000000f2', 't25-otro@prueba.local', '{"nombre":"Nunca apropió T25"}'),
  ('00000000-0000-0000-0000-0000000000f3', 't25-cliente@prueba.local', '{"nombre":"Cliente T25"}');
insert into public.usuario_rol values ('00000000-0000-0000-0000-0000000000f1', 'operador'),
  ('00000000-0000-0000-0000-0000000000f2', 'operador'), ('00000000-0000-0000-0000-0000000000f3', 'cliente_grande');
-- Un comprobante apropiado por la operadora de prueba (creado aquí: la prueba no depende de las semillas)
insert into public.comprobante_brasil (banco_id, fecha, tipo, valor, id_tx, apropiado_por)
values ('CORA_ALFA', current_date - 1, 'ENTRADA', 100, 'T25-PRUEBA', '00000000-0000-0000-0000-0000000000f1');

create or replace function pg_temp.como(p_correo text) returns void language plpgsql as $$
declare v_id uuid;
begin
  perform set_config('role', 'postgres', true);
  select id into v_id from public.usuario where correo = p_correo;
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

select pg_temp.como('t25-otro@prueba.local');
select ok(exists (select 1 from public.apropiadores_brasil() where nombre = 'Operadora T25'), 'un operador ve el nombre de quien apropió');
select ok(not exists (select 1 from public.apropiadores_brasil() where nombre = 'Nunca apropió T25'), 'no aparece quien nunca apropió');
select is((select count(*)::int from public.usuario where correo = 't25-op@prueba.local'), 0, 'la tabla usuario sigue cerrada');
select pg_temp.como('t25-cliente@prueba.local');
select throws_ok($$ select * from public.apropiadores_brasil() $$, '42501', null, 'un cliente grande no la puede usar');
set local role anon;
select throws_ok($$ select * from public.apropiadores_brasil() $$, '42501', null, 'sin sesión tampoco');

select * from finish();
rollback;
