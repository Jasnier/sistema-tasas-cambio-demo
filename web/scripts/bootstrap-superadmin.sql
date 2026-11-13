-- =====================================================================
-- Primer superadmin de un entorno nuevo (staging o producción). Se corre UNA vez.
--
-- 1. Dashboard → Authentication → Users → "Invite user" con el correo del superadmin.
--    (El trigger crear_perfil_usuario crea su fila en public.usuario.)
-- 2. Cambie el correo de abajo y pegue este archivo en Dashboard → SQL Editor → Run.
--
-- Por qué hace falta: el trigger proteger_superadmin solo deja asignar el rol superadmin
-- a otro superadmin. En un entorno nuevo no hay ninguno, así que se desactiva solo
-- dentro de esta transacción. Si ya existe un superadmin, no hace nada y avisa.
-- Después, el superadmin asigna los demás roles desde la aplicación (Roles y permisos).
-- =====================================================================
begin;

select set_config('stw.correo_superadmin', 'CORREO_DEL_SUPERADMIN@ejemplo.com', true);

do $$
declare
  v_correo text := lower(btrim(current_setting('stw.correo_superadmin')));
  v_id uuid;
begin
  if v_correo like 'correo_del_superadmin@%' then
    raise exception 'Cambie el correo en la línea set_config antes de ejecutar';
  end if;
  if exists (select 1 from public.usuario_rol where rol_id = 'superadmin') then
    raise exception 'Ya existe un superadmin en este entorno: no se cambia nada';
  end if;
  select id into v_id from public.usuario where lower(correo) = v_correo;
  if v_id is null then
    raise exception 'No existe el usuario %: invítelo primero en Authentication → Users', v_correo;
  end if;

  alter table public.usuario_rol disable trigger trg_proteger_usuario_rol;
  insert into public.usuario_rol (usuario_id, rol_id) values (v_id, 'superadmin');
  alter table public.usuario_rol enable trigger trg_proteger_usuario_rol;

  raise notice 'Superadmin asignado a % (queda en auditoría)', v_correo;
end $$;

commit;
