-- Migración 0600: cerrar "desde ahora" no es "cerrar al pasado". Usa los datos de seed.sql (CT-72 SOL→COP).
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

create or replace function pg_temp.como(p_correo text) returns void language plpgsql as $$
declare v_id uuid;
begin
  perform set_config('role', 'postgres', true);
  select id into v_id from public.usuario where correo = p_correo;
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

select pg_temp.como('admin@tasas.local');

select lives_ok(
  $$ select public.cambiar_beneficio('CT-72', 'SOL', 'COP', 22, now() - interval '1 second') $$,
  'administradora cambia un beneficio "desde ahora" (con unos ms de diferencia de reloj)');

select is((select beneficio from public.beneficio_vigente('CT-72', 'SOL', 'COP', now())), 22::numeric,
  'el beneficio vigente ahora es el nuevo');

select throws_like(
  $$ select public.cambiar_beneficio('CT-72', 'SOL', 'COP', 25, now() - interval '1 day') $$,
  '%Solo el superadmin%', 'cambiar un beneficio con fecha de ayer sigue siendo solo del superadmin');

select pg_temp.como('superadmin@tasas.local');
select lives_ok(
  $$ select public.cambiar_beneficio('CT-72', 'SOL', 'COP', 25, now() - interval '10 minutes') $$,
  'el superadmin sí puede hacerlo al pasado');

select * from finish();
rollback;
