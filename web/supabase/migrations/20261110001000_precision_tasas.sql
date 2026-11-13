-- =====================================================================
-- Precisión de las tasas cliente.
-- numeric(20,6) redondeaba las tasas inversas del CORE (COP→SOL 0.0009182736455463728 → 0.000918):
-- hasta 0,125 % de error por conversión, comprobado al importar el CORE (111 de 5.050 muestras).
-- Ahora valor es numeric sin escala fija: guarda exactamente lo que trae el CORE.
-- =====================================================================
alter table public.tasa_cliente alter column valor type numeric;

-- Misma regla de 0600 + una excepción estrecha: SOLO la importación (sin usuario de la app) puede
-- devolverle decimales a una tasa cerrada si redondeada a 6 decimales es el mismo valor guardado.
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
    if tg_table_name = 'tasa_cliente' and current_user not in ('authenticated', 'anon')
       and (to_jsonb(new) - 'valor') = (to_jsonb(old) - 'valor')
       and new.valor <> old.valor and round(new.valor, 6) = round(old.valor, 6) then
      return new;  -- importación: restaurar decimales, mismo valor a 6 decimales
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
