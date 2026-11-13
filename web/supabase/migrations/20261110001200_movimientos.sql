-- =====================================================================
-- Sprint 4 — Registro y verificación de movimientos (docs/web/05 §Movimientos, doc 03 §1.1 y §2)
--   STW-22  Formulario de registro: código LN-/SB-/CN-… consecutivo sin carreras, validaciones.
--   STW-23  Bandeja del operador (solo lectura con RLS; la pantalla filtra y exporta).
--   STW-24  Verificar / desbloquear: verificado no lo edita el operador; desbloqueo con motivo, auditado.
--   STW-25  Detección de duplicados: mismo id de transacción = error (P-15); mismo cliente, moneda,
--           tipo, monto y día = aviso que hay que confirmar (equivale a duplicados.js).
-- Reglas: P-3 (descuento ×0,95 solo admin), P-8 (fecha + hora), P-15, P-21 (montos positivos),
--         T-3 (enviado = no editable), T-7 (fechas normalizadas), T-12 (selección múltiple).
-- El cálculo (tasa, utilidad, saldo) llega con aprobar_lote en el Sprint 5: aquí solo se registra.
-- La escritura es SOLO por funciones (security definer): no hay políticas de insert/update/delete.
-- =====================================================================

create type public.estado_mov as enum ('BORRADOR', 'ENVIADO_OPERADOR', 'VERIFICADO', 'APROBADO', 'RECHAZADO', 'ANULADO');

create table public.movimiento (
  id               uuid primary key default gen_random_uuid(),
  codigo           text not null unique,                         -- 'LN-0123', 'CN-0007' (siguiente_codigo)
  libro_id         uuid not null references public.libro,
  operador_id      uuid references public.libro,                 -- cliente grande → operador que lo atiende (P-1)
  id_transaccion   text not null check (btrim(id_transaccion) <> ''),
  tipo             public.tipo_mov not null,
  fecha_operacion  timestamptz not null,                         -- fecha + hora de Bogotá (P-8, T-7)
  modalidad        text not null references public.modalidad,
  recibido_en_id   text references public.recibido_en,
  empresa_id       text references public.empresa,
  contraparte_id   text not null references public.contraparte,
  tercero          text,
  moneda_origen    text not null references public.moneda (nombre) on update cascade,
  moneda_destino   text not null references public.moneda (nombre) on update cascade,
  monto_origen     numeric(20,2) not null check (monto_origen > 0),   -- P-21
  descuento_tasa   boolean not null default false,               -- ×0,95 (P-3): solo con APLICAR_DESCUENTO
  observaciones    text,
  estado           public.estado_mov not null default 'BORRADOR',
  duplicado_confirmado boolean not null default false,           -- se registró pese al aviso de STW-25
  verificado_por   uuid references public.usuario,
  verificado_en    timestamptz,
  desbloqueo_motivo text,                                        -- último desbloqueo (el historial está en auditoría)
  desbloqueado_por uuid references public.usuario,
  desbloqueado_en  timestamptz,
  anulado_motivo   text,
  anulado_por      uuid references public.usuario,
  anulado_en       timestamptz,
  -- migración (STW-49)
  codigo_origen    text,
  orden_origen     int,
  fuente_migracion text,
  creado_por       uuid references public.usuario default auth.uid(),
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  constraint anulado_con_motivo check (estado <> 'ANULADO' or btrim(coalesce(anulado_motivo, '')) <> ''),
  constraint verificado_con_fecha check (estado <> 'VERIFICADO' or verificado_en is not null)
);

-- P-15: el id de transacción es único en todo el sistema (sin importar espacios ni mayúsculas).
create unique index movimiento_id_transaccion on public.movimiento (lower(btrim(id_transaccion))) where estado <> 'ANULADO';
create index on public.movimiento (libro_id, estado, fecha_operacion desc);
create index on public.movimiento (contraparte_id, moneda_origen, monto_origen);
create index on public.movimiento (fecha_operacion desc);

-- comprobante_brasil.movimiento_id (migración 0900) apunta ahora a la tabla
alter table public.comprobante_brasil
  add constraint comprobante_movimiento_fk foreign key (movimiento_id) references public.movimiento (id);

create trigger aud_movimiento after insert or update or delete on public.movimiento
  for each row execute function public.auditar('id');

-- ---------------------------------------------------------------------
-- RLS: cada quien ve los movimientos de sus libros (y el operador, los de sus clientes grandes).
-- La administración (APROBAR_MOVIMIENTO) ve todos. Escritura solo por las funciones de abajo.
-- ---------------------------------------------------------------------
alter table public.movimiento enable row level security;
create policy movimiento_leer on public.movimiento for select to authenticated
  using (public.tiene_permiso('VER_MOVIMIENTOS') and public.puede_ver_libro(libro_id));
revoke insert, update, delete, truncate on public.movimiento from anon, authenticated;

-- ---------------------------------------------------------------------
-- ¿Puede registrar o editar en este libro? Miembro del libro con REGISTRAR_MOVIMIENTO,
-- o la administración (APROBAR_MOVIMIENTO) en cualquier libro de operador o cliente grande.
-- ---------------------------------------------------------------------
create or replace function public.puede_registrar_en_libro(p_libro uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from libro l where l.id = p_libro and l.activo and l.tipo in ('operador', 'cliente_grande'))
     and public.tiene_permiso('REGISTRAR_MOVIMIENTO', uid)
     and (public.tiene_permiso('APROBAR_MOVIMIENTO', uid)
          or exists (select 1 from libro_usuario lu where lu.libro_id = p_libro and lu.usuario_id = uid));
$$;

-- ---------------------------------------------------------------------
-- Valida los datos del formulario y devuelve la fila lista (sin código ni estado).
-- p: {libro_id, id_transaccion, tipo, fecha ('YYYY-MM-DD'), hora ('HH:MI'), modalidad, recibido_en_id,
--     empresa_id, contraparte_id, tercero, moneda_origen, moneda_destino, monto_origen, descuento_tasa, observaciones}
-- ---------------------------------------------------------------------
create or replace function public.armar_movimiento(p jsonb)
returns public.movimiento language plpgsql stable security definer set search_path = public as $$
declare
  m movimiento;
  l libro;
  v_texto text;
  v_monto numeric;
begin
  select * into l from libro where id = nullif(p ->> 'libro_id', '')::uuid;
  if not found or not l.activo or l.tipo not in ('operador', 'cliente_grande') then
    raise exception 'Elija un libro válido';
  end if;
  m.libro_id := l.id;
  m.operador_id := case when l.tipo = 'cliente_grande' then l.operador_id end;

  m.id_transaccion := btrim(coalesce(p ->> 'id_transaccion', ''));
  if m.id_transaccion = '' then raise exception 'El id de transacción es obligatorio'; end if;
  if length(m.id_transaccion) > 100 then raise exception 'El id de transacción es demasiado largo'; end if;

  v_texto := upper(btrim(coalesce(p ->> 'tipo', '')));
  if v_texto not in ('ENTRADA', 'SALIDA') then raise exception 'El tipo debe ser ENTRADA o SALIDA'; end if;
  m.tipo := v_texto::tipo_mov;

  -- P-8 / T-7: fecha y hora de la operación en hora de Bogotá, guardadas como un solo instante
  if coalesce(p ->> 'fecha', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'La fecha de la operación es obligatoria'; end if;
  if coalesce(p ->> 'hora', '') !~ '^\d{2}:\d{2}(:\d{2})?$' then raise exception 'La hora de la operación es obligatoria'; end if;
  begin
    m.fecha_operacion := ((p ->> 'fecha')::date + (p ->> 'hora')::time) at time zone 'America/Bogota';
  exception when others then
    raise exception 'Fecha u hora no válida: % %', p ->> 'fecha', p ->> 'hora';
  end;
  if m.fecha_operacion > now() + interval '1 day' then
    raise exception 'La fecha de la operación (%) está en el futuro', p ->> 'fecha';
  end if;
  if m.fecha_operacion < timestamptz '2020-01-01' then raise exception 'La fecha de la operación no es válida'; end if;

  m.modalidad := normalizar_texto(p ->> 'modalidad');
  if not exists (select 1 from modalidad where id = m.modalidad) then raise exception 'La modalidad debe ser EFECTIVO o TRANSFERENCIA'; end if;

  m.recibido_en_id := nullif(btrim(coalesce(p ->> 'recibido_en_id', '')), '');
  if m.recibido_en_id is not null and not exists (select 1 from recibido_en where id = m.recibido_en_id and activo) then
    raise exception '"Recibido en" no existe o está inactivo';
  end if;
  m.empresa_id := nullif(btrim(coalesce(p ->> 'empresa_id', '')), '');
  if m.empresa_id is not null and not exists (select 1 from empresa where id = m.empresa_id and activo) then
    raise exception 'La empresa no existe o está inactiva';
  end if;

  -- Un cliente grande siempre registra a su propio CT (doc 03 §6)
  if l.tipo = 'cliente_grande' then
    if l.contraparte_id is null then raise exception 'El libro % no tiene contraparte asignada (Catálogos)', l.nombre; end if;
    m.contraparte_id := l.contraparte_id;
  else
    m.contraparte_id := nullif(btrim(coalesce(p ->> 'contraparte_id', '')), '');
  end if;
  if m.contraparte_id is null then raise exception 'Elija el cliente o aliado'; end if;
  if not exists (select 1 from contraparte where id = m.contraparte_id and activo) then
    raise exception 'La contraparte % no existe o está inactiva', m.contraparte_id;
  end if;

  m.moneda_origen := normalizar_texto(p ->> 'moneda_origen');
  m.moneda_destino := normalizar_texto(p ->> 'moneda_destino');
  if not exists (select 1 from moneda where nombre = m.moneda_origen and activo) then raise exception 'Moneda de origen no válida'; end if;
  if not exists (select 1 from moneda where nombre = m.moneda_destino and activo) then raise exception 'Moneda de destino no válida'; end if;

  begin
    v_monto := (p ->> 'monto_origen')::numeric;   -- sin escala: numeric(20,2) redondearía antes de validar
  exception when others then
    raise exception 'El monto debe ser un número';
  end;
  if v_monto is null or v_monto <= 0 then raise exception 'El monto debe ser mayor que cero'; end if;
  if v_monto <> round(v_monto, 2) then raise exception 'El monto admite máximo 2 decimales'; end if;
  m.monto_origen := v_monto;

  m.descuento_tasa := coalesce((p ->> 'descuento_tasa')::boolean, false);
  if m.descuento_tasa and not tiene_permiso('APLICAR_DESCUENTO') then
    raise exception 'Solo la administración aplica el descuento ×0,95' using errcode = '42501';
  end if;

  m.tercero := nullif(btrim(coalesce(p ->> 'tercero', '')), '');
  m.observaciones := nullif(btrim(coalesce(p ->> 'observaciones', '')), '');
  return m;
end $$;
revoke execute on function public.armar_movimiento(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- STW-25: movimientos que se parecen (mismo cliente, moneda origen, tipo, monto y día en Bogotá).
-- Devuelve solo lo necesario para avisar (código y libro), aunque sea de otro libro: así un
-- operador se entera si el mismo pago ya lo registró el otro (hoy lo hace VALIDACION_IDS).
-- ---------------------------------------------------------------------
create or replace function public.posibles_duplicados(p jsonb, p_excluir uuid default null)
returns table (codigo text, libro text, fecha_operacion timestamptz, estado public.estado_mov, motivo text)
language plpgsql stable security definer set search_path = public as $$
declare m movimiento;
begin
  if not tiene_permiso('REGISTRAR_MOVIMIENTO') and not tiene_permiso('VERIFICAR_MOVIMIENTO') then
    raise exception 'No tiene permiso' using errcode = '42501';
  end if;
  m := armar_movimiento(p);
  return query
    select o.codigo, l.nombre, o.fecha_operacion, o.estado,
           case when lower(btrim(o.id_transaccion)) = lower(m.id_transaccion) then 'mismo id de transacción'
                else 'mismo cliente, moneda, tipo, monto y día' end
      from movimiento o join libro l on l.id = o.libro_id
     where o.estado <> 'ANULADO'
       and (p_excluir is null or o.id <> p_excluir)
       and (lower(btrim(o.id_transaccion)) = lower(m.id_transaccion)
            or (o.contraparte_id = m.contraparte_id and o.moneda_origen = m.moneda_origen and o.tipo = m.tipo
                and o.monto_origen = m.monto_origen
                and (o.fecha_operacion at time zone 'America/Bogota')::date = (m.fecha_operacion at time zone 'America/Bogota')::date))
     order by o.creado_en
     limit 10;
end $$;
revoke execute on function public.posibles_duplicados(jsonb, uuid) from public, anon;
grant execute on function public.posibles_duplicados(jsonb, uuid) to authenticated;

-- Avisos: id de transacción repetido = error; parecido = hay que confirmar (p_confirmar_duplicado).
create or replace function public.revisar_duplicados(p jsonb, p_excluir uuid, p_confirmar boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_lista text; v_mismo_id text;
begin
  select string_agg(d.codigo || ' (' || d.libro || ')', ', ') filter (where d.motivo = 'mismo id de transacción'),
         string_agg(d.codigo || ' (' || d.libro || ', ' || lower(d.estado::text) || ')', ' · ') filter (where d.motivo <> 'mismo id de transacción')
    into v_mismo_id, v_lista
    from posibles_duplicados(p, p_excluir) d;
  if v_mismo_id is not null then
    raise exception 'El id de transacción "%" ya está registrado en %', btrim(p ->> 'id_transaccion'), v_mismo_id using errcode = '23505';
  end if;
  if v_lista is not null and not coalesce(p_confirmar, false) then
    raise exception 'POSIBLE_DUPLICADO: %', v_lista;
  end if;
  return v_lista is not null;
end $$;
revoke execute on function public.revisar_duplicados(jsonb, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- STW-22: crear. El código sale del consecutivo del libro (UPDATE … RETURNING: sin carreras).
-- ---------------------------------------------------------------------
create or replace function public.crear_movimiento(p jsonb, p_confirmar_duplicado boolean default false)
returns public.movimiento language plpgsql security definer set search_path = public as $$
declare m movimiento; v_parecido boolean;
begin
  if not puede_registrar_en_libro(nullif(p ->> 'libro_id', '')::uuid) then
    raise exception 'No puede registrar movimientos en ese libro' using errcode = '42501';
  end if;
  m := armar_movimiento(p);
  -- Dos personas con el mismo id de transacción al mismo tiempo: el índice único decide
  v_parecido := revisar_duplicados(p, null, p_confirmar_duplicado);
  m.id := gen_random_uuid();
  m.codigo := siguiente_codigo(m.libro_id);
  m.estado := 'BORRADOR';
  m.duplicado_confirmado := v_parecido;
  m.creado_por := auth.uid();
  m.creado_en := now();
  m.actualizado_en := now();
  insert into movimiento select (m).*;
  return m;
exception when unique_violation then
  if sqlerrm like '%movimiento_id_transaccion%' then
    raise exception 'El id de transacción "%" ya está registrado', btrim(p ->> 'id_transaccion') using errcode = '23505';
  end if;
  raise;
end $$;

-- Editar: solo en BORRADOR (T-3: verificado o enviado no lo cambia el operador). El libro no cambia.
create or replace function public.editar_movimiento(p_id uuid, p jsonb, p_confirmar_duplicado boolean default false)
returns public.movimiento language plpgsql security definer set search_path = public as $$
declare o movimiento; m movimiento; v_parecido boolean;
begin
  select * into o from movimiento where id = p_id for update;
  if not found then raise exception 'El movimiento no existe'; end if;
  if not puede_registrar_en_libro(o.libro_id) then raise exception 'No puede editar movimientos de ese libro' using errcode = '42501'; end if;
  if o.estado <> 'BORRADOR' then
    raise exception '% está %: no se puede editar%', o.codigo, lower(o.estado::text),
      case when o.estado = 'VERIFICADO' then ' (pida que lo desbloqueen)' else '' end;
  end if;
  p := jsonb_set(p, '{libro_id}', to_jsonb(o.libro_id::text));
  m := armar_movimiento(p);
  v_parecido := revisar_duplicados(p, p_id, p_confirmar_duplicado or o.duplicado_confirmado);
  update movimiento set
    id_transaccion = m.id_transaccion, tipo = m.tipo, fecha_operacion = m.fecha_operacion, modalidad = m.modalidad,
    recibido_en_id = m.recibido_en_id, empresa_id = m.empresa_id, contraparte_id = m.contraparte_id, tercero = m.tercero,
    moneda_origen = m.moneda_origen, moneda_destino = m.moneda_destino, monto_origen = m.monto_origen,
    -- el descuento solo lo cambia quien tiene el permiso; si no, se conserva
    descuento_tasa = case when tiene_permiso('APLICAR_DESCUENTO') then m.descuento_tasa else o.descuento_tasa end,
    observaciones = m.observaciones, duplicado_confirmado = v_parecido, actualizado_en = now()
   where id = p_id returning * into m;
  return m;
exception when unique_violation then
  if sqlerrm like '%movimiento_id_transaccion%' then
    raise exception 'El id de transacción "%" ya está registrado', btrim(p ->> 'id_transaccion') using errcode = '23505';
  end if;
  raise;
end $$;

-- ---------------------------------------------------------------------
-- STW-24: verificar y desbloquear por lote (T-12). Como verificacion.js: salta lo que no aplica
-- y dice por qué. Devuelve {"hechos": [...códigos], "omitidos": [{"codigo","motivo"}]}.
-- ---------------------------------------------------------------------
create or replace function public.verificar_movimientos(p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare r movimiento; v_hechos text[] := '{}'; v_omitidos jsonb := '[]';
begin
  if not tiene_permiso('VERIFICAR_MOVIMIENTO') then raise exception 'No tiene permiso VERIFICAR_MOVIMIENTO' using errcode = '42501'; end if;
  for r in select * from movimiento where id = any(p_ids) order by codigo for update loop
    if not puede_ver_libro(r.libro_id) then
      v_omitidos := v_omitidos || jsonb_build_object('codigo', r.codigo, 'motivo', 'no es de sus libros');
    elsif r.estado not in ('BORRADOR', 'ENVIADO_OPERADOR') then
      v_omitidos := v_omitidos || jsonb_build_object('codigo', r.codigo, 'motivo', 'está ' || lower(r.estado::text));
    else
      update movimiento set estado = 'VERIFICADO', verificado_por = auth.uid(), verificado_en = now(), actualizado_en = now()
       where id = r.id;
      v_hechos := v_hechos || r.codigo;
    end if;
  end loop;
  return jsonb_build_object('hechos', to_jsonb(v_hechos), 'omitidos', v_omitidos);
end $$;

create or replace function public.desbloquear_movimientos(p_ids uuid[], p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r movimiento; v_hechos text[] := '{}'; v_omitidos jsonb := '[]';
begin
  if not tiene_permiso('VERIFICAR_MOVIMIENTO') then raise exception 'No tiene permiso VERIFICAR_MOVIMIENTO' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escriba el motivo del desbloqueo'; end if;
  for r in select * from movimiento where id = any(p_ids) order by codigo for update loop
    if not puede_ver_libro(r.libro_id) then
      v_omitidos := v_omitidos || jsonb_build_object('codigo', r.codigo, 'motivo', 'no es de sus libros');
    elsif r.estado <> 'VERIFICADO' then
      v_omitidos := v_omitidos || jsonb_build_object('codigo', r.codigo, 'motivo',
        case when r.estado = 'APROBADO' then 'ya está aprobado (solo corrección auditada)' else 'está ' || lower(r.estado::text) end);
    else
      update movimiento set estado = 'BORRADOR', verificado_por = null, verificado_en = null,
             desbloqueo_motivo = btrim(p_motivo), desbloqueado_por = auth.uid(), desbloqueado_en = now(), actualizado_en = now()
       where id = r.id;
      v_hechos := v_hechos || r.codigo;
    end if;
  end loop;
  return jsonb_build_object('hechos', to_jsonb(v_hechos), 'omitidos', v_omitidos);
end $$;

-- Descartar un borrador mal hecho: nada se borra, queda ANULADO con motivo. (Anular uno aprobado,
-- con recálculo de saldos, es STW-36.) Libera el id de transacción para registrarlo bien.
create or replace function public.anular_borrador(p_id uuid, p_motivo text)
returns public.movimiento language plpgsql security definer set search_path = public as $$
declare o movimiento;
begin
  select * into o from movimiento where id = p_id for update;
  if not found then raise exception 'El movimiento no existe'; end if;
  if not puede_registrar_en_libro(o.libro_id) then raise exception 'No puede anular movimientos de ese libro' using errcode = '42501'; end if;
  if o.estado <> 'BORRADOR' then raise exception 'Solo se anula un borrador; % está %', o.codigo, lower(o.estado::text); end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escriba el motivo de la anulación'; end if;
  update movimiento set estado = 'ANULADO', anulado_motivo = btrim(p_motivo), anulado_por = auth.uid(), anulado_en = now(), actualizado_en = now()
   where id = p_id returning * into o;
  return o;
end $$;

revoke execute on function public.crear_movimiento(jsonb, boolean), public.editar_movimiento(uuid, jsonb, boolean),
  public.verificar_movimientos(uuid[]), public.desbloquear_movimientos(uuid[], text), public.anular_borrador(uuid, text),
  public.puede_registrar_en_libro(uuid, uuid) from public, anon;
grant execute on function public.crear_movimiento(jsonb, boolean), public.editar_movimiento(uuid, jsonb, boolean),
  public.verificar_movimientos(uuid[]), public.desbloquear_movimientos(uuid[], text), public.anular_borrador(uuid, text),
  public.puede_registrar_en_libro(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- STW-25 en la bandeja: pares de movimientos visibles que se parecen (para la marca ⚠).
-- security_invoker: cada usuario solo ve los pares dentro de lo que ya puede ver.
-- ---------------------------------------------------------------------
create view public.movimiento_parecido with (security_invoker = true) as
select m.id, o.id as otro_id, o.codigo as otro_codigo
  from public.movimiento m
  join public.movimiento o
    on o.id <> m.id and o.contraparte_id = m.contraparte_id and o.moneda_origen = m.moneda_origen
   and o.tipo = m.tipo and o.monto_origen = m.monto_origen
   and (o.fecha_operacion at time zone 'America/Bogota')::date = (m.fecha_operacion at time zone 'America/Bogota')::date
 where m.estado <> 'ANULADO' and o.estado <> 'ANULADO';

-- Comnorte por estado de lo que ve el usuario (tarjetas de Inicio)
create view public.movimiento_conteo with (security_invoker = true) as
select estado, count(*)::int as total from public.movimiento group by estado;
