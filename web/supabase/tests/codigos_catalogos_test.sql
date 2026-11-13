-- Migración 2200: códigos automáticos en los catálogos.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000f9', 't22-admin@prueba.local', '{"nombre":"Admin T22"}');
insert into public.usuario_rol values ('00000000-0000-0000-0000-0000000000f9', 'administradora');
insert into public.contraparte (id, tipo, nombre) values ('CT-96000', 'CLIENTE', 'Alto T22');   -- el mayor manda
insert into public.recibido_en (id, nombre) values ('RE-96', 'Alto T22');
insert into public.empresa (id, nombre) values ('EM-96', 'Alto T22');
insert into public.moneda (id, nombre) values ('96', 'T22ALTA');

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000f9', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(public.siguiente_codigo_catalogo('contraparte'), 'CT-96001', 'muestra el código que se va a asignar');
insert into public.contraparte (tipo, nombre) values ('CLIENTE', 'Nuevo T22');
select is((select id from public.contraparte where nombre ilike 'Nuevo T22'), 'CT-96001', 'contraparte sin código: CT-<mayor + 1>');
insert into public.contraparte (id, tipo, nombre) values ('', 'ALIADO', 'Vacío T22');
select is((select id from public.contraparte where nombre ilike 'Vacío T22'), 'CT-96002', 'un código vacío también se asigna solo');
insert into public.contraparte (id, tipo, nombre) values (' ct-97500 ', 'CLIENTE', 'Manual T22');
select is((select id from public.contraparte where nombre ilike 'Manual T22'), 'CT-97500', 'un código escrito a mano se respeta (en mayúsculas y sin espacios)');
select throws_ok($$ insert into public.contraparte (id, tipo, nombre) values ('CT-97500', 'CLIENTE', 'Repetido') $$, '23505', null, 'un código repetido se rechaza');
insert into public.recibido_en (nombre) values ('Banco T22');
select is((select id from public.recibido_en where nombre ilike 'Banco T22'), 'RE-97', 'recibido en: RE-nn');
insert into public.empresa (nombre) values ('Empresa T22');
select is((select id from public.empresa where nombre ilike 'Empresa T22'), 'EM-97', 'empresa: EM-nn');
insert into public.moneda (nombre) values ('T22NUEVA');
select is((select id from public.moneda where nombre ilike 'T22NUEVA'), '97', 'moneda: número siguiente');
insert into public.banco_brasil (nombre) values ('Nubank São Paulo');
select is((select id from public.banco_brasil where nombre ilike 'Nubank São Paulo'), 'NUBANK_SAO_PAULO', 'banco Brasil: código desde el nombre, sin acentos');
insert into public.banco_brasil (nombre) values ('NUBANK - São Paulo');
select is((select id from public.banco_brasil where nombre ilike 'NUBANK - São Paulo'), 'NUBANK_SAO_PAULO_2', 'banco Brasil: si el código ya existe, agrega un número');
select is(public.siguiente_codigo_catalogo('banco_brasil'), null, 'banco Brasil no tiene número que mostrar');
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ set local role anon; select public.siguiente_codigo_catalogo('contraparte') $$, '42501', null, 'sin sesión no se consulta');

select * from finish();
rollback;
