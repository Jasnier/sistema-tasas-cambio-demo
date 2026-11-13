-- =====================================================================
-- Sprint 7 — Clientes grandes y estado de resultados
--   STW-41  Portal del cliente grande: ve solo lo suyo (RLS) y el saldo global de su código CT (P-2).
--   STW-42  Flujo cliente → operador → aprobación: el cliente grande SOLO registra en su libro (y ve su saldo).
--           El operador que lo atiende entra a ese libro y ENVÍA los registros a verificación (hoy lo hace él
--           desde el libro del cliente); solo lo enviado se verifica. El operador y la administración pueden
--           rechazar con motivo (P-13). Estados visibles para los dos (P-1, P-31).
--   STW-43  Ganancias del cliente (spec LAZ, doc 03 §4): beneficio × monto base (−15 si AGENTE BCP en SOL),
--           congeladas al aprobar con el beneficio vigente ese día (P-5, P-36). Solo libros con usa_ganancias (P-25).
--   STW-44  Caja de ganancias: libro mayor inmutable. Solo SOL y REAL (P-20). Anular o corregir un aprobado
--           deja un AJUSTE (nunca se reescribe). Recalcular solo superadmin (P-20). Saldo negativo visible (P-37).
--   STW-58  Estado de resultados: pantalla sobre resumen_operativo y gasto (sin cambios de esquema).
-- =====================================================================

insert into public.permiso (codigo, descripcion, solo_superadmin) values
  ('PORTAL_CLIENTE', 'Portal del cliente grande (su saldo y su estado de cuenta)', false),
  ('VER_GANANCIAS',  'Ver ganancias y caja de ganancias',                          false);
insert into public.rol_permiso (rol_id, permiso) values
  ('cliente_grande', 'PORTAL_CLIENTE'), ('cliente_grande', 'VER_GANANCIAS'), ('administradora', 'VER_GANANCIAS');

-- ¿Es el usuario dueño (miembro) de un libro de cliente grande con este código CT?
create or replace function public.es_mi_contraparte(p_ct text, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from libro l join libro_usuario lu on lu.libro_id = l.id
                  where l.tipo = 'cliente_grande' and l.contraparte_id = p_ct and lu.usuario_id = uid);
$$;

-- Nombre del operador que atiende al cliente grande (solo el nombre: la fila del libro tiene la URL de envío)
create or replace function public.nombre_de_mi_operador()
returns text language sql stable security definer set search_path = public as $$
  select o.nombre from libro c join libro_usuario lu on lu.libro_id = c.id join libro o on o.id = c.operador_id
   where lu.usuario_id = auth.uid() and c.tipo = 'cliente_grande' limit 1;
$$;
revoke execute on function public.nombre_de_mi_operador() from public, anon;
grant execute on function public.nombre_de_mi_operador() to authenticated;

-- P-2: el cliente grande ve el saldo global de su código (no el de otros)
create policy saldo_bucket_cliente on public.saldo_bucket for select to authenticated using (public.es_mi_contraparte(contraparte_id));

-- ---------------------------------------------------------------------
-- STW-42: el operador envía los registros del libro de su cliente grande a verificación
-- ---------------------------------------------------------------------
alter table public.movimiento add column enviado_en timestamptz, add column enviado_por uuid references public.usuario;

create or replace function public.enviar_registros_cliente(p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare r movimiento; l libro; v_hechos text[] := '{}'; v_omitidos jsonb := '[]'; v_admin boolean := tiene_permiso('APROBAR_MOVIMIENTO');
begin
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
revoke execute on function public.enviar_registros_cliente(uuid[]) from public, anon;
grant execute on function public.enviar_registros_cliente(uuid[]) to authenticated;

-- Verificar: lo de un cliente grande solo cuando su operador ya lo envió
create or replace function public.verificar_movimientos(p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare r movimiento; v_tipo tipo_libro; v_hechos text[] := '{}'; v_omitidos jsonb := '[]';
begin
  if not tiene_permiso('VERIFICAR_MOVIMIENTO') then raise exception 'No tiene permiso VERIFICAR_MOVIMIENTO' using errcode = '42501'; end if;
  for r in select * from movimiento where id = any(p_ids) order by codigo for update loop
    select tipo into v_tipo from libro where id = r.libro_id;
    if not puede_ver_libro(r.libro_id) then
      v_omitidos := v_omitidos || jsonb_build_object('codigo', r.codigo, 'motivo', 'no es de sus libros');
    elsif v_tipo = 'cliente_grande' and r.estado = 'BORRADOR' then
      v_omitidos := v_omitidos || jsonb_build_object('codigo', r.codigo, 'motivo', 'su operador todavía no lo envía');
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

-- ---------------------------------------------------------------------
-- STW-43: ganancias congeladas por movimiento (columnas AE–AG del libro del cliente)
-- ---------------------------------------------------------------------
create table public.ganancia_movimiento (
  movimiento_id uuid primary key references public.movimiento,
  libro_id      uuid not null references public.libro,
  moneda_origen text not null,
  beneficio     numeric not null,               -- pesos por unidad de moneda origen (P-36)
  tasa_cliente  numeric not null,               -- tasa aplicada − beneficio (AF)
  monto_base    numeric(20,2) not null,         -- monto − 15 si AGENTE BCP en SOL (P-4)
  utilidad      numeric(20,2) not null,         -- monto_base × beneficio (AG)
  congelado_en  timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index on public.ganancia_movimiento (libro_id);
create trigger aud_ganancia_movimiento after insert or update or delete on public.ganancia_movimiento
  for each row execute function public.auditar('movimiento_id');

-- ---------------------------------------------------------------------
-- STW-44: caja de ganancias (libro mayor). Nada se reescribe: los cambios entran como AJUSTE.
-- ---------------------------------------------------------------------
create type public.tipo_caja as enum ('UTILIDAD', 'RETIRO', 'AJUSTE');
create table public.caja_ganancia (
  id            bigint generated always as identity primary key,   -- orden del mayor
  libro_id      uuid not null references public.libro,
  codigo        text not null unique,                               -- 'UTIL-LAZ-0015', 'AJU-LAZ-0015-2', 'RET-…'
  tipo          public.tipo_caja not null,
  fecha         timestamptz not null default now(),
  movimiento_id uuid references public.movimiento,
  descripcion   text,
  entrada       numeric(20,2) not null default 0 check (entrada >= 0),
  salida        numeric(20,2) not null default 0 check (salida >= 0),
  creado_por    uuid references public.usuario default auth.uid()
);
create index on public.caja_ganancia (libro_id, id);
create index on public.caja_ganancia (movimiento_id);
create trigger aud_caja_ganancia after insert or update or delete on public.caja_ganancia
  for each row execute function public.auditar('codigo');

-- Ganancias y caja: el dueño del libro (cliente) y la administración. El operador NO (hoy viven en el libro del cliente).
create or replace function public.puede_ver_ganancias(p_libro uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.tiene_permiso('VER_GANANCIAS', uid) and (public.tiene_permiso('APROBAR_MOVIMIENTO', uid)
    or exists (select 1 from libro_usuario lu where lu.libro_id = p_libro and lu.usuario_id = uid));
$$;
alter table public.ganancia_movimiento enable row level security;
alter table public.caja_ganancia enable row level security;
create policy ganancia_leer on public.ganancia_movimiento for select to authenticated using (public.puede_ver_ganancias(libro_id));
create policy caja_leer on public.caja_ganancia for select to authenticated using (public.puede_ver_ganancias(libro_id));
revoke insert, update, delete, truncate on public.ganancia_movimiento, public.caja_ganancia from anon, authenticated;

-- Calcula la ganancia del movimiento y deja la caja igual a lo que debe ser: si la caja de ese movimiento
-- no suma lo que corresponde (aprobado: su utilidad; anulado: 0), agrega la diferencia. Idempotente.
create or replace function public.sincronizar_ganancia(p_mov uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m movimiento; l libro; u movimiento_utilidad; v_ben numeric; v_base numeric; v_ut numeric; v_debe numeric := 0; v_hay numeric; v_n int;
begin
  select * into m from movimiento where id = p_mov;
  select * into l from libro where id = m.libro_id;
  if not found or not l.usa_ganancias then return; end if;
  select * into u from movimiento_utilidad where movimiento_id = p_mov;

  if m.estado = 'APROBADO' and u.movimiento_id is not null then
    v_ben := coalesce(u.beneficio, 0);
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

-- Al aprobar (insert de movimiento_utilidad), al corregir (update) y al anular (cambio de estado)
create or replace function public.trg_ganancia_utilidad() returns trigger language plpgsql security definer set search_path = public as $$
begin perform sincronizar_ganancia(new.movimiento_id); return null; end $$;
create trigger ganancia_por_utilidad after insert or update of beneficio, utilidad on public.movimiento_utilidad
  for each row execute function public.trg_ganancia_utilidad();

create or replace function public.trg_ganancia_movimiento() returns trigger language plpgsql security definer set search_path = public as $$
begin perform sincronizar_ganancia(new.id); return null; end $$;
create trigger ganancia_por_movimiento after update of estado, monto_origen, monto_efectivo, tasa_aplicada, moneda_origen on public.movimiento
  for each row when (old.aprobado_en is not null or new.aprobado_en is not null) execute function public.trg_ganancia_movimiento();

-- Recalcular ganancias de un libro (solo superadmin, P-20): rehace todo con los datos actuales
create or replace function public.recalcular_ganancias(p_libro uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_antes int; v_despues int;
begin
  if not tiene_permiso('RECALCULAR_GANANCIAS') then raise exception 'Solo el superadmin recalcula ganancias' using errcode = '42501'; end if;
  select count(*) into v_antes from caja_ganancia where libro_id = p_libro;
  for r in select id from movimiento where libro_id = p_libro and aprobado_en is not null order by aprobado_en, fecha_operacion, codigo loop
    perform sincronizar_ganancia(r.id);
  end loop;
  select count(*) into v_despues from caja_ganancia where libro_id = p_libro;
  return jsonb_build_object('ajustes', v_despues - v_antes);
end $$;
revoke execute on function public.recalcular_ganancias(uuid) from public, anon;
grant execute on function public.recalcular_ganancias(uuid) to authenticated;

-- Caja con saldo acumulado y tablero (filas 1–9 de CAJA_GANANCIAS)
create view public.caja_ganancia_saldo with (security_invoker = true) as
select c.*, sum(c.entrada - c.salida) over (partition by c.libro_id order by c.id) as saldo
  from public.caja_ganancia c;

create view public.caja_ganancia_resumen with (security_invoker = true) as
select l.id as libro_id, l.nombre, l.prefijo,
       coalesce(sum(c.entrada - c.salida) filter (where c.tipo <> 'RETIRO'), 0) as utilidad_total,
       coalesce(sum(c.salida) filter (where c.tipo = 'RETIRO'), 0) as total_retirado,
       coalesce(sum(c.entrada - c.salida), 0) as disponible,
       count(*) filter (where c.tipo = 'UTILIDAD')::int as operaciones,
       count(*) filter (where c.tipo = 'RETIRO')::int as retiros,
       max(c.fecha) as ultimo_movimiento
  from public.libro l left join public.caja_ganancia c on c.libro_id = l.id
 where l.usa_ganancias
 group by l.id, l.nombre, l.prefijo;

-- Lo que ya está aprobado (entornos de prueba) entra a la caja
do $$ declare r record; begin
  for r in select m.id from public.movimiento m join public.libro l on l.id = m.libro_id
            where l.usa_ganancias and m.aprobado_en is not null order by m.aprobado_en, m.codigo loop
    perform public.sincronizar_ganancia(r.id);
  end loop;
end $$;
