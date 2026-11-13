-- =====================================================================
-- Brasil: la apropiación crea el movimiento en la web (sin envío a Sheets). Decisión del usuario
-- (2026-11-11, "solo envío a web"): reemplaza el puente STW-20 (POST BRASIL a la web app de cada
-- libro). Desde aquí lo apropiado NO llega a los libros de Sheets.
--
--   apropiar_comprobante: en UNA transacción guarda los datos, crea el movimiento BRS-<prefijo>-NNNNN
--   en BORRADOR en el libro destino y deja el comprobante APLICADO y enlazado (movimiento_id).
--   Si algo falla no queda nada a medias: el comprobante sigue EN_PROCESO a nombre de quien lo tomó.
--
--   El movimiento sigue el flujo normal: el operador lo verifica (si es de un cliente grande, el
--   operador que lo atiende lo envía a verificación) y la administración lo aprueba.
--   Si el movimiento se anula, el comprobante vuelve a la bandeja.
--   Banco, monto, tipo e id de transacción vienen del comprobante y no se editan en el movimiento.
--
-- No se edita la 1100 (está en producción): aquí se quitan sus piezas del envío.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Consecutivo BRS- por libro destino. Arranca después del mayor BRS-<prefijo>-N que ya exista
--    (los importados del historial y los que devolvían los libros de Sheets).
-- ---------------------------------------------------------------------
create table public.consecutivo_brs (
  libro_id uuid primary key references public.libro on delete cascade,
  ultimo   int not null default 0
);
alter table public.consecutivo_brs enable row level security;   -- sin políticas: solo por funciones

create or replace function public.siguiente_codigo_brs(p_libro uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_prefijo text; v_patron text; v_max int; v_n int;
begin
  select prefijo into v_prefijo from libro where id = p_libro;
  if v_prefijo is null then raise exception 'Libro sin prefijo'; end if;
  insert into consecutivo_brs (libro_id) values (p_libro) on conflict do nothing;
  perform 1 from consecutivo_brs where libro_id = p_libro for update;   -- uno a la vez por libro
  v_patron := '^BRS-' || v_prefijo || '-(\d+)$';
  select greatest(
           coalesce((select max(substring(codigo from v_patron)::int) from movimiento where codigo ~ v_patron), 0),
           coalesce((select max(substring(codigo_brs from v_patron)::int) from comprobante_brasil where codigo_brs ~ v_patron), 0))
    into v_max;
  update consecutivo_brs set ultimo = greatest(ultimo, v_max) + 1 where libro_id = p_libro returning ultimo into v_n;
  return 'BRS-' || v_prefijo || '-' || lpad(v_n::text, 5, '0');
end $$;
revoke execute on function public.siguiente_codigo_brs(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Apropiar = crear el movimiento en la web
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
  -- Mismas reglas que posibles_duplicados (STW-25), que exige permisos de operador.
  select string_agg(o.codigo || ' (' || ol.nombre || ')', ', ') into v_dup
    from movimiento o join libro ol on ol.id = o.libro_id
   where o.estado <> 'ANULADO' and lower(btrim(o.id_transaccion)) = lower(m.id_transaccion);
  if v_dup is not null then
    raise exception 'El id de transacción "%" ya está registrado en %', m.id_transaccion, v_dup using errcode = '23505';
  end if;
  v_parecido := exists (select 1 from movimiento o
     where o.estado <> 'ANULADO' and o.contraparte_id = m.contraparte_id and o.moneda_origen = m.moneda_origen
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
revoke execute on function public.apropiar_comprobante(uuid, uuid, time, text, text, text, text, text) from public, anon;
grant execute on function public.apropiar_comprobante(uuid, uuid, time, text, text, text, text, text) to authenticated;

-- preparar_apropiacion queda como paso interno; confirmar/error del envío ya no existen
revoke execute on function public.preparar_apropiacion(uuid, uuid, time, text, text, text, text, text) from public, anon, authenticated;
drop function public.confirmar_apropiacion(uuid, text, text);
drop function public.error_apropiacion(uuid, text);

-- La URL de la web app de cada libro ya no se usa
alter table public.libro drop column webapp_url;

-- ---------------------------------------------------------------------
-- 3. El movimiento de un comprobante: datos del banco fijos; si se anula, el comprobante vuelve
-- ---------------------------------------------------------------------
create or replace function public.proteger_movimiento_brasil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.monto_origen, new.moneda_origen, new.tipo, lower(btrim(new.id_transaccion)))
     is distinct from (old.monto_origen, old.moneda_origen, old.tipo, lower(btrim(old.id_transaccion)))
     and exists (select 1 from comprobante_brasil where movimiento_id = new.id) then
    raise exception '% viene de un comprobante de Brasil: monto, moneda, tipo e id de transacción no se cambian (anúlelo y vuelve a la bandeja)', new.codigo;
  end if;
  return new;
end $$;
create trigger movimiento_brasil_fijo before update on public.movimiento
  for each row execute function public.proteger_movimiento_brasil();

create or replace function public.devolver_comprobante_anulado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update comprobante_brasil set
    estado = 'PENDIENTE', movimiento_id = null, codigo_brs = null, apropiado_por = null, apropiado_en = null,
    bloqueado_por = null, bloqueado_en = null,
    envio_mensaje = left('Se anuló ' || new.codigo || ': ' || coalesce(new.anulado_motivo, ''), 500)
   where movimiento_id = new.id and estado = 'APLICADO';
  return null;
end $$;
create trigger movimiento_anulado_devuelve_comprobante after update of estado on public.movimiento
  for each row when (new.estado = 'ANULADO' and old.estado is distinct from 'ANULADO')
  execute function public.devolver_comprobante_anulado();

revoke execute on function public.proteger_movimiento_brasil(), public.devolver_comprobante_anulado() from public, anon, authenticated;
