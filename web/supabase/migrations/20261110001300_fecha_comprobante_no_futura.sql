-- =====================================================================
-- STW-17: un comprobante no puede tener fecha en el futuro.
-- Al comparar con la hoja real de Paula (CORA ALFA, filas 968–1043) aparecieron 76 comprobantes del
-- 3-nov-2026 escritos como 3-dic-2026 (el id PIX dice 20261103). La hoja no lo nota porque suma en orden
-- de filas; la web suma por fecha y el saldo del día queda mal. Se rechaza al cargar: hasta 1 día adelante
-- (hora de Bogotá) para no estorbar a quien carga justo después de medianoche.
-- =====================================================================
create or replace function public.validar_fecha_comprobante()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.fecha > (now() at time zone 'America/Bogota')::date + 1 then
    raise exception 'La fecha % está en el futuro: revise el día y el mes', to_char(new.fecha, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger validar_fecha_comprobante before insert or update of fecha on public.comprobante_brasil
  for each row execute function public.validar_fecha_comprobante();
