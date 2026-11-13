-- =====================================================================
-- Arreglos de la auditoría del 2026-11-12 (base de datos). No borra nada; el único cambio de datos es devolver a la
-- bandeja los comprobantes de Brasil cuyo movimiento ya estaba rechazado (punto 2).
--
--   1. Acceso: un usuario desactivado o sin ningún rol ya no lee catálogos, tasas ni contrapartes, y un
--      desactivado deja de ver sus libros y su saldo aunque conserve la sesión abierta.
--   2. Brasil: un movimiento RECHAZADO libera el id de transacción y devuelve el comprobante a la bandeja
--      (antes solo lo hacía el ANULADO y el comprobante quedaba amarrado a un movimiento muerto).
--   3. Saldos: el operador ve el saldo de un cliente cuando tiene un movimiento APROBADO suyo, no con un borrador.
--   4. Ganancias: al corregir la moneda de origen se usa el beneficio del par nuevo.
--   5. Superadmin: nadie más le quita el rol, lo desactiva ni lo modifica; otorgado_por lo pone la base.
--   6. Períodos: aprobar/corregir y cerrar el período ya no se cruzan (bloqueo compartido de la fila).
--   7. enviar_registros_cliente y responder_liberacion comprueban el permiso (un desactivado ya no las usa).
--   8. Un comprobante anulado ya no impide volver a cargar el mismo id en ese banco.
--   9. corregir_apropiacion bloquea el comprobante antes de validar quién lo apropió.
--
-- No se editan las migraciones anteriores: las funciones se vuelven a crear completas (conservan sus permisos).
-- Las políticas nuevas ya van con el patrón de la 2800: lo que no depende de la fila, dentro de (select …).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Acceso
-- ---------------------------------------------------------------------
-- ¿Quien llama es un usuario activo con algún rol o permiso delegado? (sin parámetro: solo sobre uno mismo)
create or replace function public.tiene_acceso()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from usuario u
     where u.id = auth.uid() and u.activo
       and (exists (select 1 from usuario_rol ur where ur.usuario_id = u.id)
            or exists (select 1 from usuario_permiso up where up.usuario_id = u.id)));
$$;
revoke all on function public.tiene_acceso() from public, anon;
grant execute on function public.tiene_acceso() to authenticated, service_role;

-- Libros en los que el usuario está asignado (libro_usuario). Un usuario desactivado no tiene ninguno.
create or replace function public.mis_libros(uid uuid default auth.uid())
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(lu.libro_id), '{}') from libro_usuario lu
   where lu.usuario_id = uid and exists (select 1 from usuario u where u.id = uid and u.activo);
$$;

-- Códigos CT de los libros de cliente grande del usuario (portal). Un usuario desactivado no tiene ninguno.
create or replace function public.mis_contrapartes(uid uuid default auth.uid())
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct l.contraparte_id) filter (where l.contraparte_id is not null), '{}')
    from libro l join libro_usuario lu on lu.libro_id = l.id
   where l.tipo = 'cliente_grande' and lu.usuario_id = uid
     and exists (select 1 from usuario u where u.id = uid and u.activo);
$$;

-- ¿El usuario pertenece a este libro (o a un cliente de su operador)?
create or replace function public.puede_ver_libro(p_libro uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.tiene_permiso('APROBAR_MOVIMIENTO', uid)          -- administración ve todos los libros
      or (exists (select 1 from usuario u where u.id = uid and u.activo)
          and (exists (select 1 from libro_usuario lu where lu.usuario_id = uid and lu.libro_id = p_libro)
               or exists (select 1 from libro c join libro_usuario lu on lu.libro_id = c.operador_id
                           where c.id = p_libro and lu.usuario_id = uid)));
$$;

-- ¿Es el usuario dueño (miembro) de un libro de cliente grande con este código CT?
create or replace function public.es_mi_contraparte(p_ct text, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from libro l join libro_usuario lu on lu.libro_id = l.id join usuario u on u.id = lu.usuario_id
                  where l.tipo = 'cliente_grande' and l.contraparte_id = p_ct and lu.usuario_id = uid and u.activo);
$$;

-- Catálogo de clientes, en positivo: la administración; el cliente grande solo su código; los demás (operador,
-- Brasil) todo el catálogo, pero solo si son usuarios activos con algún rol. Antes "not PORTAL_CLIENTE" dejaba
-- pasar a quien no tenía ningún permiso (desactivado o recién registrado).
alter policy contraparte_leer on public.contraparte
  using ((select public.tiene_permiso('APROBAR_MOVIMIENTO'))
         or id = any ((select public.mis_contrapartes())::text[])
         or ((select public.tiene_acceso()) and not (select public.tiene_permiso('PORTAL_CLIENTE'))));

-- Lo que antes leía "cualquiera con sesión" (using (true)) ahora exige usuario activo con algún rol
do $$
declare t text;
begin
  foreach t in array array['rol', 'permiso', 'rol_permiso', 'moneda', 'empresa', 'recibido_en', 'banco_brasil',
                           'modalidad', 'tasa_cliente', 'periodo'] loop
    execute format('alter policy %I on public.%I using ((select public.tiene_acceso()))', t || '_leer', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Saldos por operador: cuenta un movimiento APROBADO en sus libros (un borrador no da acceso al saldo)
-- ---------------------------------------------------------------------
create or replace function public.puede_ver_ct(p_ct text, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.tiene_permiso('APROBAR_MOVIMIENTO', uid)                       -- administración: todos
      or public.es_mi_contraparte(p_ct, uid)                                   -- cliente grande: su código
      or (public.tiene_permiso('VER_REPORTES', uid) and exists (               -- operador: sus clientes
            select 1 from movimiento m
             where m.contraparte_id = p_ct and m.estado = 'APROBADO'
               and (exists (select 1 from libro_usuario lu where lu.usuario_id = uid and lu.libro_id = m.libro_id)
                    or exists (select 1 from libro c join libro_usuario lu on lu.libro_id = c.operador_id
                                where c.id = m.libro_id and lu.usuario_id = uid))));
$$;

-- Clientes con algún movimiento aprobado en los libros que ve: la parte "operador" de puede_ver_ct
create or replace function public.cts_de_mis_libros(uid uuid default auth.uid())
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct m.contraparte_id), '{}') from movimiento m
   where m.libro_id = any(public.libros_visibles(uid)) and m.estado = 'APROBADO'
     and m.contraparte_id is not null;
$$;

-- ---------------------------------------------------------------------
-- 2. Brasil: RECHAZADO se trata como ANULADO
-- ---------------------------------------------------------------------
create or replace function public.apropiar_comprobante(
  p_id uuid, p_libro uuid, p_hora time, p_modalidad text, p_moneda_destino text,
  p_recibido_en text, p_empresa text, p_contraparte text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare c comprobante_brasil; l libro; p jsonb; m movimiento; v_parecido boolean; v_dup text;
begin
  -- Permiso, toma vigente, libro válido y hora obligatoria (las mismas reglas de la 1100)
  c := preparar_apropiacion(p_id, p_libro, p_hora, p_modalidad, p_moneda_destino, p_recibido_en, p_empresa, p_contraparte);
  select * into l from libro where id = c.libro_destino_id;

  p := jsonb_build_object(
    'libro_id', l.id,
    -- Las salidas pueden venir sin ID del banco: se usa el código del comprobante (único)
    'id_transaccion', coalesce(c.id_tx, c.codigo),
    'tipo', c.tipo::text,
    'fecha', c.fecha::text,
    'hora', to_char(c.hora_operacion, 'HH24:MI'),
    'modalidad', c.modalidad,
    'recibido_en_id', c.recibido_en_id,
    'empresa_id', c.empresa_id,
    'contraparte_id', c.contraparte_id,
    'tercero', c.remitente,
    'moneda_origen', 'REAL',
    'moneda_destino', c.moneda_destino,
    'monto_origen', c.valor,
    'observaciones', concat_ws(' · ', 'Brasil ' || c.codigo, c.observacion));
  m := armar_movimiento(p);
  -- Mismo id de transacción en otro movimiento = error; un parecido solo queda marcado
  -- (el comprobante del banco es la fuente: no hay a quién preguntarle "¿registrar igual?").
  -- Mismas reglas que posibles_duplicados (STW-25): lo anulado y lo rechazado no cuentan.
  select string_agg(o.codigo || ' (' || ol.nombre || ')', ', ') into v_dup
    from movimiento o join libro ol on ol.id = o.libro_id
   where o.estado not in ('ANULADO', 'RECHAZADO') and lower(btrim(o.id_transaccion)) = lower(m.id_transaccion);
  if v_dup is not null then
    raise exception 'El id de transacción "%" ya está registrado en %', m.id_transaccion, v_dup using errcode = '23505';
  end if;
  v_parecido := exists (select 1 from movimiento o
     where o.estado not in ('ANULADO', 'RECHAZADO') and o.contraparte_id = m.contraparte_id and o.moneda_origen = m.moneda_origen
       and o.tipo = m.tipo and o.monto_origen = m.monto_origen
       and (o.fecha_operacion at time zone 'America/Bogota')::date = (m.fecha_operacion at time zone 'America/Bogota')::date);
  m.id := gen_random_uuid();
  m.codigo := siguiente_codigo_brs(l.id);
  m.estado := 'BORRADOR';
  m.duplicado_confirmado := v_parecido;
  m.creado_por := auth.uid();
  m.creado_en := now();
  m.actualizado_en := now();
  insert into movimiento select (m).*;

  update comprobante_brasil set
    estado = 'APLICADO', movimiento_id = m.id, codigo_brs = m.codigo,
    contraparte_id = m.contraparte_id,      -- en un cliente grande es siempre su propio CT
    envio_mensaje = null, apropiado_por = auth.uid(), apropiado_en = now(), bloqueado_por = null, bloqueado_en = null
   where id = c.id;

  return jsonb_build_object('codigo', c.codigo, 'movimiento', m.codigo, 'libro', l.nombre,
                            'parecido', v_parecido, 'cliente_grande', l.tipo = 'cliente_grande');
exception when unique_violation then
  if sqlerrm like '%movimiento_id_transaccion%' then
    raise exception 'El id de transacción "%" ya está registrado en otro movimiento', coalesce(c.id_tx, c.codigo) using errcode = '23505';
  end if;
  raise;
end $$;

-- Si el movimiento de un comprobante se anula O SE RECHAZA, el comprobante vuelve a la bandeja con el motivo
create or replace function public.devolver_comprobante_anulado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update comprobante_brasil set
    estado = 'PENDIENTE', movimiento_id = null, codigo_brs = null, apropiado_por = null, apropiado_en = null,
    bloqueado_por = null, bloqueado_en = null,
    envio_mensaje = left(case when new.estado = 'RECHAZADO'
                              then 'Se rechazó ' || new.codigo || ': ' || coalesce(new.rechazado_motivo, '')
                              else 'Se anuló ' || new.codigo || ': ' || coalesce(new.anulado_motivo, '') end, 500)
   where movimiento_id = new.id and estado = 'APLICADO';
  return null;
end $$;
drop trigger movimiento_anulado_devuelve_comprobante on public.movimiento;
create trigger movimiento_anulado_devuelve_comprobante after update of estado on public.movimiento
  for each row when (new.estado in ('ANULADO', 'RECHAZADO') and old.estado not in ('ANULADO', 'RECHAZADO'))
  execute function public.devolver_comprobante_anulado();

-- Los que ya estaban así antes de esta migración (rechazados con el comprobante todavía amarrado) también vuelven
update public.comprobante_brasil c set
    estado = 'PENDIENTE', movimiento_id = null, codigo_brs = null, apropiado_por = null, apropiado_en = null,
    bloqueado_por = null, bloqueado_en = null,
    envio_mensaje = left('Se rechazó ' || m.codigo || ': ' || coalesce(m.rechazado_motivo, ''), 500)
  from public.movimiento m
 where m.id = c.movimiento_id and m.estado = 'RECHAZADO' and c.estado = 'APLICADO';

-- ---------------------------------------------------------------------
-- 9. corregir_apropiacion: se bloquea el comprobante ANTES de mirar quién lo apropió (dos correcciones a la vez)
-- ---------------------------------------------------------------------
create or replace function public.corregir_apropiacion(p_id uuid, p_motivo text)
returns public.comprobante_brasil language plpgsql security definer set search_path = public as $$
declare c comprobante_brasil;
begin
  if not tiene_permiso('BRASIL_APROPIAR') then raise exception 'No tiene permiso BRASIL_APROPIAR' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escriba el motivo de la corrección'; end if;
  select * into c from comprobante_brasil where id = p_id for update;
  if not found then raise exception 'El comprobante no existe'; end if;
  if c.apropiado_por is distinct from auth.uid() and not tiene_permiso('APROBAR_MOVIMIENTO') then
    raise exception 'Solo quien lo apropió (o la administración) lo corrige: solicite la liberación' using errcode = '42501';
  end if;
  return liberar_apropiacion(p_id, p_motivo, auth.uid());
end $$;

-- ---------------------------------------------------------------------
-- 7. Funciones que cambiaban estado sin comprobar el permiso al entrar
-- ---------------------------------------------------------------------
-- Quien lo apropió (o la administración) responde
create or replace function public.responder_liberacion(p_solicitud uuid, p_aceptar boolean, p_respuesta text default null)
returns public.solicitud_liberacion language plpgsql security definer set search_path = public as $$
declare s solicitud_liberacion; c comprobante_brasil;
begin
  if not tiene_permiso('BRASIL_APROPIAR') and not tiene_permiso('APROBAR_MOVIMIENTO') then
    raise exception 'No tiene permiso BRASIL_APROPIAR' using errcode = '42501';
  end if;
  select * into s from solicitud_liberacion where id = p_solicitud for update;
  if not found then raise exception 'La solicitud no existe'; end if;
  if s.dirigida_a is distinct from auth.uid() and not tiene_permiso('APROBAR_MOVIMIENTO') then
    raise exception 'Esta solicitud no es para usted' using errcode = '42501';
  end if;
  if s.estado <> 'PENDIENTE' then raise exception 'La solicitud ya fue atendida (%)', lower(s.estado); end if;
  select * into c from comprobante_brasil where id = s.comprobante_id;
  if c.estado <> 'APLICADO' or c.movimiento_id is distinct from s.movimiento_id then
    update solicitud_liberacion set estado = 'ANULADA', respuesta = 'La apropiación ya había cambiado', atendida_por = auth.uid(), atendida_en = now()
     where id = s.id returning * into s;
    return s;
  end if;
  if p_aceptar then
    perform liberar_apropiacion(s.comprobante_id, 'liberado a pedido: ' || s.motivo, s.solicitado_por);
    update solicitud_liberacion set estado = 'ACEPTADA', respuesta = nullif(btrim(coalesce(p_respuesta, '')), ''),
           atendida_por = auth.uid(), atendida_en = now()
     where id = s.id returning * into s;
  else
    if length(btrim(coalesce(p_respuesta, ''))) < 3 then raise exception 'Escriba por qué no lo libera'; end if;
    update solicitud_liberacion set estado = 'RECHAZADA', respuesta = btrim(p_respuesta), atendida_por = auth.uid(), atendida_en = now()
     where id = s.id returning * into s;
  end if;
  return s;
end $$;

-- STW-42: el operador (o la administración) envía los registros del libro de su cliente grande a verificación
create or replace function public.enviar_registros_cliente(p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare r movimiento; l libro; v_hechos text[] := '{}'; v_omitidos jsonb := '[]'; v_admin boolean := tiene_permiso('APROBAR_MOVIMIENTO');
begin
  if not v_admin and not tiene_permiso('REGISTRAR_MOVIMIENTO') then
    raise exception 'No tiene permiso REGISTRAR_MOVIMIENTO' using errcode = '42501';
  end if;
  for r in select * from movimiento where id = any(p_ids) order by codigo for update loop
    select * into l from libro where id = r.libro_id;
    if l.tipo <> 'cliente_grande' then
      v_omitidos := v_omitidos || jsonb_build_object('codigo', r.codigo, 'motivo', 'es de un libro de operador (va directo a verificación)');
    elsif not v_admin and not exists (select 1 from libro_usuario lu where lu.libro_id = l.operador_id and lu.usuario_id = auth.uid()) then
      v_omitidos := v_omitidos || jsonb_build_object('codigo', r.codigo, 'motivo', 'solo lo envía el operador que atiende a ese cliente');
    elsif r.estado <> 'BORRADOR' then
      v_omitidos := v_omitidos || jsonb_build_object('codigo', r.codigo, 'motivo', 'está ' || lower(r.estado::text));
    else
      update movimiento set estado = 'ENVIADO_OPERADOR', enviado_en = now(), enviado_por = auth.uid(), operador_id = l.operador_id,
             actualizado_en = now()
       where id = r.id;
      v_hechos := v_hechos || r.codigo;
    end if;
  end loop;
  return jsonb_build_object('hechos', to_jsonb(v_hechos), 'omitidos', v_omitidos);
end $$;

-- ---------------------------------------------------------------------
-- 8. Comprobante único por banco… entre los que no están anulados (el trigger de la 1100 dice "anúlelo y cárguelo
--    de nuevo", pero el índice completo lo impedía)
-- ---------------------------------------------------------------------
do $$
declare v text;
begin
  select string_agg(banco_id || ' / ' || k, ', ') into v
    from (select banco_id, lower(btrim(id_tx)) as k from public.comprobante_brasil
           where estado <> 'ANULADO' and id_tx is not null group by 1, 2 having count(*) > 1 limit 10) d;
  if v is not null then
    raise exception 'Hay comprobantes vivos repetidos (banco / id): %. Corríjalos antes de aplicar esta migración.', v;
  end if;
end $$;
drop index if exists public.comprobante_brasil_banco_idtx;
create unique index comprobante_brasil_banco_idtx on public.comprobante_brasil (banco_id, lower(btrim(id_tx)))
  where estado <> 'ANULADO';

-- ---------------------------------------------------------------------
-- 5. Superadmin
-- ---------------------------------------------------------------------
-- Nadie, salvo el superadmin, asigna, cambia o QUITA el rol superadmin, ni asigna permisos "solo_superadmin"
create or replace function public.proteger_superadmin()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_permiso text;
begin
  -- Solo se controla a los usuarios de la aplicación; migraciones, semillas y service_role pasan
  if coalesce(auth.role(), '') <> 'authenticated' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_table_name = 'usuario_rol' then
    if tg_op = 'DELETE' then
      if old.rol_id = 'superadmin' and not public.es_superadmin() then
        raise exception 'Solo el superadmin puede quitar el rol superadmin';
      end if;
      return old;
    end if;
    if (new.rol_id = 'superadmin' or (tg_op = 'UPDATE' and old.rol_id = 'superadmin')) and not public.es_superadmin() then
      raise exception 'Solo el superadmin puede asignar el rol superadmin';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  v_permiso := new.permiso;
  if (select solo_superadmin from permiso where codigo = v_permiso) and not public.es_superadmin() then
    raise exception 'El permiso % solo puede tenerlo el superadmin', v_permiso;
  end if;
  return new;
end $$;
create trigger trg_proteger_usuario_rol_borrar before delete on public.usuario_rol
  for each row execute function public.proteger_superadmin();

-- El perfil de un superadmin (activo, nombre, correo) solo lo cambia un superadmin
create or replace function public.proteger_usuario_superadmin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'authenticated'
     and exists (select 1 from usuario_rol ur where ur.usuario_id = old.id and ur.rol_id = 'superadmin')
     and not public.es_superadmin() then
    raise exception 'Solo el superadmin puede modificar o desactivar a un superadmin';
  end if;
  return new;
end $$;
create trigger trg_proteger_usuario before update on public.usuario
  for each row execute function public.proteger_usuario_superadmin();

-- Quién delegó un permiso lo pone la base (antes lo mandaba el navegador y se podía falsear por la API)
create or replace function public.fijar_otorgado_por()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'authenticated'
     and (tg_op = 'INSERT' or new.otorgado_por is distinct from old.otorgado_por) then
    new.otorgado_por := auth.uid();
  end if;
  return new;
end $$;
create trigger trg_usuario_permiso_otorgado before insert or update on public.usuario_permiso
  for each row execute function public.fijar_otorgado_por();

revoke execute on function public.proteger_usuario_superadmin(), public.fijar_otorgado_por() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Períodos: quien aprueba o corrige toma un bloqueo compartido de la fila del período, así cerrar_periodo
--    (que la toma "for update" antes de sumar) espera a que terminen y su total no queda corto; y al revés, quien
--    llega mientras se cierra espera y ve el período ya CERRADO.
-- ---------------------------------------------------------------------
-- P-10: el mes de la operación (hora de Bogotá) o, si está cerrado, el siguiente abierto. Crea los que falten.
create or replace function public.periodo_para(p_fecha timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare v_mes date := date_trunc('month', p_fecha at time zone 'America/Bogota')::date; v_id text; v_estado text;
begin
  for i in 1..120 loop
    v_id := to_char(v_mes, 'YYYY-MM');
    insert into periodo (id, inicio, fin) values (v_id, v_mes, (v_mes + interval '1 month - 1 day')::date) on conflict do nothing;
    select estado into v_estado from periodo where id = v_id for share;
    if v_estado = 'ABIERTO' then return v_id; end if;
    v_mes := (v_mes + interval '1 month')::date;
  end loop;
  raise exception 'No hay período abierto';
end $$;

-- Período cerrado: solo quien puede cerrar períodos toca lo que hay adentro (P-11).
-- Deja de ser "stable": una función estable no puede tomar bloqueos (solo la llaman funciones que escriben).
create or replace function public.exigir_periodo_editable(p_periodo text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_estado text;
begin
  if p_periodo is null then return; end if;
  select estado into v_estado from periodo where id = p_periodo for share;
  if v_estado = 'CERRADO' and not tiene_permiso('CERRAR_PERIODO') then
    raise exception 'El período % está cerrado: solo quien puede cerrar períodos lo modifica', p_periodo;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. Corregir un aprobado: primero la utilidad (con el beneficio del par nuevo) y después el movimiento.
--    En el orden anterior, al cambiar la moneda de origen la ganancia del cliente (sincronizar_ganancia, que se
--    dispara con cada una de las dos actualizaciones) guardaba la moneda nueva con el beneficio VIEJO y luego lo
--    daba por congelado. Lo demás es idéntico a la 1600.
-- ---------------------------------------------------------------------
create or replace function public.corregir_uno(p_id uuid, p_cambios jsonb, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m movimiento; n movimiento; pc parametros_calculo; c resultado_calculo; mu movimiento_utilidad; f text;
  v_tadq numeric; v_valor numeric; v_ut numeric; v_periodo text;
begin
  select * into m from movimiento where id = p_id for update;
  if not found then raise exception 'El movimiento no existe'; end if;
  if m.estado <> 'APROBADO' then
    raise exception '% está %: solo se corrige un aprobado (lo demás se edita o se desbloquea)', m.codigo, lower(m.estado::text);
  end if;
  for f in select jsonb_object_keys(p_cambios) loop
    if f not in ('fecha', 'hora', 'modalidad', 'moneda_origen', 'moneda_destino', 'monto_origen', 'contraparte_id') then
      raise exception 'El campo % no se corrige aquí', f;
    end if;
  end loop;
  perform exigir_periodo_editable(m.periodo_id);

  -- Se validan los datos nuevos con las mismas reglas del registro (catálogos, fecha, monto)
  n := armar_movimiento(jsonb_build_object(
    'libro_id', m.libro_id, 'id_transaccion', m.id_transaccion, 'tipo', m.tipo,
    'fecha', to_char(m.fecha_operacion at time zone 'America/Bogota', 'YYYY-MM-DD'),
    'hora', to_char(m.fecha_operacion at time zone 'America/Bogota', 'HH24:MI:SS'),
    'modalidad', m.modalidad, 'recibido_en_id', m.recibido_en_id, 'empresa_id', m.empresa_id, 'contraparte_id', m.contraparte_id,
    'tercero', m.tercero, 'moneda_origen', m.moneda_origen, 'moneda_destino', m.moneda_destino, 'monto_origen', m.monto_origen,
    'descuento_tasa', false, 'observaciones', m.observaciones) || p_cambios);
  if (n.fecha_operacion, n.modalidad, n.moneda_origen, n.moneda_destino, n.monto_origen, n.contraparte_id)
     is not distinct from (m.fecha_operacion, m.modalidad, m.moneda_origen, m.moneda_destino, m.monto_origen, m.contraparte_id) then
    raise exception '%: no hay cambios', m.codigo;
  end if;
  n.recibido_en_id := m.recibido_en_id; n.descuento_tasa := m.descuento_tasa;

  pc := buscar_parametros(n);
  -- El saldo se revisa después, recalculando el bucket completo
  c := calcular_movimiento(m.tipo::text, n.monto_origen, n.moneda_origen, n.moneda_destino, pc.descuento_fijo,
                           pc.tasa_base, pc.beneficio, pc.puntos, m.descuento_tasa, 1e15);

  select * into mu from movimiento_utilidad where movimiento_id = m.id;
  case mu.marca_utilidad                                         -- un ajuste manual se conserva al corregir
    when 'UTILIDAD N/A' then v_tadq := c.monto_destino / c.monto_efectivo; v_valor := c.monto_destino; v_ut := 0;
    when 'PUNTOS RESTADOS' then v_tadq := c.tasa_adquisicion - coalesce(mu.puntos_restados, 0);
      v_valor := c.monto_efectivo * v_tadq; v_ut := v_valor - c.monto_destino;
    when 'CAMBIADA POR EL ADMIN' then v_tadq := mu.tasa_adquisicion; v_valor := c.monto_efectivo * v_tadq; v_ut := v_valor - c.monto_destino;
    else v_tadq := c.tasa_adquisicion; v_valor := c.valor_adquisicion; v_ut := c.utilidad;
  end case;

  -- Si cambia el mes y el período actual sigue abierto, se reasigna (P-10)
  v_periodo := m.periodo_id;
  if date_trunc('month', n.fecha_operacion at time zone 'America/Bogota') <> date_trunc('month', m.fecha_operacion at time zone 'America/Bogota')
     and coalesce((select estado from periodo where id = m.periodo_id), 'ABIERTO') = 'ABIERTO' then
    v_periodo := periodo_para(n.fecha_operacion);
  end if;

  -- Primero la utilidad: con el movimiento todavía sin cambiar, la ganancia del cliente no se mueve; al
  -- actualizar el movimiento ya encuentra el beneficio nuevo si cambió la moneda de origen.
  update movimiento_utilidad set tasa_utilidad_id = pc.utilidad_id, puntos_utilidad = pc.puntos, ajuste_id = pc.ajuste_id,
         beneficio = pc.beneficio, tasa_adquisicion = v_tadq, valor_adquisicion = v_valor, utilidad = v_ut
   where movimiento_id = m.id;
  update movimiento set fecha_operacion = n.fecha_operacion, modalidad = n.modalidad, moneda_origen = n.moneda_origen,
         moneda_destino = n.moneda_destino, monto_origen = n.monto_origen, contraparte_id = n.contraparte_id,
         monto_efectivo = c.monto_efectivo, tasa_cliente_id = pc.tasa_id, tasa_base = pc.tasa_base, tasa_aplicada = c.tasa_aplicada,
         monto_destino = c.monto_destino, entrada = c.entrada, salida = c.salida, periodo_id = v_periodo,
         corregido_motivo = btrim(p_motivo), corregido_por = auth.uid(), corregido_en = now(), actualizado_en = now()
   where id = m.id;

  return jsonb_build_object('id', m.id, 'codigo', m.codigo,
    'antes', jsonb_build_object('tasa', m.tasa_aplicada, 'monto_destino', m.monto_destino, 'moneda_destino', m.moneda_destino,
                                'modalidad', m.modalidad, 'contraparte_id', m.contraparte_id, 'utilidad', mu.utilidad),
    'despues', jsonb_build_object('tasa', c.tasa_aplicada, 'monto_destino', c.monto_destino, 'moneda_destino', n.moneda_destino,
                                  'modalidad', n.modalidad, 'contraparte_id', n.contraparte_id, 'utilidad', v_ut),
    'buckets', jsonb_build_array(jsonb_build_array(m.contraparte_id, m.moneda_destino, m.modalidad),
                                 jsonb_build_array(n.contraparte_id, n.moneda_destino, n.modalidad)));
end $$;
