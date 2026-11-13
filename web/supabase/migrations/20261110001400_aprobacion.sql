-- =====================================================================
-- Sprint 5 — Motor de aprobación (docs/web/02 §3, docs/web/05 §Movimientos)
--   STW-28  calcular_movimiento: la misma fórmula de calcularMovimiento (motoAprobacion.js:332-423).
--   STW-29  aprobar_movimientos: aprueba por lote, atómico POR MOVIMIENTO (como hoy), con vista previa.
--   STW-30  saldo_bucket: saldo por cliente × moneda destino × modalidad, bloqueando solo ese bucket.
-- Lo que hoy pasa al "enviar" al libro madre pasa aquí al APROBAR: se busca la tasa vigente por la
-- fecha + hora de la operación, se calcula monto destino, entrada/salida, saldo y utilidad, y se guarda.
-- El operador y el cliente ven tasa, monto destino y saldo (lo que hoy les devuelve el madre);
-- la utilidad, la tasa de adquisición y el beneficio solo los ve la administración (tabla aparte).
-- Reglas: P-3, P-4/P-36 (BCP −15 en SOL), P-5 (beneficio con vigencia), P-6 (utilidad CERRADA),
--         P-8/T-4 (fecha + hora), P-9 (saldo en orden de aprobación), P-15.
-- Pendiente para el Sprint 6: período al aprobar (P-10, STW-61). Hash: no se migra (nadie lo verifica).
-- =====================================================================

-- ---------------------------------------------------------------------
-- STW-30: saldo por bucket (doc 02 §8 regla 1, P-32: por código CT)
-- ---------------------------------------------------------------------
create table public.saldo_bucket (
  contraparte_id   text not null references public.contraparte,
  moneda           text not null references public.moneda (nombre) on update cascade,   -- moneda destino
  modalidad        text not null references public.modalidad,
  saldo            numeric(20,2) not null default 0,
  ultima_secuencia bigint not null default 0,
  actualizado_en   timestamptz not null default now(),
  primary key (contraparte_id, moneda, modalidad)
);
alter table public.saldo_bucket enable row level security;
create policy saldo_bucket_leer on public.saldo_bucket for select to authenticated
  using (public.tiene_permiso('APROBAR_MOVIMIENTO') or public.tiene_permiso('VER_REPORTES'));
revoke insert, update, delete, truncate on public.saldo_bucket from anon, authenticated;
create trigger aud_saldo_bucket after insert or update or delete on public.saldo_bucket
  for each row execute function public.auditar('contraparte_id');

-- ---------------------------------------------------------------------
-- Resultado de la aprobación que ven todos los que ven el movimiento (= columnas T–X del operador)
-- ---------------------------------------------------------------------
alter table public.movimiento
  add column aprobado_en         timestamptz,
  add column aprobado_por        uuid references public.usuario,
  add column monto_efectivo      numeric(20,2),                       -- monto − descuento fijo (BCP)
  add column tasa_cliente_id     text references public.tasa_cliente,
  add column tasa_base           numeric,
  add column tasa_aplicada       numeric,                             -- "tasafinal"
  add column monto_destino       numeric(20,2),                       -- "monto_cop"
  add column entrada             numeric(20,2),
  add column salida              numeric(20,2),
  add column saldo_anterior      numeric(20,2),
  add column saldo_post          numeric(20,2),
  add column secuencia_bucket    bigint,                              -- orden dentro del bucket (P-9)
  add column aprobacion_error    text,                                -- último intento fallido (sigue VERIFICADO)
  add column aprobacion_error_en timestamptz,
  add constraint aprobado_completo check (
    estado <> 'APROBADO' or (aprobado_en is not null and tasa_aplicada is not null and monto_destino is not null and saldo_post is not null));
create index on public.movimiento (contraparte_id, moneda_destino, modalidad, secuencia_bucket);

-- Margen de la casa: solo administración (hoy el operador nunca recibe la utilidad)
create table public.movimiento_utilidad (
  movimiento_id     uuid primary key references public.movimiento,
  tasa_utilidad_id  text references public.tasa_utilidad,
  puntos_utilidad   numeric not null,                                 -- U (EFECTIVO o TRANSFERENCIA)
  ajuste_id         text references public.ajuste_cliente,
  beneficio         numeric not null default 0,                       -- Ben (pesos por unidad, P-36)
  tasa_adquisicion  numeric not null,
  valor_adquisicion numeric not null,                                 -- sin redondear, como el Motor
  utilidad          numeric not null,
  marca_utilidad    text check (marca_utilidad in ('UTILIDAD N/A', 'CAMBIADA POR EL ADMIN', 'PUNTOS RESTADOS')),
  creado_en         timestamptz not null default now()
);
alter table public.movimiento_utilidad enable row level security;
create policy movimiento_utilidad_leer on public.movimiento_utilidad for select to authenticated
  using (public.tiene_permiso('APROBAR_MOVIMIENTO') or public.tiene_permiso('AJUSTAR_UTILIDAD') or public.tiene_permiso('FINANZAS'));
revoke insert, update, delete, truncate on public.movimiento_utilidad from anon, authenticated;
create trigger aud_movimiento_utilidad after insert or update or delete on public.movimiento_utilidad
  for each row execute function public.auditar('movimiento_id');

-- ---------------------------------------------------------------------
-- STW-28: el cálculo. Pura (immutable): no lee tablas, así se prueba contra los históricos (STW-27).
-- ---------------------------------------------------------------------
-- 1234567.5 → '1.234.567,50' (formato colombiano, sin depender del idioma del servidor)
create or replace function public.formato_pesos(n numeric) returns text language sql immutable as $$
  select translate(to_char(n, 'FM999,999,999,999,990.00'), ',.', '.,');
$$;

create type public.resultado_calculo as (
  monto_efectivo numeric, tasa_aplicada numeric, tasa_adquisicion numeric, monto_destino numeric,
  valor_adquisicion numeric, utilidad numeric, entrada numeric, salida numeric, saldo_post numeric
);

create or replace function public.calcular_movimiento(
  p_tipo text, p_monto_origen numeric, p_moneda_origen text, p_moneda_destino text,
  p_descuento_fijo numeric, p_tasa_base numeric, p_beneficio numeric, p_utilidad numeric,
  p_descuento_tasa boolean, p_saldo_anterior numeric
) returns public.resultado_calculo language plpgsql immutable as $$
declare r resultado_calculo;
begin
  if p_monto_origen is null or p_monto_origen <= 0 then raise exception 'El monto debe ser mayor que cero'; end if;
  if p_tasa_base is null then raise exception 'No hay tasa base'; end if;
  -- P-4 / P-36: AGENTE BCP resta 15 (solo SOL). La columna Q guarda el monto original.
  r.monto_efectivo := p_monto_origen - coalesce(p_descuento_fijo, 0);
  if r.monto_efectivo <= 0 then raise exception 'El monto (%) no alcanza para el descuento fijo de %', p_monto_origen, p_descuento_fijo; end if;

  if upper(btrim(p_moneda_origen)) = upper(btrim(p_moneda_destino)) then        -- :363-365
    r.tasa_aplicada := p_tasa_base;
    r.tasa_adquisicion := p_tasa_base + coalesce(p_utilidad, 0) - coalesce(p_beneficio, 0);
  else                                                                          -- :366-369
    r.tasa_aplicada := p_tasa_base + coalesce(p_beneficio, 0);
    r.tasa_adquisicion := r.tasa_aplicada + coalesce(p_utilidad, 0) - coalesce(p_beneficio, 0);
  end if;
  if coalesce(p_descuento_tasa, false) then                                     -- :371-373 (después de la adquisición)
    r.tasa_aplicada := r.tasa_aplicada * 0.95;
  end if;

  r.monto_destino := round(r.monto_efectivo * r.tasa_aplicada, 2);              -- :375
  r.valor_adquisicion := r.monto_efectivo * r.tasa_adquisicion;                 -- :384 (sin redondeo)
  r.utilidad := r.valor_adquisicion - r.monto_destino;                          -- :386

  case upper(btrim(p_tipo))
    when 'ENTRADA' then r.entrada := r.monto_destino; r.salida := 0;
    when 'SALIDA'  then r.entrada := 0; r.salida := r.monto_destino;
    else raise exception 'Tipo de movimiento inválido: %', p_tipo;
  end case;

  -- :400-407: una SALIDA no puede dejar el saldo negativo (igual al saldo sí se permite)
  if r.salida > coalesce(p_saldo_anterior, 0) then
    raise exception 'Saldo insuficiente: disponible %, solicitado %, faltan %',
      formato_pesos(coalesce(p_saldo_anterior, 0)), formato_pesos(r.salida), formato_pesos(r.salida - coalesce(p_saldo_anterior, 0));
  end if;
  r.saldo_post := coalesce(p_saldo_anterior, 0) + r.entrada - r.salida;
  return r;
end $$;
grant execute on function public.calcular_movimiento(text, numeric, text, text, numeric, numeric, numeric, numeric, boolean, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- STW-29: aprobar por lote. Cada movimiento se aprueba o falla solo (bloque con su propia
-- excepción): los que fallan siguen VERIFICADO con el motivo, como hoy el madre devuelve ERROR
-- por registro. Orden: fecha + hora de la operación y luego orden de registro, así una ENTRADA
-- anterior del mismo lote cuenta para una SALIDA posterior (doc 02 §3.2 paso 9).
-- p_simular = vista previa: calcula todo igual (con bloqueos) y deshace al final.
-- ---------------------------------------------------------------------
create or replace function public.aprobar_movimientos(p_ids uuid[], p_simular boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; m movimiento; t tasa_cliente; u tasa_utilidad; a ajuste_cliente; b saldo_bucket;
  c resultado_calculo; v_puntos numeric; v_desc numeric; v_res jsonb := '[]'; v_ok int := 0; v_err int := 0;
  v_cuando text;
begin
  if not tiene_permiso('APROBAR_MOVIMIENTO') then raise exception 'No tiene permiso APROBAR_MOVIMIENTO' using errcode = '42501'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Seleccione al menos un movimiento'; end if;

  begin   -- bloque de la vista previa: si p_simular, todo lo de adentro se deshace al final
    for r in select id from movimiento where id = any(p_ids) order by fecha_operacion, creado_en, codigo loop
      begin
        select * into m from movimiento where id = r.id for update;
        v_cuando := to_char(m.fecha_operacion at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI');
        if m.estado <> 'VERIFICADO' then
          raise exception 'Está % (solo se aprueba lo verificado)', lower(m.estado::text);
        end if;

        -- Tasa (doc 02 §3.3): publicada (CERRADO), mismo par y modalidad, vigencia que contiene fecha + hora
        select * into t from tasa_cliente
         where estado = 'CERRADO' and moneda_origen = m.moneda_origen and moneda_destino = m.moneda_destino
           and modalidad = m.modalidad and vigencia @> m.fecha_operacion
         order by lower(vigencia) desc limit 1;
        if not found then
          raise exception 'No existe tasa vigente % → % % el %', m.moneda_origen, m.moneda_destino, lower(m.modalidad), v_cuando;
        end if;

        -- Utilidad (§3.4 + P-6: con estado, solo la publicada)
        select * into u from tasa_utilidad
         where estado = 'CERRADO' and moneda_origen = m.moneda_origen and moneda_destino = m.moneda_destino
           and vigencia @> m.fecha_operacion
         order by lower(vigencia) desc limit 1;
        if not found then
          raise exception 'No existe utilidad vigente % → % el %', m.moneda_origen, m.moneda_destino, v_cuando;
        end if;
        v_puntos := case when m.modalidad = 'EFECTIVO' then u.puntos_efectivo else u.puntos_transferencia end;

        -- Beneficio (§3.5 + P-5: con vigencia; sin modalidad, como hoy). Si no hay, 0.
        a := null;
        select * into a from ajuste_cliente
         where activo and contraparte_id = m.contraparte_id and moneda_origen = m.moneda_origen
           and moneda_destino = m.moneda_destino and vigencia @> m.fecha_operacion
         order by lower(vigencia) desc limit 1;

        v_desc := descuento_recibido(m.recibido_en_id, m.moneda_origen);

        -- Bucket: se bloquea solo esta fila (cliente × moneda destino × modalidad)
        insert into saldo_bucket (contraparte_id, moneda, modalidad) values (m.contraparte_id, m.moneda_destino, m.modalidad)
          on conflict do nothing;
        select * into b from saldo_bucket
         where contraparte_id = m.contraparte_id and moneda = m.moneda_destino and modalidad = m.modalidad for update;

        c := calcular_movimiento(m.tipo::text, m.monto_origen, m.moneda_origen, m.moneda_destino, v_desc,
                                 t.valor, coalesce(a.beneficio, 0), v_puntos, m.descuento_tasa, b.saldo);

        update saldo_bucket set saldo = c.saldo_post, ultima_secuencia = ultima_secuencia + 1, actualizado_en = now()
         where contraparte_id = b.contraparte_id and moneda = b.moneda and modalidad = b.modalidad;
        update movimiento set
          estado = 'APROBADO', aprobado_en = now(), aprobado_por = auth.uid(), monto_efectivo = c.monto_efectivo,
          tasa_cliente_id = t.id, tasa_base = t.valor, tasa_aplicada = c.tasa_aplicada, monto_destino = c.monto_destino,
          entrada = c.entrada, salida = c.salida, saldo_anterior = b.saldo, saldo_post = c.saldo_post,
          secuencia_bucket = b.ultima_secuencia + 1, aprobacion_error = null, aprobacion_error_en = null, actualizado_en = now()
         where id = m.id;
        insert into movimiento_utilidad (movimiento_id, tasa_utilidad_id, puntos_utilidad, ajuste_id, beneficio,
                                         tasa_adquisicion, valor_adquisicion, utilidad)
        values (m.id, u.id, v_puntos, a.id, coalesce(a.beneficio, 0), c.tasa_adquisicion, c.valor_adquisicion, c.utilidad);

        v_ok := v_ok + 1;
        v_res := v_res || jsonb_build_object('id', m.id, 'codigo', m.codigo, 'ok', true,
          'tasa', c.tasa_aplicada, 'monto_destino', c.monto_destino, 'moneda_destino', m.moneda_destino, 'tipo', m.tipo,
          'saldo_anterior', b.saldo, 'saldo_post', c.saldo_post, 'utilidad', c.utilidad);
      exception when others then
        v_err := v_err + 1;
        v_res := v_res || jsonb_build_object('id', r.id, 'codigo', coalesce(m.codigo, r.id::text), 'ok', false, 'error', sqlerrm);
        if not p_simular then
          update movimiento set aprobacion_error = left(sqlerrm, 500), aprobacion_error_en = now() where id = r.id and estado = 'VERIFICADO';
        end if;
      end;
      m := null;
    end loop;
    if p_simular then raise exception 'vista previa' using errcode = 'SIMUL'; end if;
  exception when sqlstate 'SIMUL' then
    null;   -- vista previa: se deshace todo lo de este bloque; quedan los resultados calculados
  end;

  return jsonb_build_object('simulado', p_simular, 'aprobados', v_ok, 'con_error', v_err, 'resultados', v_res);
end $$;
revoke execute on function public.aprobar_movimientos(uuid[], boolean) from public, anon;
grant execute on function public.aprobar_movimientos(uuid[], boolean) to authenticated;

-- Saldos con el nombre del cliente (pantalla de saldos y tarjetas)
create view public.saldo_cliente with (security_invoker = true) as
select s.contraparte_id, k.nombre, k.tipo, s.moneda, s.modalidad, s.saldo, s.ultima_secuencia, s.actualizado_en
  from public.saldo_bucket s join public.contraparte k on k.id = s.contraparte_id;
