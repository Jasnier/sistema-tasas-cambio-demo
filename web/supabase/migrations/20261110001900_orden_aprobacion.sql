-- =====================================================================
-- Orden de aprobación explícito (P-9) y permisos de siguiente_codigo. Hallazgos de revisión (sesión dc):
--  1. recalcular_saldos_bucket (1600) ordenaba por aprobado_en. Ese valor no sirve como orden:
--     - en aprobar_movimientos es now() = inicio de la transacción (no el momento del bloqueo del bucket),
--       así que dos aprobaciones concurrentes pueden quedar invertidas;
--     - en lo importado del Motor (STW-49) 690 filas no tienen fecha de aprobación y el orden real es la fila física.
--     Ahora cada aprobación toma un número de una secuencia DESPUÉS de bloquear su bucket (orden_aprobacion) y el
--     recálculo ordena por ese número. Un movimiento que pasa a otro bucket (corrección) conserva su número y cae en
--     su lugar histórico. La importación lo llena con la fila del Motor.
--  2. siguiente_codigo (0300) se revocó a anon y authenticated pero no a PUBLIC: cualquiera podía gastar números.
-- =====================================================================

create sequence public.movimiento_orden_aprobacion_seq;
alter table public.movimiento add column orden_aprobacion bigint;
create unique index movimiento_orden_aprobacion on public.movimiento (orden_aprobacion) where orden_aprobacion is not null;
create index on public.movimiento (contraparte_id, moneda_destino, modalidad, orden_aprobacion) where estado = 'APROBADO';

-- Lo ya aprobado (entornos de prueba): el orden que tenía cada bucket
update public.movimiento m set orden_aprobacion = o.n
  from (select id, row_number() over (order by aprobado_en, secuencia_bucket, fecha_operacion, creado_en, codigo) n
          from public.movimiento where aprobado_en is not null) o
 where o.id = m.id;
select setval('public.movimiento_orden_aprobacion_seq', coalesce((select max(orden_aprobacion) from public.movimiento), 0) + 1, false);

-- Al pasar a APROBADO toma el siguiente número. aprobar_movimientos hace este update después de bloquear el bucket
-- (select … for update), así que dentro de un bucket el orden sigue el orden real de los bloqueos.
create or replace function public.asignar_orden_aprobacion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'APROBADO' and old.estado is distinct from 'APROBADO' and new.orden_aprobacion is null then
    new.orden_aprobacion := nextval('public.movimiento_orden_aprobacion_seq');
  end if;
  return new;
end $$;
create trigger asignar_orden_aprobacion before update of estado on public.movimiento
  for each row execute function public.asignar_orden_aprobacion();

create or replace function public.recalcular_saldos_bucket(p_ct text, p_moneda text, p_modalidad text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_saldo numeric(20,2) := 0; v_neg text; v_neg_saldo numeric; v_n int := 0; v_seq bigint := 0;
begin
  insert into saldo_bucket (contraparte_id, moneda, modalidad) values (p_ct, p_moneda, p_modalidad) on conflict do nothing;
  perform 1 from saldo_bucket where contraparte_id = p_ct and moneda = p_moneda and modalidad = p_modalidad for update;
  for r in select id, codigo, entrada, salida, saldo_anterior, saldo_post, secuencia_bucket from movimiento
            where estado = 'APROBADO' and contraparte_id = p_ct and moneda_destino = p_moneda and modalidad = p_modalidad
            order by orden_aprobacion nulls last, aprobado_en, codigo for update loop
    v_seq := v_seq + 1;
    if r.saldo_anterior is distinct from v_saldo or r.saldo_post is distinct from v_saldo + r.entrada - r.salida
       or r.secuencia_bucket is distinct from v_seq then
      update movimiento set saldo_anterior = v_saldo, saldo_post = v_saldo + r.entrada - r.salida, secuencia_bucket = v_seq,
             actualizado_en = now()
       where id = r.id;
      v_n := v_n + 1;
    end if;
    v_saldo := v_saldo + r.entrada - r.salida;
    if v_saldo < 0 and v_neg is null then v_neg := r.codigo; v_neg_saldo := v_saldo; end if;
  end loop;
  update saldo_bucket set saldo = v_saldo, ultima_secuencia = v_seq, actualizado_en = now()
   where contraparte_id = p_ct and moneda = p_moneda and modalidad = p_modalidad;
  return jsonb_build_object('contraparte_id', p_ct, 'moneda', p_moneda, 'modalidad', p_modalidad, 'saldo', v_saldo,
    'movimientos', v_seq, 'actualizados', v_n, 'primer_negativo', v_neg, 'saldo_negativo', v_neg_saldo);
end $$;
revoke execute on function public.recalcular_saldos_bucket(text, text, text) from public, anon, authenticated;

-- 2. Nadie fuera de las funciones del sistema gasta números del consecutivo
revoke execute on function public.siguiente_codigo(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. La utilidad por período es de la casa (hallazgo dc): la tabla periodo la lee cualquiera (id, fechas, estado),
--    pero utilidad_total y total_movimientos solo por la vista periodo_resumen, con permiso.
-- ---------------------------------------------------------------------
revoke select on public.periodo from anon, authenticated;
grant select (id, inicio, fin, estado, cerrado_en, cerrado_por, creado_en, reabierto_motivo, reabierto_por, reabierto_en) on public.periodo to authenticated;

drop view public.periodo_resumen;
create view public.periodo_resumen as   -- sin security_invoker: lee las columnas protegidas, pero filtra por permiso
select p.id, p.inicio, p.fin, p.estado, p.cerrado_en, p.utilidad_total, p.total_movimientos, p.reabierto_motivo,
       (select count(*) from public.movimiento m where m.periodo_id = p.id and m.estado = 'APROBADO')::int as aprobados,
       (select coalesce(sum(u.utilidad), 0) from public.movimiento m join public.movimiento_utilidad u on u.movimiento_id = m.id
         where m.periodo_id = p.id and m.estado = 'APROBADO') as utilidad_actual
  from public.periodo p
 where public.tiene_permiso('CERRAR_PERIODO') or public.tiene_permiso('FINANZAS');
revoke all on public.periodo_resumen from anon;
grant select on public.periodo_resumen to authenticated;

-- ---------------------------------------------------------------------
-- 4. posibles_duplicados: solo quien puede registrar en ese libro (o verificar) pregunta por él (hallazgo dc:
--    un cliente podía sondear movimientos de otros códigos CT). Igual que la 1500 más esa revisión.
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
  if not puede_registrar_en_libro(m.libro_id) and not tiene_permiso('VERIFICAR_MOVIMIENTO') then
    raise exception 'No puede registrar movimientos en ese libro' using errcode = '42501';
  end if;
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

-- ---------------------------------------------------------------------
-- 5. Las funciones de permisos no las ejecuta quien no ha iniciado sesión (hallazgo dc). Las políticas son "to authenticated".
-- ---------------------------------------------------------------------
revoke execute on function public.tiene_permiso(text, uuid), public.es_superadmin(uuid), public.mis_permisos(),
  public.puede_ver_libro(uuid, uuid), public.puede_ver_ganancias(uuid, uuid), public.es_mi_contraparte(text, uuid),
  public.puede_registrar_en_libro(uuid, uuid) from public, anon;
grant execute on function public.tiene_permiso(text, uuid), public.es_superadmin(uuid), public.mis_permisos(),
  public.puede_ver_libro(uuid, uuid), public.puede_ver_ganancias(uuid, uuid), public.es_mi_contraparte(text, uuid),
  public.puede_registrar_en_libro(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Ganancias congeladas (P-5): al corregir un movimiento que ya tiene ganancia (aprobada antes o importada de
--    Sheets, STW-49) se conserva su beneficio; antes se tomaba el de movimiento_utilidad, que la corrección actualiza
--    con el vigente y que en lo importado viene del CORE actual (docs/web/02 §3.10: el CORE cambió después).
-- ---------------------------------------------------------------------
create or replace function public.sincronizar_ganancia(p_mov uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m movimiento; l libro; u movimiento_utilidad; v_ben numeric; v_base numeric; v_ut numeric; v_debe numeric := 0; v_hay numeric; v_n int;
begin
  select * into m from movimiento where id = p_mov;
  select * into l from libro where id = m.libro_id;
  if not found or not l.usa_ganancias then return; end if;
  select * into u from movimiento_utilidad where movimiento_id = p_mov;

  if m.estado = 'APROBADO' and u.movimiento_id is not null then
    -- Congelada (P-5): si ya tiene ganancia (aprobada antes o importada de Sheets) conserva SU beneficio mientras la
    -- moneda de origen sea la misma; una corrección solo cambia el monto base. Si es nueva, el beneficio vigente.
    select coalesce(max(g.beneficio), u.beneficio, 0) into v_ben from ganancia_movimiento g
     where g.movimiento_id = p_mov and g.moneda_origen = m.moneda_origen;
    v_base := m.monto_efectivo;                                  -- ya trae el −15 de BCP (P-4/P-36)
    v_ut := round(v_base * v_ben, 2);
    insert into ganancia_movimiento (movimiento_id, libro_id, moneda_origen, beneficio, tasa_cliente, monto_base, utilidad)
    values (m.id, l.id, m.moneda_origen, v_ben, m.tasa_aplicada - v_ben, v_base, v_ut)
    on conflict (movimiento_id) do update set moneda_origen = excluded.moneda_origen, beneficio = excluded.beneficio,
      tasa_cliente = excluded.tasa_cliente, monto_base = excluded.monto_base, utilidad = excluded.utilidad, actualizado_en = now()
    where (ganancia_movimiento.beneficio, ganancia_movimiento.tasa_cliente, ganancia_movimiento.monto_base, ganancia_movimiento.utilidad, ganancia_movimiento.moneda_origen)
      is distinct from (excluded.beneficio, excluded.tasa_cliente, excluded.monto_base, excluded.utilidad, excluded.moneda_origen);
    if m.moneda_origen in ('SOL', 'REAL') then v_debe := v_ut; end if;   -- P-20: solo SOL y REAL van a la caja
  end if;

  select coalesce(sum(entrada - salida), 0), count(*) into v_hay, v_n from caja_ganancia where movimiento_id = p_mov;
  if v_debe = v_hay then return; end if;
  insert into caja_ganancia (libro_id, codigo, tipo, movimiento_id, descripcion, entrada, salida)
  values (l.id,
          case when v_n = 0 then 'UTIL-' || m.codigo else 'AJU-' || m.codigo || '-' || (v_n + 1) end,
          case when v_n = 0 then 'UTILIDAD' else 'AJUSTE' end::tipo_caja, m.id,
          case when v_n = 0 then 'Utilidad de ' || m.codigo
               when m.estado = 'ANULADO' then 'Anulación de ' || m.codigo
               else 'Corrección de ' || m.codigo end,
          greatest(v_debe - v_hay, 0), greatest(v_hay - v_debe, 0));
end $$;
revoke execute on function public.sincronizar_ganancia(uuid) from public, anon, authenticated;
