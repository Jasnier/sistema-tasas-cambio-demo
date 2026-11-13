-- =====================================================================
-- Saldos por operador y estado de cuenta compartido (decisión de producto, 2026-11-11).
--  1. El operador ve el saldo solo de SUS clientes: los que tienen algún movimiento (no anulado ni rechazado)
--     en su libro o en el de un cliente grande que atiende. Antes veía todos (VER_REPORTES).
--  2. Si un cliente está en varios libros, su estado de cuenta muestra TODOS los movimientos del bucket para que
--     el saldo cuadre fila por fila; los de otro libro se marcan (es_propio = false), sin id de transacción,
--     tercero ni observaciones, y no se editan. Igual para el cliente grande sobre su código.
--  3. El cliente grande solo ve su propio código en el catálogo de contrapartes (su formulario lo trae fijo).
--  4. Un código CT pertenece a un solo libro de cliente grande activo (lo elige la administración al crearlo).
-- =====================================================================

create index if not exists movimiento_ct_libro on public.movimiento (contraparte_id, libro_id)
  where estado not in ('ANULADO', 'RECHAZADO');

-- ¿Puede el usuario ver el saldo y el estado de cuenta de este código CT?
create or replace function public.puede_ver_ct(p_ct text, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.tiene_permiso('APROBAR_MOVIMIENTO', uid)                       -- administración: todos
      or public.es_mi_contraparte(p_ct, uid)                                   -- cliente grande: su código
      or (public.tiene_permiso('VER_REPORTES', uid) and exists (               -- operador: sus clientes
            select 1 from movimiento m
             where m.contraparte_id = p_ct and m.estado not in ('ANULADO', 'RECHAZADO')
               and (exists (select 1 from libro_usuario lu where lu.usuario_id = uid and lu.libro_id = m.libro_id)
                    or exists (select 1 from libro c join libro_usuario lu on lu.libro_id = c.operador_id
                                where c.id = m.libro_id and lu.usuario_id = uid))));
$$;
revoke execute on function public.puede_ver_ct(text, uuid) from public, anon;
grant execute on function public.puede_ver_ct(text, uuid) to authenticated;

-- 1. saldo_bucket: la administración todo; el operador sus clientes. El cliente grande sigue con saldo_bucket_cliente (1700).
drop policy saldo_bucket_leer on public.saldo_bucket;
create policy saldo_bucket_leer on public.saldo_bucket for select to authenticated
  using (public.tiene_permiso('APROBAR_MOVIMIENTO')
         or (public.tiene_permiso('VER_REPORTES') and public.puede_ver_ct(contraparte_id)));

-- 2. Estado de cuenta del bucket con los movimientos de todos los libros (orden de aprobación, P-9)
create or replace function public.estado_cuenta(p_ct text, p_moneda text, p_modalidad text,
                                                p_desde date default null, p_hasta date default null)
returns table (id uuid, codigo text, fecha_operacion timestamptz, tipo public.tipo_mov, id_transaccion text, tercero text,
               moneda_origen text, monto_origen numeric, tasa_aplicada numeric, entrada numeric, salida numeric,
               saldo_anterior numeric, saldo_post numeric, secuencia_bucket bigint, periodo_id text,
               libro_nombre text, es_propio boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (tiene_permiso('VER_REPORTES') or tiene_permiso('PORTAL_CLIENTE')) or not puede_ver_ct(p_ct) then
    raise exception 'No puede ver el estado de cuenta de %', p_ct using errcode = '42501';
  end if;
  return query
    select m.id, m.codigo, m.fecha_operacion, m.tipo,
           case when v.propio then m.id_transaccion end, case when v.propio then m.tercero end,
           m.moneda_origen, m.monto_origen, m.tasa_aplicada, m.entrada, m.salida, m.saldo_anterior, m.saldo_post,
           m.secuencia_bucket, m.periodo_id, l.nombre, v.propio
      from movimiento m
      join libro l on l.id = m.libro_id
      cross join lateral (select puede_ver_libro(m.libro_id) as propio) v
     where m.estado = 'APROBADO' and m.contraparte_id = p_ct and m.moneda_destino = p_moneda and m.modalidad = p_modalidad
       and (p_desde is null or m.fecha_operacion >= (p_desde::timestamp at time zone 'America/Bogota'))
       and (p_hasta is null or m.fecha_operacion < ((p_hasta + 1)::timestamp at time zone 'America/Bogota'))
     order by m.secuencia_bucket, m.id;
end $$;
revoke execute on function public.estado_cuenta(text, text, text, date, date) from public, anon;
grant execute on function public.estado_cuenta(text, text, text, date, date) to authenticated;

-- Saldo del bucket justo antes de una fecha (saldo inicial cuando el rango no tiene movimientos)
create or replace function public.saldo_bucket_antes(p_ct text, p_moneda text, p_modalidad text, p_desde date)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v numeric;
begin
  if not (tiene_permiso('VER_REPORTES') or tiene_permiso('PORTAL_CLIENTE')) or not puede_ver_ct(p_ct) then
    raise exception 'No puede ver el estado de cuenta de %', p_ct using errcode = '42501';
  end if;
  select m.saldo_post into v from movimiento m
   where m.estado = 'APROBADO' and m.contraparte_id = p_ct and m.moneda_destino = p_moneda and m.modalidad = p_modalidad
     and m.fecha_operacion < (p_desde::timestamp at time zone 'America/Bogota')
   order by m.secuencia_bucket desc limit 1;
  return coalesce(v, 0);
end $$;
revoke execute on function public.saldo_bucket_antes(text, text, text, date) from public, anon;
grant execute on function public.saldo_bucket_antes(text, text, text, date) to authenticated;

-- 3. El cliente grande no ve el catálogo de los demás clientes
drop policy contraparte_leer on public.contraparte;
create policy contraparte_leer on public.contraparte for select to authenticated
  using (not public.tiene_permiso('PORTAL_CLIENTE') or public.tiene_permiso('APROBAR_MOVIMIENTO')
         or public.es_mi_contraparte(id));

-- 4. Un código CT, un solo libro de cliente grande activo
create unique index libro_cliente_grande_ct on public.libro (contraparte_id)
  where tipo = 'cliente_grande' and activo and contraparte_id is not null;
