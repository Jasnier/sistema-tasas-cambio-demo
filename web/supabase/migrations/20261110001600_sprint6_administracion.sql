-- =====================================================================
-- Sprint 6 — Herramientas de administración, reportes y finanzas
--   STW-33  Recalcular bucket (solo superadmin, RECALCULAR_BUCKET).
--   STW-34  Ajustar utilidad: quitar (utilidad 0) o restar X puntos, simple y múltiple, con vista previa,
--           solo sobre lo seleccionado y respetando marcas (P-16, P-35, T-9).
--   STW-35  Corregir fecha / hora / modalidad / monedas / monto / cliente de un aprobado: recalcula tasa,
--           monto y utilidad, y los saldos de los buckets afectados en tiempo real (P-11, P-14, P-33, T-8).
--   STW-37  Cierre de período (CERRAR_PERIODO) y reapertura (solo superadmin) (P-10, P-11, P-12, T-13).
--   STW-38  Resumen de saldos (pantalla sobre saldo_cliente; sin cambios aquí).
--   STW-40  Comparación de saldos: saldo del bucket vs suma de movimientos vs último saldo_post.
--   STW-56  Negociaciones (P-28, T-14).
--   STW-57  Resumen operativo por período × cliente × moneda (P-29).
--   STW-62  Edición masiva con permiso EDITAR_MOVIMIENTOS_MASIVO (T-10).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Recalcular un bucket en ORDEN DE APROBACIÓN (P-9): por fecha de aprobación y, dentro de un mismo
-- lote (misma hora de aprobación), como lo procesa aprobar_movimientos: fecha + hora de la operación y
-- orden de registro. Renumera la secuencia: un movimiento que llega de otro bucket por una corrección
-- queda en su lugar histórico. Reemplaza la versión de la migración 1500.
-- ---------------------------------------------------------------------
create or replace function public.recalcular_saldos_bucket(p_ct text, p_moneda text, p_modalidad text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_saldo numeric(20,2) := 0; v_neg text; v_neg_saldo numeric; v_n int := 0; v_seq bigint := 0;
begin
  insert into saldo_bucket (contraparte_id, moneda, modalidad) values (p_ct, p_moneda, p_modalidad) on conflict do nothing;
  perform 1 from saldo_bucket where contraparte_id = p_ct and moneda = p_moneda and modalidad = p_modalidad for update;
  for r in select id, codigo, entrada, salida, saldo_anterior, saldo_post, secuencia_bucket from movimiento
            where estado = 'APROBADO' and contraparte_id = p_ct and moneda_destino = p_moneda and modalidad = p_modalidad
            order by aprobado_en, fecha_operacion, creado_en, codigo for update loop
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

-- STW-33: la herramienta del dueño (AJUSTESALDOS.js), con parámetros, auditada y solo superadmin.
create or replace function public.recalcular_bucket(p_ct text, p_moneda text, p_modalidad text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not tiene_permiso('RECALCULAR_BUCKET') then raise exception 'Solo el superadmin recalcula un saldo completo' using errcode = '42501'; end if;
  if not exists (select 1 from saldo_bucket where contraparte_id = p_ct and moneda = p_moneda and modalidad = p_modalidad) then
    raise exception 'No existe el saldo % · % · %', p_ct, p_moneda, p_modalidad;
  end if;
  return recalcular_saldos_bucket(p_ct, p_moneda, p_modalidad);
end $$;
revoke execute on function public.recalcular_bucket(text, text, text) from public, anon;
grant execute on function public.recalcular_bucket(text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Parámetros del cálculo para un movimiento (mismas reglas que aprobar_movimientos, doc 02 §3.3-3.5)
-- ---------------------------------------------------------------------
create type public.parametros_calculo as (
  tasa_id text, tasa_base numeric, utilidad_id text, puntos numeric, ajuste_id text, beneficio numeric, descuento_fijo numeric
);

create or replace function public.buscar_parametros(m public.movimiento)
returns public.parametros_calculo language plpgsql stable security definer set search_path = public as $$
declare p parametros_calculo; t tasa_cliente; u tasa_utilidad; a ajuste_cliente;
  v_cuando text := to_char(m.fecha_operacion at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI');
begin
  select * into t from tasa_cliente
   where estado = 'CERRADO' and moneda_origen = m.moneda_origen and moneda_destino = m.moneda_destino
     and modalidad = m.modalidad and vigencia @> m.fecha_operacion order by lower(vigencia) desc limit 1;
  if not found then raise exception 'No existe tasa vigente % → % % el %', m.moneda_origen, m.moneda_destino, lower(m.modalidad), v_cuando; end if;
  select * into u from tasa_utilidad
   where estado = 'CERRADO' and moneda_origen = m.moneda_origen and moneda_destino = m.moneda_destino
     and vigencia @> m.fecha_operacion order by lower(vigencia) desc limit 1;
  if not found then raise exception 'No existe utilidad vigente % → % el %', m.moneda_origen, m.moneda_destino, v_cuando; end if;
  select * into a from ajuste_cliente
   where activo and contraparte_id = m.contraparte_id and moneda_origen = m.moneda_origen and moneda_destino = m.moneda_destino
     and vigencia @> m.fecha_operacion order by lower(vigencia) desc limit 1;
  p.tasa_id := t.id; p.tasa_base := t.valor; p.utilidad_id := u.id;
  p.puntos := case when m.modalidad = 'EFECTIVO' then u.puntos_efectivo else u.puntos_transferencia end;
  p.ajuste_id := a.id; p.beneficio := coalesce(a.beneficio, 0);
  p.descuento_fijo := descuento_recibido(m.recibido_en_id, m.moneda_origen);
  return p;
end $$;
revoke execute on function public.buscar_parametros(public.movimiento) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- STW-34: ajustes de utilidad (marcas, puntos restados, quién y por qué)
-- ---------------------------------------------------------------------
alter table public.movimiento_utilidad
  add column puntos_restados numeric,
  add column motivo_ajuste   text,
  add column ajustado_por    uuid references public.usuario,
  add column ajustado_en     timestamptz;

-- Período cerrado: solo quien puede cerrar períodos toca lo que hay adentro (P-11)
create or replace function public.exigir_periodo_editable(p_periodo text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_periodo is not null and (select estado from periodo where id = p_periodo) = 'CERRADO' and not tiene_permiso('CERRAR_PERIODO') then
    raise exception 'El período % está cerrado: solo quien puede cerrar períodos lo modifica', p_periodo;
  end if;
end $$;
revoke execute on function public.exigir_periodo_editable(text) from public, anon, authenticated;

-- p_modo: 'QUITAR' (utilidad 0: la casa compra a la misma tasa que el cliente, T-9) o 'RESTAR' (X puntos
-- menos en la tasa de adquisición, P-16). Solo sobre los ids dados (lo que se mostró, P-35); los que ya
-- tienen una marca se omiten. Si restar deja alguna tasa en 0 o menos, no se aplica nada (como hoy).
create or replace function public.ajustar_utilidad(p_ids uuid[], p_modo text, p_puntos numeric, p_motivo text, p_simular boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_tadq numeric; v_valor numeric; v_ut numeric; v_res jsonb := '[]'; v_omit jsonb := '[]';
  v_antes numeric := 0; v_despues numeric := 0; v_n int := 0;
begin
  if not tiene_permiso('AJUSTAR_UTILIDAD') then raise exception 'No tiene permiso AJUSTAR_UTILIDAD' using errcode = '42501'; end if;
  if p_modo not in ('QUITAR', 'RESTAR') then raise exception 'Modo no válido: %', p_modo; end if;
  if p_modo = 'RESTAR' and (p_puntos is null or p_puntos <= 0) then raise exception 'Los puntos a restar deben ser mayores que cero'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escriba el motivo del ajuste'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Seleccione al menos un movimiento'; end if;

  begin
    for r in select m.id, m.codigo, m.estado, m.periodo_id, m.monto_efectivo, m.monto_destino, u.tasa_adquisicion, u.utilidad, u.marca_utilidad
               from movimiento m left join movimiento_utilidad u on u.movimiento_id = m.id
              where m.id = any(p_ids) order by m.codigo for update of m loop
      if r.estado <> 'APROBADO' then
        v_omit := v_omit || jsonb_build_object('codigo', r.codigo, 'motivo', 'está ' || lower(r.estado::text)); continue;
      end if;
      if r.marca_utilidad is not null then
        v_omit := v_omit || jsonb_build_object('codigo', r.codigo, 'motivo', 'ya tiene ajuste manual (' || r.marca_utilidad || ')'); continue;
      end if;
      if (select estado from periodo where id = r.periodo_id) = 'CERRADO' and not tiene_permiso('CERRAR_PERIODO') then
        v_omit := v_omit || jsonb_build_object('codigo', r.codigo, 'motivo', 'período ' || r.periodo_id || ' cerrado'); continue;
      end if;
      if p_modo = 'QUITAR' then
        v_tadq := r.monto_destino / r.monto_efectivo; v_valor := r.monto_destino; v_ut := 0;
      else
        v_tadq := r.tasa_adquisicion - p_puntos;
        if v_tadq <= 0 then raise exception 'Restar % puntos deja en % la tasa de adquisición de %: no se aplicó nada', p_puntos, v_tadq, r.codigo; end if;
        v_valor := r.monto_efectivo * v_tadq; v_ut := v_valor - r.monto_destino;
      end if;
      update movimiento_utilidad set tasa_adquisicion = v_tadq, valor_adquisicion = v_valor, utilidad = v_ut,
             marca_utilidad = case when p_modo = 'QUITAR' then 'UTILIDAD N/A' else 'PUNTOS RESTADOS' end,
             puntos_restados = case when p_modo = 'RESTAR' then p_puntos end, motivo_ajuste = btrim(p_motivo),
             ajustado_por = auth.uid(), ajustado_en = now()
       where movimiento_id = r.id;
      v_n := v_n + 1; v_antes := v_antes + r.utilidad; v_despues := v_despues + v_ut;
      v_res := v_res || jsonb_build_object('id', r.id, 'codigo', r.codigo, 'utilidad_antes', r.utilidad, 'utilidad_despues', v_ut,
        'tasa_adq_antes', r.tasa_adquisicion, 'tasa_adq_despues', v_tadq);
    end loop;
    if p_simular then raise exception 'vista previa' using errcode = 'SIMUL'; end if;
  exception when sqlstate 'SIMUL' then null;
  end;
  return jsonb_build_object('simulado', p_simular, 'ajustados', v_n, 'utilidad_antes', v_antes, 'utilidad_despues', v_despues,
    'diferencia', v_despues - v_antes, 'resultados', v_res, 'omitidos', v_omit);
end $$;
revoke execute on function public.ajustar_utilidad(uuid[], text, numeric, text, boolean) from public, anon;
grant execute on function public.ajustar_utilidad(uuid[], text, numeric, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- STW-35 / STW-62: corrección de un aprobado
-- ---------------------------------------------------------------------
alter table public.movimiento
  add column corregido_motivo text,
  add column corregido_por    uuid references public.usuario,
  add column corregido_en     timestamptz;

-- Núcleo (sin permisos ni recálculo de saldos): aplica los cambios a UN movimiento aprobado y recalcula
-- su tasa, monto y utilidad con la fecha + hora nuevas. Devuelve los buckets que hay que recalcular.
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

  update movimiento set fecha_operacion = n.fecha_operacion, modalidad = n.modalidad, moneda_origen = n.moneda_origen,
         moneda_destino = n.moneda_destino, monto_origen = n.monto_origen, contraparte_id = n.contraparte_id,
         monto_efectivo = c.monto_efectivo, tasa_cliente_id = pc.tasa_id, tasa_base = pc.tasa_base, tasa_aplicada = c.tasa_aplicada,
         monto_destino = c.monto_destino, entrada = c.entrada, salida = c.salida, periodo_id = v_periodo,
         corregido_motivo = btrim(p_motivo), corregido_por = auth.uid(), corregido_en = now(), actualizado_en = now()
   where id = m.id;
  update movimiento_utilidad set tasa_utilidad_id = pc.utilidad_id, puntos_utilidad = pc.puntos, ajuste_id = pc.ajuste_id,
         beneficio = pc.beneficio, tasa_adquisicion = v_tadq, valor_adquisicion = v_valor, utilidad = v_ut
   where movimiento_id = m.id;

  return jsonb_build_object('id', m.id, 'codigo', m.codigo,
    'antes', jsonb_build_object('tasa', m.tasa_aplicada, 'monto_destino', m.monto_destino, 'moneda_destino', m.moneda_destino,
                                'modalidad', m.modalidad, 'contraparte_id', m.contraparte_id, 'utilidad', mu.utilidad),
    'despues', jsonb_build_object('tasa', c.tasa_aplicada, 'monto_destino', c.monto_destino, 'moneda_destino', n.moneda_destino,
                                  'modalidad', n.modalidad, 'contraparte_id', n.contraparte_id, 'utilidad', v_ut),
    'buckets', jsonb_build_array(jsonb_build_array(m.contraparte_id, m.moneda_destino, m.modalidad),
                                 jsonb_build_array(n.contraparte_id, n.moneda_destino, n.modalidad)));
end $$;
revoke execute on function public.corregir_uno(uuid, jsonb, text) from public, anon, authenticated;

-- Aplica correcciones a varios y recalcula cada bucket afectado una sola vez. Todo o nada.
create or replace function public.aplicar_correcciones(p_ids uuid[], p_cambios jsonb, p_motivo text, p_confirmar_negativo boolean, p_simular boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v jsonb; v_res jsonb := '[]'; v_buckets jsonb := '[]'; b jsonb; v_rec jsonb; v_recs jsonb := '[]'; v_neg jsonb := '[]';
begin
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escriba el motivo de la corrección'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Seleccione al menos un movimiento'; end if;
  begin
    for r in select id from movimiento where id = any(p_ids) order by aprobado_en, codigo loop
      v := corregir_uno(r.id, p_cambios, p_motivo);
      v_res := v_res || (v - 'buckets');
      for b in select * from jsonb_array_elements(v -> 'buckets') loop
        if not v_buckets @> jsonb_build_array(b) then v_buckets := v_buckets || jsonb_build_array(b); end if;
      end loop;
    end loop;
    for b in select * from jsonb_array_elements(v_buckets) loop
      v_rec := recalcular_saldos_bucket(b ->> 0, b ->> 1, b ->> 2);
      v_recs := v_recs || v_rec;
      if v_rec ->> 'primer_negativo' is not null then v_neg := v_neg || v_rec; end if;
    end loop;
    -- saldo después de la corrección, para mostrarlo en la vista previa
    v_res := (select coalesce(jsonb_agg(e || jsonb_build_object('saldo_post', mv.saldo_post)), '[]')
                from jsonb_array_elements(v_res) e join movimiento mv on mv.id = (e ->> 'id')::uuid);
    if jsonb_array_length(v_neg) > 0 and not coalesce(p_confirmar_negativo, false) and not p_simular then
      raise exception 'SALDO_NEGATIVO: con la corrección, el saldo de % (% · %) queda negativo desde % (%). Marque la confirmación para aplicarla igual',
        v_neg -> 0 ->> 'contraparte_id', v_neg -> 0 ->> 'moneda', lower(v_neg -> 0 ->> 'modalidad'), v_neg -> 0 ->> 'primer_negativo',
        formato_pesos((v_neg -> 0 ->> 'saldo_negativo')::numeric);
    end if;
    if p_simular then raise exception 'vista previa' using errcode = 'SIMUL'; end if;
  exception when sqlstate 'SIMUL' then null;
  end;
  return jsonb_build_object('simulado', p_simular, 'corregidos', jsonb_array_length(v_res), 'resultados', v_res,
    'saldos', v_recs, 'negativos', v_neg);
end $$;
revoke execute on function public.aplicar_correcciones(uuid[], jsonb, text, boolean, boolean) from public, anon, authenticated;

-- STW-35: uno (CORREGIR_MOVIMIENTO)
create or replace function public.corregir_movimiento(p_id uuid, p_cambios jsonb, p_motivo text,
  p_confirmar_negativo boolean default false, p_simular boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not tiene_permiso('CORREGIR_MOVIMIENTO') then raise exception 'No tiene permiso CORREGIR_MOVIMIENTO' using errcode = '42501'; end if;
  return aplicar_correcciones(array[p_id], p_cambios, p_motivo, p_confirmar_negativo, p_simular);
end $$;

-- STW-62: varios a la vez (EDITAR_MOVIMIENTOS_MASIVO, T-10). Solo modalidad y moneda destino.
create or replace function public.corregir_masivo(p_ids uuid[], p_cambios jsonb, p_motivo text,
  p_confirmar_negativo boolean default false, p_simular boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f text;
begin
  if not tiene_permiso('EDITAR_MOVIMIENTOS_MASIVO') then raise exception 'No tiene permiso EDITAR_MOVIMIENTOS_MASIVO' using errcode = '42501'; end if;
  for f in select jsonb_object_keys(p_cambios) loop
    if f not in ('modalidad', 'moneda_destino') then raise exception 'La edición masiva solo cambia modalidad o moneda destino (no %)', f; end if;
  end loop;
  if p_cambios = '{}'::jsonb then raise exception 'Elija qué cambiar'; end if;
  return aplicar_correcciones(p_ids, p_cambios, p_motivo, p_confirmar_negativo, p_simular);
end $$;
revoke execute on function public.corregir_movimiento(uuid, jsonb, text, boolean, boolean), public.corregir_masivo(uuid[], jsonb, text, boolean, boolean) from public, anon;
grant execute on function public.corregir_movimiento(uuid, jsonb, text, boolean, boolean), public.corregir_masivo(uuid[], jsonb, text, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- STW-37: cierre y reapertura de período
-- ---------------------------------------------------------------------
alter table public.periodo
  add column utilidad_total    numeric,
  add column total_movimientos int,
  add column reabierto_motivo  text,
  add column reabierto_por     uuid references public.usuario,
  add column reabierto_en      timestamptz;

create or replace function public.cerrar_periodo(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p periodo; v_ut numeric; v_n int; v_pend int;
begin
  if not tiene_permiso('CERRAR_PERIODO') then raise exception 'No tiene permiso CERRAR_PERIODO' using errcode = '42501'; end if;
  select * into p from periodo where id = p_id for update;
  if not found then raise exception 'El período % no existe', p_id; end if;
  if p.estado = 'CERRADO' then raise exception 'El período % ya está cerrado', p_id; end if;
  if p.fin >= (now() at time zone 'America/Bogota')::date then raise exception 'El período % todavía no ha terminado (termina el %)', p_id, to_char(p.fin, 'DD/MM/YYYY'); end if;
  select coalesce(sum(u.utilidad), 0), count(*) into v_ut, v_n
    from movimiento m join movimiento_utilidad u on u.movimiento_id = m.id where m.estado = 'APROBADO' and m.periodo_id = p_id;
  -- Lo que aún no se aprueba con fecha de ese mes irá al siguiente período abierto (P-10): solo se informa
  select count(*) into v_pend from movimiento
   where estado in ('BORRADOR', 'ENVIADO_OPERADOR', 'VERIFICADO')
     and fecha_operacion at time zone 'America/Bogota' >= p.inicio and fecha_operacion at time zone 'America/Bogota' < p.fin + 1;
  update periodo set estado = 'CERRADO', cerrado_en = now(), cerrado_por = auth.uid(), utilidad_total = v_ut, total_movimientos = v_n
   where id = p_id;
  return jsonb_build_object('periodo', p_id, 'utilidad_total', v_ut, 'movimientos', v_n, 'pendientes_al_siguiente', v_pend);
end $$;

create or replace function public.reabrir_periodo(p_id text, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not es_superadmin() then raise exception 'Solo el superadmin reabre un período' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escriba el motivo de la reapertura'; end if;
  update periodo set estado = 'ABIERTO', reabierto_motivo = btrim(p_motivo), reabierto_por = auth.uid(), reabierto_en = now()
   where id = p_id and estado = 'CERRADO';
  if not found then raise exception 'El período % no está cerrado', p_id; end if;
end $$;
revoke execute on function public.cerrar_periodo(text), public.reabrir_periodo(text, text) from public, anon;
grant execute on function public.cerrar_periodo(text), public.reabrir_periodo(text, text) to authenticated;

-- Resumen por período (pantalla de períodos)
create view public.periodo_resumen with (security_invoker = true) as
select p.id, p.inicio, p.fin, p.estado, p.cerrado_en, p.utilidad_total, p.total_movimientos, p.reabierto_motivo,
       (select count(*) from public.movimiento m where m.periodo_id = p.id and m.estado = 'APROBADO')::int as aprobados,
       (select coalesce(sum(u.utilidad), 0) from public.movimiento m join public.movimiento_utilidad u on u.movimiento_id = m.id
         where m.periodo_id = p.id and m.estado = 'APROBADO') as utilidad_actual
  from public.periodo p;

-- ---------------------------------------------------------------------
-- STW-40: comparación de saldos (= generarResumenSaldos de comparacionSaldos.js)
-- ---------------------------------------------------------------------
create view public.comparacion_saldos with (security_invoker = true) as
select b.contraparte_id, k.nombre, b.moneda, b.modalidad, b.saldo as saldo_bucket,
       coalesce(s.suma, 0) as suma_movimientos, coalesce(s.n, 0)::int as movimientos, u.saldo_post as ultimo_saldo,
       b.saldo - coalesce(s.suma, 0) as diferencia,
       (abs(b.saldo - coalesce(s.suma, 0)) > 0.005 or (u.saldo_post is not null and abs(u.saldo_post - b.saldo) > 0.005)) as descuadrado
  from public.saldo_bucket b
  join public.contraparte k on k.id = b.contraparte_id
  left join lateral (select sum(m.entrada - m.salida) as suma, count(*) as n from public.movimiento m
                      where m.estado = 'APROBADO' and m.contraparte_id = b.contraparte_id and m.moneda_destino = b.moneda and m.modalidad = b.modalidad) s on true
  left join lateral (select m.saldo_post from public.movimiento m
                      where m.estado = 'APROBADO' and m.contraparte_id = b.contraparte_id and m.moneda_destino = b.moneda and m.modalidad = b.modalidad
                      order by m.secuencia_bucket desc limit 1) u on true;

-- ---------------------------------------------------------------------
-- STW-57: resumen operativo por período × cliente × moneda origen (P-29). Solo administración: se apoya en
-- movimiento_utilidad (su RLS). "Puntos" = tasa de adquisición − tasa aplicada (margen por unidad).
-- ---------------------------------------------------------------------
create view public.resumen_operativo with (security_invoker = true) as
select m.periodo_id, m.contraparte_id, k.nombre, m.moneda_origen,
       count(*)::int as operaciones, sum(m.monto_origen) as volumen,
       avg(u.tasa_adquisicion - m.tasa_aplicada) as puntos_promedio, sum(u.utilidad) as utilidad
  from public.movimiento m
  join public.movimiento_utilidad u on u.movimiento_id = m.id
  join public.contraparte k on k.id = m.contraparte_id
 where m.estado = 'APROBADO'
 group by m.periodo_id, m.contraparte_id, k.nombre, m.moneda_origen;

-- ---------------------------------------------------------------------
-- STW-56: negociaciones (NEGOCIACIONES del libro OTROS; sin migración, P-28). Consecutivo NEG- propio (T-14).
-- ---------------------------------------------------------------------
create table public.negociacion (
  id             text primary key,                                   -- 'NEG-00001'
  fecha          date not null,
  periodo        text not null,
  cliente        text not null check (btrim(cliente) <> ''),
  contraparte_id text references public.contraparte,
  moneda         text not null references public.moneda (nombre) on update cascade,
  valor          numeric(20,2) not null check (valor > 0),
  peso           numeric,                                            -- tasa / peso negociado
  utilidad       numeric(20,2),
  responsable    text,
  observacion    text,
  estado         text not null default 'ACTIVO' check (estado in ('ACTIVO', 'ANULADO')),
  anulado_motivo text,
  anulado_por    uuid references public.usuario,
  anulado_en     timestamptz,
  creado_por     uuid references public.usuario default auth.uid(),
  creado_en      timestamptz not null default now(),
  constraint negociacion_anulada_con_motivo check (estado <> 'ANULADO' or btrim(coalesce(anulado_motivo, '')) <> '')
);
create index on public.negociacion (periodo) where estado = 'ACTIVO';

create or replace function public.preparar_negociacion()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  new.cliente := normalizar_texto(new.cliente);
  new.responsable := nullif(normalizar_texto(new.responsable), '');
  new.observacion := nullif(btrim(new.observacion), '');
  new.moneda := normalizar_texto(new.moneda);
  new.periodo := to_char(new.fecha, 'YYYY-MM');
  if new.fecha > (now() at time zone 'America/Bogota')::date + 1 then raise exception 'La fecha está en el futuro'; end if;
  if tg_op = 'INSERT' then
    insert into consecutivo_finanzas (serie) values ('NEG') on conflict do nothing;
    update consecutivo_finanzas set ultimo = ultimo + 1 where serie = 'NEG' returning ultimo into v_n;
    new.id := 'NEG-' || lpad(v_n::text, 5, '0');
    new.estado := 'ACTIVO'; new.creado_por := auth.uid(); new.creado_en := now();
    return new;
  end if;
  if old.estado = 'ANULADO' then raise exception 'La negociación % está anulada', old.id; end if;
  if new.estado <> 'ANULADO' then raise exception 'Una negociación no se edita: anúlela con motivo y regístrela de nuevo'; end if;
  if (to_jsonb(new) - array['estado', 'anulado_motivo', 'anulado_por', 'anulado_en']) <> (to_jsonb(old) - array['estado', 'anulado_motivo', 'anulado_por', 'anulado_en']) then
    raise exception 'Al anular solo cambian el estado y el motivo';
  end if;
  new.anulado_por := auth.uid(); new.anulado_en := now();
  return new;
end $$;
create trigger preparar_negociacion before insert or update on public.negociacion for each row execute function public.preparar_negociacion();
create trigger aud_negociacion after insert or update or delete on public.negociacion for each row execute function public.auditar('id');

alter table public.negociacion enable row level security;
create policy negociacion_leer on public.negociacion for select to authenticated using (public.tiene_permiso('FINANZAS'));
create policy negociacion_crear on public.negociacion for insert to authenticated with check (public.tiene_permiso('FINANZAS'));
create policy negociacion_anular on public.negociacion for update to authenticated
  using (public.tiene_permiso('FINANZAS') and estado = 'ACTIVO') with check (public.tiene_permiso('FINANZAS'));
revoke delete, truncate on public.negociacion from anon, authenticated;
