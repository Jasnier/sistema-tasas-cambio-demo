-- =====================================================================
-- RLS rápido con datos reales. Las políticas llamaban a tiene_permiso(), puede_ver_libro(libro_id), etc. EN CADA FILA:
-- con los 34 mil movimientos de Sheets, un conteo de 220 pendientes tardaba 16 s y Supabase lo cortaba a los 8 s
-- (statement_timeout del rol authenticated) → páginas vacías.
--
-- Arreglo (recomendación de Supabase para RLS): las llamadas que NO dependen de la fila van envueltas en (select …), y
-- Postgres las calcula UNA vez por consulta (InitPlan). Las que dependen de la fila se reescriben como
-- "columna = any(<lista calculada una vez>)". Las reglas de quién ve qué son EXACTAMENTE las mismas; solo cambia cómo
-- se evalúan. Las funciones por fila (puede_ver_libro, puede_ver_ct, …) se conservan: las usan RPCs y pruebas.
-- =====================================================================

-- Libros en los que el usuario está asignado (libro_usuario)
create or replace function public.mis_libros(uid uuid default auth.uid())
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(lu.libro_id), '{}') from libro_usuario lu where lu.usuario_id = uid;
$$;

-- Libros que ve (sin contar administración): los suyos y los de cliente grande de los operadores que tiene
create or replace function public.libros_visibles(uid uuid default auth.uid())
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct l.id), '{}') from libro l
   where l.id = any(public.mis_libros(uid)) or l.operador_id = any(public.mis_libros(uid));
$$;

-- Códigos CT de los libros de cliente grande del usuario (portal)
create or replace function public.mis_contrapartes(uid uuid default auth.uid())
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct l.contraparte_id) filter (where l.contraparte_id is not null), '{}')
    from libro l join libro_usuario lu on lu.libro_id = l.id
   where l.tipo = 'cliente_grande' and lu.usuario_id = uid;
$$;

-- Clientes con algún movimiento (no anulado ni rechazado) en los libros que ve: la parte "operador" de puede_ver_ct
create or replace function public.cts_de_mis_libros(uid uuid default auth.uid())
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct m.contraparte_id), '{}') from movimiento m
   where m.libro_id = any(public.libros_visibles(uid)) and m.estado not in ('ANULADO', 'RECHAZADO')
     and m.contraparte_id is not null;
$$;

revoke all on function public.mis_libros(uuid), public.libros_visibles(uuid), public.mis_contrapartes(uuid),
  public.cts_de_mis_libros(uuid) from public, anon;
grant execute on function public.mis_libros(uuid), public.libros_visibles(uuid), public.mis_contrapartes(uuid),
  public.cts_de_mis_libros(uuid) to authenticated, service_role;

-- Reescribe TODAS las políticas del esquema public con las mismas reglas, evaluadas una vez por consulta
do $$
declare
  p record;
  q text; c text;
  function_libro text := $r$((SELECT tiene_permiso('APROBAR_MOVIMIENTO'::text)) OR (\1 = ANY ((SELECT libros_visibles())::uuid[])))$r$;
begin
  for p in
    select pol.polname, cl.relname, pg_get_expr(pol.polqual, pol.polrelid) as qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) as chk
      from pg_policy pol join pg_class cl on cl.oid = pol.polrelid join pg_namespace n on n.oid = cl.relnamespace
     where n.nspname = 'public'
  loop
    q := p.qual; c := p.chk;
    -- Ya reescrita (la migración se puede volver a correr sin envolver dos veces)
    if coalesce(q, '') ~* 'select (tiene_permiso|auth\.uid|libros_visibles|mis_)' or coalesce(c, '') ~* 'select (tiene_permiso|auth\.uid|libros_visibles|mis_)' then
      continue;
    end if;
    for i in 1..2 loop
      declare e text := case i when 1 then q else c end;
      begin
        if e is null then continue; end if;
        -- 1) Las que no dependen de la fila → (select …): tiene_permiso('X') y auth.uid()
        e := regexp_replace(e, 'tiene_permiso\(''([A-Z_]+)''::text\)', '(SELECT tiene_permiso(''\1''::text))', 'g');
        e := regexp_replace(e, 'auth\.uid\(\)', '(SELECT auth.uid())', 'g');
        -- 2) Las que dependen de la fila → columna = any(lista calculada una vez), ya con los permisos envueltos
        e := regexp_replace(e, 'puede_ver_libro\(([a-z_]+)\)', function_libro, 'g');
        e := regexp_replace(e, 'puede_ver_ganancias\(([a-z_]+)\)',
               $r$((SELECT tiene_permiso('VER_GANANCIAS'::text)) AND ((SELECT tiene_permiso('APROBAR_MOVIMIENTO'::text)) OR (\1 = ANY ((SELECT mis_libros())::uuid[]))))$r$, 'g');
        e := regexp_replace(e, 'puede_ver_ct\(([a-z_]+)\)',
               $r$((SELECT tiene_permiso('APROBAR_MOVIMIENTO'::text)) OR (\1 = ANY ((SELECT mis_contrapartes())::text[])) OR ((SELECT tiene_permiso('VER_REPORTES'::text)) AND (\1 = ANY ((SELECT cts_de_mis_libros())::text[]))))$r$, 'g');
        e := regexp_replace(e, 'es_mi_contraparte\(([a-z_]+)\)', $r$(\1 = ANY ((SELECT mis_contrapartes())::text[]))$r$, 'g');
        if i = 1 then q := e; else c := e; end if;
      end;
    end loop;
    if q is distinct from p.qual or c is distinct from p.chk then
      execute format('alter policy %I on public.%I', p.polname, p.relname)
           || case when q is not null then format(' using (%s)', q) else '' end
           || case when c is not null then format(' with check (%s)', c) else '' end;
    end if;
  end loop;
end $$;

-- El contador de pendientes de cada página filtra por estado (sin libro): índice propio
create index if not exists movimiento_estado_id on public.movimiento (estado, id);
