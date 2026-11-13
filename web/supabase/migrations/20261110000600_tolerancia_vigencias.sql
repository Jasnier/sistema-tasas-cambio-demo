-- =====================================================================
-- Corrección: cerrar una tasa o un beneficio "desde ahora" no debe contar como "cerrar al pasado".
-- El "ahora" que envía la app llega unos milisegundos antes que now() de la transacción, y la regla
-- (solo superadmin acorta al pasado) bloqueaba a la administradora al cambiar o terminar un beneficio.
-- Se da una tolerancia de 5 minutos: más atrás que eso sí es "pasado" y sigue siendo solo del superadmin.
-- =====================================================================

create or replace function public.margen_pasado()
returns interval language sql immutable as $$ select interval '5 minutes' $$;

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
    if upper(new.vigencia) < upper(old.vigencia) and upper(new.vigencia) < now() - margen_pasado() and not es_superadmin() then
      raise exception 'Solo el superadmin puede acortar al pasado la vigencia de una tasa cerrada (afecta operaciones ya hechas)';
    end if;
  elsif new.estado = 'CERRADO' and current_user in ('authenticated', 'anon') then
    raise exception 'Para publicar una tasa use "cerrar" (valida solapamientos)';
  end if;
  return new;
end $$;

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
  if upper(new.vigencia) < upper(old.vigencia) and upper(new.vigencia) < now() - margen_pasado() and not es_superadmin() then
    raise exception 'Solo el superadmin puede cerrar al pasado un ajuste (afecta operaciones ya hechas)';
  end if;
  return new;
end $$;
