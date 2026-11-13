-- =====================================================================
-- Bandeja Brasil, pestaña "Apropiados" (pedido de Jasnier, 2026-11-11): quién apropió cada comprobante.
-- La tabla usuario solo deja leer el propio nombre (usuario_leer); en vez de abrirla, esta función devuelve el
-- nombre SOLO de quienes aparecen como apropiado_por en comprobante_brasil, y solo a quien trabaja con Brasil.
-- =====================================================================
create or replace function public.apropiadores_brasil()
returns table (id uuid, nombre text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (tiene_permiso('BRASIL_APROPIAR') or tiene_permiso('BRASIL_CARGAR') or tiene_permiso('APROBAR_MOVIMIENTO')) then
    raise exception 'No tiene permiso' using errcode = '42501';
  end if;
  return query
    select u.id, coalesce(nullif(btrim(u.nombre), ''), u.correo)
      from usuario u
     where u.id in (select distinct c.apropiado_por from comprobante_brasil c where c.apropiado_por is not null)
     order by 2;
end $$;
revoke execute on function public.apropiadores_brasil() from public, anon;
grant execute on function public.apropiadores_brasil() to authenticated;

create index if not exists comprobante_brasil_apropiado on public.comprobante_brasil (apropiado_en desc)
  where estado = 'APLICADO';
