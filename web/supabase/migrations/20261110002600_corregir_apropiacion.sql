-- =====================================================================
-- Corregir una apropiación de Brasil (pedido del usuario, 2026-11-11). En Sheets no existía: se hacía a mano
-- (borrar la fila del libro destino y dejar el comprobante "libre"). Aquí:
--
--   1. Quien apropió (o la administración) CORRIGE: el movimiento BRS- se anula con el motivo (desaparece del
--      libro equivocado) y el comprobante vuelve a quien corrige, tomado a su nombre, para apropiarlo bien.
--   2. Otro operador que lo necesita SOLICITA la liberación con un motivo; a quien lo apropió le llega la
--      solicitud (en su Inicio y en la bandeja, en vivo). Si la acepta, el comprobante pasa a quien lo pidió.
--      Si la rechaza, responde con un motivo.
--   3. La administración puede corregir cualquiera y atender cualquier solicitud.
--
-- Límite: solo mientras el movimiento no esté APROBADO (ya afectó el saldo: se anula desde Movimientos, que
-- recalcula y también devuelve el comprobante). Si está VERIFICADO, solo la administración (T-3: lo
-- verificado no lo cambia el operador sin desbloqueo).
-- =====================================================================

create table public.solicitud_liberacion (
  id              uuid primary key default gen_random_uuid(),
  comprobante_id  uuid not null references public.comprobante_brasil,
  movimiento_id   uuid references public.movimiento,              -- el BRS- que existía al pedir
  solicitado_por  uuid not null references public.usuario,
  dirigida_a      uuid references public.usuario,                 -- quien lo apropió
  motivo          text not null check (length(btrim(motivo)) >= 3),
  estado          text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'ANULADA')),
  respuesta       text,
  atendida_por    uuid references public.usuario,
  atendida_en     timestamptz,
  creado_en       timestamptz not null default now()
);
-- Una sola solicitud abierta por comprobante
create unique index solicitud_liberacion_abierta on public.solicitud_liberacion (comprobante_id) where estado = 'PENDIENTE';
create index on public.solicitud_liberacion (dirigida_a) where estado = 'PENDIENTE';

alter table public.solicitud_liberacion enable row level security;
-- La ven quien la pidió, a quien va dirigida y la administración. Se escribe solo por las funciones de abajo.
create policy solicitud_liberacion_leer on public.solicitud_liberacion for select to authenticated
  using (solicitado_por = auth.uid() or dirigida_a = auth.uid() or public.tiene_permiso('APROBAR_MOVIMIENTO'));
create trigger aud_solicitud_liberacion after insert or update or delete on public.solicitud_liberacion
  for each row execute function public.auditar('id');

-- ---------------------------------------------------------------------
-- Paso común: anula el BRS- y deja el comprobante tomado a nombre de p_para (10 minutos, como "Tomar").
-- El trigger de la 2100 (devolver_comprobante_anulado) lo devuelve a PENDIENTE al anular el movimiento.
-- ---------------------------------------------------------------------
create or replace function public.liberar_apropiacion(p_comp uuid, p_motivo text, p_para uuid)
returns public.comprobante_brasil language plpgsql security definer set search_path = public as $$
declare c comprobante_brasil; m movimiento; v_admin boolean := tiene_permiso('APROBAR_MOVIMIENTO');
begin
  select * into c from comprobante_brasil where id = p_comp for update;
  if not found or c.estado <> 'APLICADO' or c.movimiento_id is null then
    raise exception 'El comprobante no está apropiado (puede que ya lo hayan corregido)';
  end if;
  select * into m from movimiento where id = c.movimiento_id for update;
  if m.estado = 'APROBADO' then
    raise exception '% ya está aprobado: se anula desde Movimientos (recalcula el saldo) y el comprobante vuelve solo a la bandeja', m.codigo;
  end if;
  if m.estado = 'VERIFICADO' and not v_admin then
    raise exception '% ya está verificado: pida a la administración que lo corrija', m.codigo;
  end if;
  if m.estado <> 'ANULADO' then
    update movimiento set estado = 'ANULADO', anulado_motivo = left('Corrección de apropiación: ' || btrim(p_motivo), 500),
           anulado_por = auth.uid(), anulado_en = now(), actualizado_en = now()
     where id = m.id;
  end if;
  update comprobante_brasil set estado = 'EN_PROCESO', bloqueado_por = p_para, bloqueado_en = now()
   where id = p_comp and estado = 'PENDIENTE'
   returning * into c;
  -- Si había una solicitud abierta y no es la que se está atendiendo, queda sin efecto
  update solicitud_liberacion set estado = 'ANULADA', respuesta = 'La apropiación se corrigió', atendida_por = auth.uid(), atendida_en = now()
   where comprobante_id = p_comp and estado = 'PENDIENTE' and solicitado_por <> p_para;
  return c;
end $$;
revoke execute on function public.liberar_apropiacion(uuid, text, uuid) from public, anon, authenticated;

-- 1. Quien apropió (o la administración) corrige: el comprobante vuelve a él para apropiarlo bien
create or replace function public.corregir_apropiacion(p_id uuid, p_motivo text)
returns public.comprobante_brasil language plpgsql security definer set search_path = public as $$
declare c comprobante_brasil;
begin
  if not tiene_permiso('BRASIL_APROPIAR') then raise exception 'No tiene permiso BRASIL_APROPIAR' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escriba el motivo de la corrección'; end if;
  select * into c from comprobante_brasil where id = p_id;
  if not found then raise exception 'El comprobante no existe'; end if;
  if c.apropiado_por is distinct from auth.uid() and not tiene_permiso('APROBAR_MOVIMIENTO') then
    raise exception 'Solo quien lo apropió (o la administración) lo corrige: solicite la liberación' using errcode = '42501';
  end if;
  return liberar_apropiacion(p_id, p_motivo, auth.uid());
end $$;

-- 2. Otro operador pide que se lo liberen
create or replace function public.solicitar_liberacion(p_id uuid, p_motivo text)
returns public.solicitud_liberacion language plpgsql security definer set search_path = public as $$
declare c comprobante_brasil; s solicitud_liberacion;
begin
  if not tiene_permiso('BRASIL_APROPIAR') then raise exception 'No tiene permiso BRASIL_APROPIAR' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escriba por qué lo necesita'; end if;
  select * into c from comprobante_brasil where id = p_id;
  if not found or c.estado <> 'APLICADO' then raise exception 'El comprobante no está apropiado'; end if;
  if c.apropiado_por = auth.uid() then raise exception 'Usted lo apropió: puede corregirlo directamente'; end if;
  insert into solicitud_liberacion (comprobante_id, movimiento_id, solicitado_por, dirigida_a, motivo)
  values (p_id, c.movimiento_id, auth.uid(), c.apropiado_por, btrim(p_motivo))
  returning * into s;
  return s;
exception when unique_violation then
  raise exception 'Ya hay una solicitud de liberación abierta para %', c.codigo;
end $$;

-- 3. Quien lo apropió (o la administración) responde
create or replace function public.responder_liberacion(p_solicitud uuid, p_aceptar boolean, p_respuesta text default null)
returns public.solicitud_liberacion language plpgsql security definer set search_path = public as $$
declare s solicitud_liberacion; c comprobante_brasil;
begin
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

-- Para la pantalla: las solicitudes que le tocan a cada quien, con nombres (la tabla usuario solo deja leer el propio)
create or replace function public.solicitudes_liberacion()
returns table (id uuid, comprobante_id uuid, comprobante text, valor numeric, movimiento text, libro text, motivo text, estado text,
               respuesta text, creado_en timestamptz, atendida_en timestamptz,
               solicitado_por uuid, solicitante text, dirigida_a uuid, apropiador text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not tiene_permiso('BRASIL_APROPIAR') then raise exception 'No tiene permiso BRASIL_APROPIAR' using errcode = '42501'; end if;
  return query
    select s.id, s.comprobante_id, c.codigo, c.valor, m.codigo, l.prefijo || ' · ' || l.nombre, s.motivo, s.estado, s.respuesta,
           s.creado_en, s.atendida_en, s.solicitado_por, coalesce(nullif(btrim(us.nombre), ''), us.correo),
           s.dirigida_a, coalesce(nullif(btrim(ud.nombre), ''), ud.correo)
      from solicitud_liberacion s
      join comprobante_brasil c on c.id = s.comprobante_id
      left join movimiento m on m.id = s.movimiento_id
      left join libro l on l.id = m.libro_id
      join usuario us on us.id = s.solicitado_por
      left join usuario ud on ud.id = s.dirigida_a
     where (s.solicitado_por = auth.uid() or s.dirigida_a = auth.uid() or tiene_permiso('APROBAR_MOVIMIENTO'))
       and (s.estado = 'PENDIENTE' or s.atendida_en > now() - interval '2 days')
     order by (s.estado = 'PENDIENTE') desc, s.creado_en desc
     limit 100;
end $$;

revoke execute on function public.corregir_apropiacion(uuid, text), public.solicitar_liberacion(uuid, text),
  public.responder_liberacion(uuid, boolean, text), public.solicitudes_liberacion() from public, anon;
grant execute on function public.corregir_apropiacion(uuid, text), public.solicitar_liberacion(uuid, text),
  public.responder_liberacion(uuid, boolean, text), public.solicitudes_liberacion() to authenticated;

-- Las solicitudes llegan en vivo (Realtime solo entrega a quien puede leer la fila: el que pidió, el destinatario y la administración)
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'solicitud_liberacion') then
    alter publication supabase_realtime add table public.solicitud_liberacion;
  end if;
end $$;
