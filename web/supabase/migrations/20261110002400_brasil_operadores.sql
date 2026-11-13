-- =====================================================================
-- Brasil para los operadores (pedido del usuario, 2026-11-11). Como el libro "Brasil Operadores" de Sheets:
-- los operadores (Laura, Santiago) ven la bandeja con lo que Paula va cargando, toman y apropian los
-- comprobantes, y ven la conciliación. Antes solo lo tenían el rol brasil_operador y la administración.
--
-- Con BRASIL_APROPIAR la RLS de comprobante_brasil (0900) ya les deja leer los comprobantes. Cargar
-- (BRASIL_CARGAR) sigue siendo solo de Paula.
--
-- Libros destino: la política libro_leer_brasil (1100) dejaba LEER TODA la tabla libro a quien apropia. Con
-- los operadores eso es una fuga (P-1: el operador solo ve su libro y sus clientes grandes; en Movimientos y
-- Registrar verían los libros de los demás). Se reemplaza por una función que devuelve solo lo necesario
-- para elegir el destino (id, prefijo, nombre, tipo), y solo a quien apropia.
--
-- Además, la bandeja se actualiza sola (Supabase Realtime, como STW-32 con movimiento): en la web no hay
-- "llamado" a la bandeja; cada comprobante que Paula guarda ya está en ella, y quien la tenga abierta lo
-- ve aparecer sin recargar. Realtime solo entrega lo que cada quien puede leer (RLS).
-- =====================================================================
insert into public.rol_permiso (rol_id, permiso) values ('operador', 'BRASIL_APROPIAR')
on conflict do nothing;

drop policy if exists libro_leer_brasil on public.libro;

create or replace function public.libros_destino_brasil()
returns table (id uuid, codigo text, prefijo text, nombre text, tipo text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not tiene_permiso('BRASIL_APROPIAR') then raise exception 'No tiene permiso BRASIL_APROPIAR' using errcode = '42501'; end if;
  return query
    select l.id, l.codigo, l.prefijo, l.nombre, l.tipo::text from libro l
     where l.activo and l.tipo in ('operador', 'cliente_grande')
     order by l.tipo desc, l.nombre;
end $$;
revoke execute on function public.libros_destino_brasil() from public, anon;
grant execute on function public.libros_destino_brasil() to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comprobante_brasil') then
    alter publication supabase_realtime add table public.comprobante_brasil;
  end if;
end $$;
