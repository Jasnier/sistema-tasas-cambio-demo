-- =====================================================================
-- STW-32: notificaciones en tiempo real. Las bandejas (Movimientos, Aprobación y el portal del cliente)
-- escuchan los cambios de la tabla movimiento con Supabase Realtime y se actualizan solas.
--
-- Realtime solo entrega un cambio a quien puede LEER esa fila (aplica la RLS de movimiento_leer con la sesión
-- de cada quien): el operador recibe lo de sus libros, el cliente grande lo de su libro y la administración todo.
-- Por eso no hace falta ningún filtro extra aquí. La utilidad vive en movimiento_utilidad, que NO se publica.
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'movimiento') then
    alter publication supabase_realtime add table public.movimiento;
  end if;
end $$;
