-- =====================================================================
-- Sprint 5-6:
--   STW-31  Rechazo con motivo, visible para operador y cliente (P-13).
--   STW-61  Períodos automáticos: se crean solos cada mes y se asignan al aprobar (P-10, P-34).
--   STW-36  Anular un movimiento aprobado sin borrarlo, con recálculo en tiempo real de los saldos
--           posteriores del bucket (P-14, T-8). Si algún saldo queda negativo, exige confirmación (P-33).
--   STW-39  Estado de cuenta: solo lectura sobre movimiento (sin cambios de esquema).
--   STW-55  Registro de gastos con consecutivo G- propio y período por fecha (P-27, P-30, T-14).
-- =====================================================================

-- ---------------------------------------------------------------------
-- STW-31: rechazo. Un rechazado deja de contar, como un anulado: libera el id de transacción
-- (así se puede registrar bien) y no cuenta como posible duplicado.
-- ---------------------------------------------------------------------
alter table public.movimiento
  add column rechazado_motivo text,
  add column rechazado_por    uuid references public.usuario,
  add column rechazado_en     timestamptz,
  add constraint rechazado_con_motivo check (estado <> 'RECHAZADO' or btrim(coalesce(rechazado_motivo, '')) <> '');

drop index public.movimiento_id_transaccion;
create unique index movimiento_id_transaccion on public.movimiento (lower(btrim(id_transaccion)))
  where estado not in ('ANULADO', 'RECHAZADO');

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
     where o.estado not in ('ANULADO', 'RECHAZADO')
       and (p_excluir is null or o.id <> p_excluir)
       and (lower(btrim(o.id_transaccion)) = lower(m.id_transaccion)
            or (o.contraparte_id = m.contraparte_id and o.moneda_origen = m.moneda_origen and o.tipo = m.tipo
                and o.monto_origen = m.monto_origen
                and (o.fecha_operacion at time zone 'America/Bogota')::date = (m.fecha_operacion at time zone 'America/Bogota')::date))
     order by o.creado_en
     limit 10;
end $$;

create or replace view public.movimiento_parecido with (security_invoker = true) as
select m.id, o.id as otro_id, o.codigo as otro_codigo
  from public.movimiento m
  join public.movimiento o
    on o.id <> m.id and o.contraparte_id = m.contraparte_id and o.moneda_origen = m.moneda_origen
   and o.tipo = m.tipo and o.monto_origen = m.monto_origen
   and (o.fecha_operacion at time zone 'America/Bogota')::date = (m.fecha_operacion at time zone 'America/Bogota')::date
 where m.estado not in ('ANULADO', 'RECHAZADO') and o.estado not in ('ANULADO', 'RECHAZADO');

-- P-13: rechaza la administración (cualquier libro) o el operador, pero solo lo que le llega de SUS
-- clientes grandes: lo propio del operador se anula, no se rechaza. Lo aprobado no se rechaza (se anula).
create or replace function public.rechazar_movimientos(p_ids uuid[], p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r movimiento; l libro; v_hechos text[] := '{}'; v_omitidos jsonb := '[]'; v_admin boolean := tiene_permiso('APROBAR_MOVIMIENTO');
begin
  if not tiene_permiso('RECHAZAR_MOVIMIENTO') then raise exception 'No tiene permiso RECHAZAR_MOVIMIENTO' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escriba el motivo del rechazo (lo verán el operador y el cliente)'; end if;
  for r in select * from movimiento where id = any(p_ids) order by codigo for update loop
    select * into l from libro where id = r.libro_id;
    if not puede_ver_libro(r.libro_id) then
      v_omitidos := v_omitidos || jsonb_build_object('codigo', r.codigo, 'motivo', 'no es de sus libros');
    elsif not v_admin and l.tipo <> 'cliente_grande' then
      v_omitidos := v_omitidos || jsonb_build_object('codigo', r.codigo, 'motivo', 'es de un libro de operador: se anula, no se rechaza');
    elsif r.estado not in ('BORRADOR', 'ENVIADO_OPERADOR', 'VERIFICADO') then
      v_omitidos := v_omitidos || jsonb_build_object('codigo', r.codigo, 'motivo',
        case when r.estado = 'APROBADO' then 'ya está aprobado (se anula, no se rechaza)' else 'está ' || lower(r.estado::text) end);
    else
      update movimiento set estado = 'RECHAZADO', rechazado_motivo = btrim(p_motivo), rechazado_por = auth.uid(),
             rechazado_en = now(), actualizado_en = now()
       where id = r.id;
      v_hechos := v_hechos || r.codigo;
    end if;
  end loop;
  return jsonb_build_object('hechos', to_jsonb(v_hechos), 'omitidos', v_omitidos);
end $$;
revoke execute on function public.rechazar_movimientos(uuid[], text) from public, anon;
grant execute on function public.rechazar_movimientos(uuid[], text) to authenticated;

-- ---------------------------------------------------------------------
-- STW-61: períodos (un solo período: P-12). Se crean solos; cerrar es manual (STW-37).
-- ---------------------------------------------------------------------
create table public.periodo (
  id          text primary key check (id ~ '^\d{4}-(0[1-9]|1[0-2])$'),   -- '2026-11'
  inicio      date not null,
  fin         date not null,
  estado      text not null default 'ABIERTO' check (estado in ('ABIERTO', 'CERRADO')),
  cerrado_en  timestamptz,
  cerrado_por uuid references public.usuario,
  creado_en   timestamptz not null default now()
);
alter table public.periodo enable row level security;
create policy periodo_leer on public.periodo for select to authenticated using (true);
revoke insert, update, delete, truncate on public.periodo from anon, authenticated;
create trigger aud_periodo after insert or update or delete on public.periodo for each row execute function public.auditar('id');

-- P-10: el mes de la operación (hora de Bogotá) o, si está cerrado, el siguiente abierto. Crea los que falten.
create or replace function public.periodo_para(p_fecha timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare v_mes date := date_trunc('month', p_fecha at time zone 'America/Bogota')::date; v_id text; v_estado text;
begin
  for i in 1..120 loop
    v_id := to_char(v_mes, 'YYYY-MM');
    insert into periodo (id, inicio, fin) values (v_id, v_mes, (v_mes + interval '1 month - 1 day')::date) on conflict do nothing;
    select estado into v_estado from periodo where id = v_id;
    if v_estado = 'ABIERTO' then return v_id; end if;
    v_mes := (v_mes + interval '1 month')::date;
  end loop;
  raise exception 'No hay período abierto';
end $$;
revoke execute on function public.periodo_para(timestamptz) from public, anon, authenticated;

alter table public.movimiento add column periodo_id text references public.periodo;
create index on public.movimiento (periodo_id) where estado = 'APROBADO';

-- Se asigna en el momento de aprobar (sin tocar aprobar_movimientos): trigger sobre el cambio de estado
create or replace function public.asignar_periodo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'APROBADO' and old.estado is distinct from 'APROBADO' and new.periodo_id is null then
    new.periodo_id := periodo_para(new.fecha_operacion);
  end if;
  return new;
end $$;
create trigger asignar_periodo before update of estado on public.movimiento
  for each row execute function public.asignar_periodo();

-- Lo ya aprobado (solo existe en entornos de prueba) recibe su período
update public.movimiento set periodo_id = public.periodo_para(fecha_operacion) where estado = 'APROBADO' and periodo_id is null;

-- ---------------------------------------------------------------------
-- STW-36: recálculo de un bucket en orden de aprobación (secuencia_bucket), sin los anulados.
-- Devuelve el saldo final y el primer movimiento que queda en negativo (si hay).
-- Es la base de "recalcular bucket" (STW-33) y de las correcciones (STW-35).
-- ---------------------------------------------------------------------
create or replace function public.recalcular_saldos_bucket(p_ct text, p_moneda text, p_modalidad text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_saldo numeric(20,2) := 0; v_neg text; v_neg_saldo numeric; v_n int := 0;
begin
  perform 1 from saldo_bucket where contraparte_id = p_ct and moneda = p_moneda and modalidad = p_modalidad for update;
  for r in select id, codigo, entrada, salida, saldo_post from movimiento
            where estado = 'APROBADO' and contraparte_id = p_ct and moneda_destino = p_moneda and modalidad = p_modalidad
            order by secuencia_bucket, aprobado_en for update loop
    if v_saldo + r.entrada - r.salida is distinct from r.saldo_post then
      update movimiento set saldo_anterior = v_saldo, saldo_post = v_saldo + r.entrada - r.salida, actualizado_en = now() where id = r.id;
      v_n := v_n + 1;
    end if;
    v_saldo := v_saldo + r.entrada - r.salida;
    if v_saldo < 0 and v_neg is null then v_neg := r.codigo; v_neg_saldo := v_saldo; end if;
  end loop;
  update saldo_bucket set saldo = v_saldo, actualizado_en = now()
   where contraparte_id = p_ct and moneda = p_moneda and modalidad = p_modalidad;
  return jsonb_build_object('saldo', v_saldo, 'actualizados', v_n, 'primer_negativo', v_neg, 'saldo_negativo', v_neg_saldo);
end $$;
revoke execute on function public.recalcular_saldos_bucket(text, text, text) from public, anon, authenticated;

-- Anular (permiso ANULAR_MOVIMIENTO). Aprobado: recalcula el bucket; si algún saldo queda negativo
-- hay que confirmarlo (P-33). Período cerrado: solo con permiso CERRAR_PERIODO (P-11).
create or replace function public.anular_movimiento(p_id uuid, p_motivo text, p_confirmar_negativo boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m movimiento; v_rec jsonb; v_estado_periodo text;
begin
  if not tiene_permiso('ANULAR_MOVIMIENTO') then raise exception 'No tiene permiso ANULAR_MOVIMIENTO' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escriba el motivo de la anulación'; end if;
  select * into m from movimiento where id = p_id for update;
  if not found or not puede_ver_libro(m.libro_id) then raise exception 'El movimiento no existe'; end if;
  if m.estado in ('ANULADO', 'RECHAZADO') then raise exception '% ya está %', m.codigo, lower(m.estado::text); end if;
  if m.periodo_id is not null then
    select estado into v_estado_periodo from periodo where id = m.periodo_id;
    if v_estado_periodo = 'CERRADO' and not tiene_permiso('CERRAR_PERIODO') then
      raise exception 'El período % está cerrado: solo quien puede cerrar períodos lo anula', m.periodo_id;
    end if;
  end if;

  update movimiento set estado = 'ANULADO', anulado_motivo = btrim(p_motivo), anulado_por = auth.uid(), anulado_en = now(), actualizado_en = now()
   where id = p_id;
  if m.estado <> 'APROBADO' then
    return jsonb_build_object('codigo', m.codigo, 'recalculo', null);
  end if;

  -- T-8: los saldos posteriores del bucket se recalculan ya
  v_rec := recalcular_saldos_bucket(m.contraparte_id, m.moneda_destino, m.modalidad);
  if v_rec ->> 'primer_negativo' is not null and not coalesce(p_confirmar_negativo, false) then
    raise exception 'SALDO_NEGATIVO: al anular %, el saldo de % (% · %) queda negativo desde % (%). Marque la confirmación para anularlo igual',
      m.codigo, m.contraparte_id, m.moneda_destino, lower(m.modalidad), v_rec ->> 'primer_negativo', formato_pesos((v_rec ->> 'saldo_negativo')::numeric);
  end if;
  return jsonb_build_object('codigo', m.codigo, 'recalculo', v_rec);
end $$;
revoke execute on function public.anular_movimiento(uuid, text, boolean) from public, anon;
grant execute on function public.anular_movimiento(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- STW-55: gastos (hoja GASTOS del libro OTROS, docs/web/08). Consecutivo propio G-0001 (T-14),
-- período por fecha (P-27). Solo FINANZAS (superadmin y administradora; ella lo puede ceder, P-30).
-- ---------------------------------------------------------------------
create table public.consecutivo_finanzas (serie text primary key, ultimo int not null default 0);
alter table public.consecutivo_finanzas enable row level security;

create table public.gasto (
  id             text primary key,                                  -- 'G-0001' (lo pone el trigger)
  fecha          date not null,
  periodo        text not null,                                     -- 'yyyy-MM' de la fecha
  tipo           text not null check (btrim(tipo) <> ''),           -- agrupa el estado de resultados
  proveedor      text,
  descripcion    text,
  valor          numeric(20,2) not null check (valor > 0),          -- "abono"
  empresa_id     text references public.empresa,
  tipo_abono     text,
  oficina        text,
  estado         text not null default 'ACTIVO' check (estado in ('ACTIVO', 'ANULADO')),
  anulado_motivo text,
  anulado_por    uuid references public.usuario,
  anulado_en     timestamptz,
  creado_por     uuid references public.usuario default auth.uid(),
  creado_en      timestamptz not null default now(),
  constraint gasto_anulado_con_motivo check (estado <> 'ANULADO' or btrim(coalesce(anulado_motivo, '')) <> '')
);
create index on public.gasto (periodo, tipo) where estado = 'ACTIVO';

create or replace function public.preparar_gasto()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  new.tipo := normalizar_texto(new.tipo);
  new.proveedor := nullif(btrim(new.proveedor), '');
  new.descripcion := nullif(btrim(new.descripcion), '');
  new.tipo_abono := nullif(normalizar_texto(new.tipo_abono), '');
  new.oficina := nullif(normalizar_texto(new.oficina), '');
  new.periodo := to_char(new.fecha, 'YYYY-MM');
  if new.fecha > (now() at time zone 'America/Bogota')::date + 1 then raise exception 'La fecha del gasto está en el futuro'; end if;
  if tg_op = 'INSERT' then
    insert into consecutivo_finanzas (serie) values ('G') on conflict do nothing;
    update consecutivo_finanzas set ultimo = ultimo + 1 where serie = 'G' returning ultimo into v_n;
    new.id := 'G-' || lpad(v_n::text, 4, '0');
    new.estado := 'ACTIVO';
    new.creado_por := auth.uid();
    new.creado_en := now();
    return new;
  end if;
  -- UPDATE: solo se anula (nada se borra ni se reescribe)
  if old.estado = 'ANULADO' then raise exception 'El gasto % está anulado', old.id; end if;
  if new.estado <> 'ANULADO' then raise exception 'Un gasto no se edita: anúlelo con motivo y regístrelo de nuevo'; end if;
  if (to_jsonb(new) - array['estado', 'anulado_motivo', 'anulado_por', 'anulado_en']) <> (to_jsonb(old) - array['estado', 'anulado_motivo', 'anulado_por', 'anulado_en']) then
    raise exception 'Al anular solo cambian el estado y el motivo';
  end if;
  new.anulado_por := auth.uid();
  new.anulado_en := now();
  return new;
end $$;
create trigger preparar_gasto before insert or update on public.gasto for each row execute function public.preparar_gasto();
create trigger aud_gasto after insert or update or delete on public.gasto for each row execute function public.auditar('id');

alter table public.gasto enable row level security;
create policy gasto_leer on public.gasto for select to authenticated using (public.tiene_permiso('FINANZAS'));
create policy gasto_crear on public.gasto for insert to authenticated with check (public.tiene_permiso('FINANZAS'));
create policy gasto_anular on public.gasto for update to authenticated
  using (public.tiene_permiso('FINANZAS') and estado = 'ACTIVO') with check (public.tiene_permiso('FINANZAS'));
revoke delete, truncate on public.gasto from anon, authenticated;
