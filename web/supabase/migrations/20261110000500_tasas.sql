-- =====================================================================
-- STW-13: ajustes por cliente (beneficio) con vigencia      (P-4, P-5, P-36)
-- STW-14: tasas cliente con vigencia y estado               (P-8, T-1, doc 02 §7.1)
-- STW-15: tabla de utilidad (puntos) con vigencia y estado  (P-6, P-23, T-1)
-- No se crea TASA_EMPRESA / tasa adquisitiva (P-23, T-1).
-- Depende de: 0100_seguridad, 0200_auditoria, 0400_catalogos.
-- =====================================================================
-- Vigencias: tstzrange cerrado en los dos extremos '[desde, hasta]', igual que el CORE
-- (E <= fecha_hora <= F). La fecha que elige la tasa es fecha + hora de la operación (P-8).

create type public.estado_tasa as enum ('MODIFICABLE', 'CERRADO');

-- Vigencia válida: los dos extremos incluidos y desde < hasta (doc 02 §7.1 "vigencia inválida")
create or replace function public.vigencia_valida(v tstzrange)
returns boolean language sql immutable as $$
  select v is not null and not isempty(v) and lower_inc(v) and upper_inc(v)
     and lower(v) is not null and upper(v) is not null and lower(v) < upper(v);
$$;

-- Constructor para la app: vigencia(desde, hasta) = '[desde, hasta]'
create or replace function public.vigencia(p_desde timestamptz, p_hasta timestamptz)
returns tstzrange language plpgsql immutable as $$
begin
  if p_desde is null or p_hasta is null or p_desde >= p_hasta then
    raise exception 'Vigencia inválida: "desde" (%) debe ser menor que "hasta" (%)', p_desde, p_hasta
      using errcode = 'check_violation';
  end if;
  return tstzrange(p_desde, p_hasta, '[]');
end $$;

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
create sequence public.tasa_cliente_seq;
create table public.tasa_cliente (
  id             text primary key default 'TB-' || lpad(nextval('public.tasa_cliente_seq')::text, 6, '0'),
  moneda_origen  text not null references public.moneda (nombre) on update cascade,
  moneda_destino text not null references public.moneda (nombre) on update cascade,
  modalidad      text not null references public.modalidad,
  vigencia       tstzrange not null check (public.vigencia_valida(vigencia)),
  valor          numeric(20,6) not null check (valor > 0),
  estado         public.estado_tasa not null default 'MODIFICABLE',
  creado_por     uuid references public.usuario default auth.uid(),
  creado_en      timestamptz not null default now(),
  cerrado_por    uuid references public.usuario,
  cerrado_en     timestamptz,
  -- Solo las tasas publicadas (CERRADO) no pueden solaparse; los borradores sí (como en el CORE)
  constraint tasa_cliente_sin_solape exclude using gist (
    moneda_origen with =, moneda_destino with =, modalidad with =, vigencia with &&
  ) where (estado = 'CERRADO')
);

create sequence public.tasa_utilidad_seq;
create table public.tasa_utilidad (                 -- hoja UTILIDAD del CORE
  id                   text primary key default 'UT-' || lpad(nextval('public.tasa_utilidad_seq')::text, 6, '0'),
  moneda_origen        text not null references public.moneda (nombre) on update cascade,
  moneda_destino       text not null references public.moneda (nombre) on update cascade,
  puntos_efectivo      numeric(20,6) not null,     -- modalidad EFECTIVO
  puntos_transferencia numeric(20,6) not null,     -- modalidad TRANSFERENCIA
  vigencia             tstzrange not null check (public.vigencia_valida(vigencia)),
  estado               public.estado_tasa not null default 'MODIFICABLE',
  creado_por           uuid references public.usuario default auth.uid(),
  creado_en            timestamptz not null default now(),
  cerrado_por          uuid references public.usuario,
  cerrado_en           timestamptz,
  constraint tasa_utilidad_sin_solape exclude using gist (
    moneda_origen with =, moneda_destino with =, vigencia with &&
  ) where (estado = 'CERRADO')
);

create sequence public.ajuste_cliente_seq;
create table public.ajuste_cliente (                -- AJUSTES_CLIENTES del CORE
  id             text primary key default 'AJ-' || lpad(nextval('public.ajuste_cliente_seq')::text, 6, '0'),
  contraparte_id text not null references public.contraparte,
  moneda_origen  text not null references public.moneda (nombre) on update cascade,
  moneda_destino text not null references public.moneda (nombre) on update cascade,
  beneficio      numeric(20,6) not null,          -- pesos por unidad de moneda origen (P-36)
  activo         boolean not null default true,
  vigencia       tstzrange not null default tstzrange(now(), 'infinity', '[]')
                 check (public.vigencia_valida(vigencia)),   -- históricos migran desde -infinity
  creado_por     uuid references public.usuario default auth.uid(),
  creado_en      timestamptz not null default now(),
  -- El Motor no filtra por modalidad (doc 02 §3.5): la llave es cliente + par de monedas
  constraint ajuste_cliente_sin_solape exclude using gist (
    contraparte_id with =, moneda_origen with =, moneda_destino with =, vigencia with &&
  ) where (activo)
);

create index on public.tasa_cliente  (moneda_origen, moneda_destino, modalidad) where estado = 'CERRADO';
create index on public.tasa_utilidad (moneda_origen, moneda_destino) where estado = 'CERRADO';
create index on public.ajuste_cliente (contraparte_id, moneda_origen, moneda_destino) where activo;

-- ---------------------------------------------------------------------
-- Reglas de edición
-- ---------------------------------------------------------------------
-- Tasa cliente y utilidad (doc 02 §7.1):
--  * MODIFICABLE = borrador: se edita libremente y se puede borrar.
--  * Publicar (CERRADO) solo con cerrar_tasa() / cerrar_utilidad(); nunca vuelve a MODIFICABLE.
--  * CERRADO: lo único editable es vigencia_hasta. Acortarla hacia el pasado (cambia qué tasa
--    tenía una operación ya hecha) solo lo puede hacer el superadmin.
--  * Tasa cliente con origen = destino → valor 1.
create or replace function public.proteger_tasa()
returns trigger language plpgsql set search_path = public as $$
begin
  new.moneda_origen  := normalizar_texto(new.moneda_origen);
  new.moneda_destino := normalizar_texto(new.moneda_destino);
  if tg_table_name = 'tasa_cliente' then
    new.modalidad := normalizar_texto(new.modalidad);
    if new.moneda_origen = new.moneda_destino then
      new.valor := 1;
    end if;
  end if;

  if tg_op = 'INSERT' then
    -- La app crea borradores; las tasas ya publicadas solo entran por la migración (sin usuario de la app)
    if new.estado = 'CERRADO' and current_user in ('authenticated', 'anon') then
      raise exception 'Una tasa nueva se crea como MODIFICABLE y se publica con "cerrar"';
    end if;
    return new;
  end if;

  if old.estado = 'CERRADO' then
    if new.estado <> 'CERRADO' then
      raise exception 'La tasa % ya está cerrada y no puede volver a MODIFICABLE', old.id;
    end if;
    if (to_jsonb(new) - 'vigencia') <> (to_jsonb(old) - 'vigencia')
       or lower(new.vigencia) <> lower(old.vigencia) then
      raise exception 'La tasa % está cerrada: solo se puede cambiar la vigencia hasta', old.id;
    end if;
    if upper(new.vigencia) < upper(old.vigencia) and upper(new.vigencia) < now() and not es_superadmin() then
      raise exception 'Solo el superadmin puede acortar al pasado la vigencia de una tasa cerrada (afecta operaciones ya hechas)';
    end if;
  elsif new.estado = 'CERRADO' and current_user in ('authenticated', 'anon') then
    raise exception 'Para publicar una tasa use "cerrar" (valida solapamientos)';
  end if;
  return new;
end $$;

create or replace function public.proteger_borrado_tasa()
returns trigger language plpgsql as $$
begin
  if old.estado = 'CERRADO' then
    raise exception 'La tasa % está cerrada y no se puede borrar', old.id;
  end if;
  return old;
end $$;

-- Ajuste por cliente (P-5: misma regla + vigencia, sin afectar históricos):
--  * Mientras no ha empezado (desde > ahora) se edita libremente.
--  * Ya vigente o pasado: no cambia beneficio, cliente, monedas ni desde, ni se desactiva;
--    solo se cierra moviendo "hasta" (no al pasado, salvo superadmin). Para cambiar el
--    beneficio se usa cambiar_beneficio(), que cierra el actual y crea uno nuevo.
create or replace function public.proteger_ajuste()
returns trigger language plpgsql set search_path = public as $$
begin
  new.moneda_origen  := normalizar_texto(new.moneda_origen);
  new.moneda_destino := normalizar_texto(new.moneda_destino);
  if tg_op = 'INSERT' or lower(old.vigencia) > now() then
    return new;
  end if;
  if new.activo is distinct from old.activo then
    raise exception 'El ajuste % ya rige: en vez de desactivarlo, cierre su vigencia', old.id;
  end if;
  if (to_jsonb(new) - 'vigencia') <> (to_jsonb(old) - 'vigencia')
     or lower(new.vigencia) <> lower(old.vigencia) then
    raise exception 'El ajuste % ya rige: solo se puede cambiar la vigencia hasta (use cambiar_beneficio)', old.id;
  end if;
  if upper(new.vigencia) < upper(old.vigencia) and upper(new.vigencia) < now() and not es_superadmin() then
    raise exception 'Solo el superadmin puede cerrar al pasado un ajuste (afecta operaciones ya hechas)';
  end if;
  return new;
end $$;

create trigger proteger_tasa_cliente  before insert or update on public.tasa_cliente  for each row execute function public.proteger_tasa();
create trigger proteger_tasa_utilidad before insert or update on public.tasa_utilidad for each row execute function public.proteger_tasa();
create trigger borrar_tasa_cliente    before delete on public.tasa_cliente  for each row execute function public.proteger_borrado_tasa();
create trigger borrar_tasa_utilidad   before delete on public.tasa_utilidad for each row execute function public.proteger_borrado_tasa();
create trigger proteger_ajuste_cliente before insert or update on public.ajuste_cliente for each row execute function public.proteger_ajuste();

create trigger aud_tasa_cliente   after insert or update or delete on public.tasa_cliente   for each row execute function public.auditar('id');
create trigger aud_tasa_utilidad  after insert or update or delete on public.tasa_utilidad  for each row execute function public.auditar('id');
create trigger aud_ajuste_cliente after insert or update or delete on public.ajuste_cliente for each row execute function public.auditar('id');

-- ---------------------------------------------------------------------
-- Publicar (cerrar) una tasa o utilidad
-- p_recortar_anterior: si la nueva empieza dentro de una publicada del mismo par, recorta la
-- anterior hasta (desde_nueva − 1 µs). Es el "uso típico" del CORE (doc 02 §7.1 punto 4).
-- El CORE la recortaba a −1 segundo y quedaba un hueco de 1 s sin tasa; aquí no queda hueco.
-- ---------------------------------------------------------------------
create or replace function public.cerrar_tasa(p_id text, p_recortar_anterior boolean default false)
returns public.tasa_cliente language plpgsql security definer set search_path = public as $$
declare t tasa_cliente; v_otra tasa_cliente;
begin
  if not tiene_permiso('GESTIONAR_TASAS') then
    raise exception 'No tiene permiso GESTIONAR_TASAS' using errcode = '42501';
  end if;
  select * into t from tasa_cliente where id = p_id for update;
  if not found then raise exception 'La tasa % no existe', p_id; end if;
  if t.estado = 'CERRADO' then raise exception 'La tasa % ya está cerrada', p_id; end if;

  if p_recortar_anterior then
    select * into v_otra from tasa_cliente
     where estado = 'CERRADO' and id <> t.id and moneda_origen = t.moneda_origen
       and moneda_destino = t.moneda_destino and modalidad = t.modalidad
       and vigencia @> lower(t.vigencia) and lower(vigencia) < lower(t.vigencia)
     for update;
    if found then
      update tasa_cliente set vigencia = tstzrange(lower(vigencia), lower(t.vigencia) - interval '1 microsecond', '[]')
       where id = v_otra.id;
    end if;
  end if;

  select * into v_otra from tasa_cliente
   where estado = 'CERRADO' and id <> t.id and moneda_origen = t.moneda_origen
     and moneda_destino = t.moneda_destino and modalidad = t.modalidad and vigencia && t.vigencia
   limit 1;
  if found then
    raise exception 'La tasa % se solapa con la tasa cerrada % (% a %)', p_id, v_otra.id,
      lower(v_otra.vigencia), upper(v_otra.vigencia);
  end if;

  update tasa_cliente set estado = 'CERRADO', cerrado_por = auth.uid(), cerrado_en = now()
   where id = p_id returning * into t;
  return t;
end $$;

create or replace function public.cerrar_utilidad(p_id text, p_recortar_anterior boolean default false)
returns public.tasa_utilidad language plpgsql security definer set search_path = public as $$
declare t tasa_utilidad; v_otra tasa_utilidad;
begin
  if not tiene_permiso('GESTIONAR_TASAS') then
    raise exception 'No tiene permiso GESTIONAR_TASAS' using errcode = '42501';
  end if;
  select * into t from tasa_utilidad where id = p_id for update;
  if not found then raise exception 'La utilidad % no existe', p_id; end if;
  if t.estado = 'CERRADO' then raise exception 'La utilidad % ya está cerrada', p_id; end if;

  if p_recortar_anterior then
    select * into v_otra from tasa_utilidad
     where estado = 'CERRADO' and id <> t.id and moneda_origen = t.moneda_origen
       and moneda_destino = t.moneda_destino
       and vigencia @> lower(t.vigencia) and lower(vigencia) < lower(t.vigencia)
     for update;
    if found then
      update tasa_utilidad set vigencia = tstzrange(lower(vigencia), lower(t.vigencia) - interval '1 microsecond', '[]')
       where id = v_otra.id;
    end if;
  end if;

  select * into v_otra from tasa_utilidad
   where estado = 'CERRADO' and id <> t.id and moneda_origen = t.moneda_origen
     and moneda_destino = t.moneda_destino and vigencia && t.vigencia
   limit 1;
  if found then
    raise exception 'La utilidad % se solapa con la utilidad cerrada % (% a %)', p_id, v_otra.id,
      lower(v_otra.vigencia), upper(v_otra.vigencia);
  end if;

  update tasa_utilidad set estado = 'CERRADO', cerrado_por = auth.uid(), cerrado_en = now()
   where id = p_id returning * into t;
  return t;
end $$;

-- ---------------------------------------------------------------------
-- STW-13: cambiar el beneficio de un cliente sin tocar el histórico.
-- Cierra el ajuste vigente en p_desde (hasta = p_desde − 1 µs) y crea el nuevo desde p_desde.
-- ---------------------------------------------------------------------
create or replace function public.cambiar_beneficio(
  p_contraparte text, p_moneda_origen text, p_moneda_destino text,
  p_beneficio numeric, p_desde timestamptz default now()
) returns public.ajuste_cliente language plpgsql security definer set search_path = public as $$
declare v_actual ajuste_cliente; v_nuevo ajuste_cliente; v_hasta timestamptz := 'infinity';
begin
  if not tiene_permiso('GESTIONAR_CATALOGOS') then
    raise exception 'No tiene permiso GESTIONAR_CATALOGOS' using errcode = '42501';
  end if;
  select * into v_actual from ajuste_cliente
   where activo and contraparte_id = p_contraparte
     and moneda_origen = normalizar_texto(p_moneda_origen) and moneda_destino = normalizar_texto(p_moneda_destino)
     and vigencia @> p_desde
   for update;
  if found then
    v_hasta := upper(v_actual.vigencia);
    if lower(v_actual.vigencia) >= p_desde then
      raise exception 'El ajuste % empieza en %, no se puede reemplazar desde %', v_actual.id, lower(v_actual.vigencia), p_desde;
    end if;
    update ajuste_cliente set vigencia = tstzrange(lower(vigencia), p_desde - interval '1 microsecond', '[]')
     where id = v_actual.id;
  end if;
  insert into ajuste_cliente (contraparte_id, moneda_origen, moneda_destino, beneficio, vigencia)
  values (p_contraparte, p_moneda_origen, p_moneda_destino, p_beneficio, tstzrange(p_desde, v_hasta, '[]'))
  returning * into v_nuevo;
  return v_nuevo;
end $$;

-- ---------------------------------------------------------------------
-- Consultas que usará el Motor (calcular_movimiento / aprobar_lote, STW-28/29)
-- ---------------------------------------------------------------------
create or replace function public.tasa_vigente(p_origen text, p_destino text, p_modalidad text, p_fecha timestamptz)
returns public.tasa_cliente language sql stable set search_path = public as $$
  select * from tasa_cliente
   where estado = 'CERRADO' and moneda_origen = normalizar_texto(p_origen)
     and moneda_destino = normalizar_texto(p_destino) and modalidad = normalizar_texto(p_modalidad)
     and vigencia @> p_fecha;
$$;

-- Puntos según modalidad: EFECTIVO → puntos_efectivo; cualquier otra → puntos_transferencia (doc 02 §3.4)
create or replace function public.utilidad_vigente(p_origen text, p_destino text, p_fecha timestamptz)
returns public.tasa_utilidad language sql stable set search_path = public as $$
  select * from tasa_utilidad
   where estado = 'CERRADO' and moneda_origen = normalizar_texto(p_origen)
     and moneda_destino = normalizar_texto(p_destino) and vigencia @> p_fecha;
$$;

-- Beneficio: llave cliente + par de monedas, sin modalidad; si no hay, 0 (doc 02 §3.5)
create or replace function public.beneficio_vigente(p_contraparte text, p_origen text, p_destino text, p_fecha timestamptz)
returns public.ajuste_cliente language sql stable set search_path = public as $$
  select * from ajuste_cliente
   where activo and contraparte_id = p_contraparte and moneda_origen = normalizar_texto(p_origen)
     and moneda_destino = normalizar_texto(p_destino) and vigencia @> p_fecha;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.tasa_cliente   enable row level security;
alter table public.tasa_utilidad  enable row level security;
alter table public.ajuste_cliente enable row level security;

-- Tasa cliente: la ve todo usuario autenticado (operadores y clientes la necesitan)
create policy tasa_cliente_leer   on public.tasa_cliente for select to authenticated using (true);
create policy tasa_cliente_crear  on public.tasa_cliente for insert to authenticated with check (public.tiene_permiso('GESTIONAR_TASAS'));
create policy tasa_cliente_editar on public.tasa_cliente for update to authenticated
  using (public.tiene_permiso('GESTIONAR_TASAS')) with check (public.tiene_permiso('GESTIONAR_TASAS'));
create policy tasa_cliente_borrar on public.tasa_cliente for delete to authenticated
  using (public.tiene_permiso('GESTIONAR_TASAS') and estado = 'MODIFICABLE');

-- Utilidad = margen de la casa: solo quien gestiona tasas o aprueba (no operadores ni clientes)
create policy tasa_utilidad_leer   on public.tasa_utilidad for select to authenticated
  using (public.tiene_permiso('GESTIONAR_TASAS') or public.tiene_permiso('APROBAR_MOVIMIENTO'));
create policy tasa_utilidad_crear  on public.tasa_utilidad for insert to authenticated with check (public.tiene_permiso('GESTIONAR_TASAS'));
create policy tasa_utilidad_editar on public.tasa_utilidad for update to authenticated
  using (public.tiene_permiso('GESTIONAR_TASAS')) with check (public.tiene_permiso('GESTIONAR_TASAS'));
create policy tasa_utilidad_borrar on public.tasa_utilidad for delete to authenticated
  using (public.tiene_permiso('GESTIONAR_TASAS') and estado = 'MODIFICABLE');

-- Beneficio por cliente: administración (gestiona catálogos o aprueba). Nunca se borra.
create policy ajuste_cliente_leer   on public.ajuste_cliente for select to authenticated
  using (public.tiene_permiso('GESTIONAR_CATALOGOS') or public.tiene_permiso('APROBAR_MOVIMIENTO'));
create policy ajuste_cliente_crear  on public.ajuste_cliente for insert to authenticated with check (public.tiene_permiso('GESTIONAR_CATALOGOS'));
create policy ajuste_cliente_editar on public.ajuste_cliente for update to authenticated
  using (public.tiene_permiso('GESTIONAR_CATALOGOS')) with check (public.tiene_permiso('GESTIONAR_CATALOGOS'));

revoke execute on function public.cerrar_tasa(text, boolean), public.cerrar_utilidad(text, boolean),
  public.cambiar_beneficio(text, text, text, numeric, timestamptz) from anon;
