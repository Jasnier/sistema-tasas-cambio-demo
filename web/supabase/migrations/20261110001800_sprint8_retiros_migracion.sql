-- =====================================================================
-- Sprint 8 — Retiros y migración del historial
--   STW-45  Retiros de la caja de ganancias (hoy registrarRetiroCaja, retiros.js): monto > 0 con decimales (P-20),
--           no mayor que lo disponible; código RET-<prefijo>-0001 propio. Anular = AJUSTE (nada se borra).
--   STW-47  Módulos por cliente: un retiro solo en libros con usa_retiros (P-25). Liquidaciones: segunda etapa (P-19).
--   STW-49 / STW-59  La importación guarda el código original de Sheets (G-, RET-…) en vez de generar uno nuevo.
--   STW-50  Conciliación: cada corrida compara el saldo de cada bucket en la web con el último saldo en Sheets.
-- =====================================================================

-- ---------------------------------------------------------------------
-- STW-45: retiros
-- ---------------------------------------------------------------------
create or replace function public.registrar_retiro(p_libro uuid, p_monto numeric, p_descripcion text)
returns public.caja_ganancia language plpgsql security definer set search_path = public as $$
declare l libro; v_disp numeric; v_n int; c caja_ganancia;
begin
  if not tiene_permiso('REGISTRAR_RETIRO') then raise exception 'No tiene permiso REGISTRAR_RETIRO' using errcode = '42501'; end if;
  select * into l from libro where id = p_libro for update;              -- un retiro a la vez por cliente
  if not found or not puede_ver_ganancias(p_libro) then raise exception 'No puede registrar retiros en ese libro' using errcode = '42501'; end if;
  if not l.usa_retiros then raise exception '% no tiene activados los retiros (Configuración → Clientes grandes)', l.nombre; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'El monto del retiro debe ser mayor que cero'; end if;
  if p_monto <> round(p_monto, 2) then raise exception 'El monto admite máximo 2 decimales'; end if;
  select coalesce(sum(entrada - salida), 0) into v_disp from caja_ganancia where libro_id = p_libro;
  if p_monto > v_disp then
    raise exception 'Saldo insuficiente en la caja: disponible %, retiro %', formato_pesos(v_disp), formato_pesos(p_monto);
  end if;
  insert into consecutivo_finanzas (serie) values ('RET-' || l.prefijo) on conflict do nothing;
  update consecutivo_finanzas set ultimo = ultimo + 1 where serie = 'RET-' || l.prefijo returning ultimo into v_n;
  insert into caja_ganancia (libro_id, codigo, tipo, descripcion, salida)
  values (l.id, 'RET-' || l.prefijo || '-' || lpad(v_n::text, 4, '0'), 'RETIRO', nullif(btrim(coalesce(p_descripcion, '')), ''), p_monto)
  returning * into c;
  return c;
end $$;

-- Anular un retiro mal registrado: no se borra, entra un AJUSTE por el mismo valor (solo administración)
create or replace function public.anular_retiro(p_codigo text, p_motivo text)
returns public.caja_ganancia language plpgsql security definer set search_path = public as $$
declare r caja_ganancia; c caja_ganancia;
begin
  if not tiene_permiso('APROBAR_MOVIMIENTO') then raise exception 'Solo la administración anula retiros' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escriba el motivo de la anulación'; end if;
  select * into r from caja_ganancia where codigo = p_codigo and tipo = 'RETIRO' for update;
  if not found then raise exception 'El retiro % no existe', p_codigo; end if;
  if exists (select 1 from caja_ganancia where codigo = 'ANU-' || p_codigo) then raise exception 'El retiro % ya está anulado', p_codigo; end if;
  insert into caja_ganancia (libro_id, codigo, tipo, descripcion, entrada)
  values (r.libro_id, 'ANU-' || p_codigo, 'AJUSTE', 'Anulación de ' || p_codigo || ': ' || btrim(p_motivo), r.salida)
  returning * into c;
  return c;
end $$;
revoke execute on function public.registrar_retiro(uuid, numeric, text), public.anular_retiro(text, text) from public, anon;
grant execute on function public.registrar_retiro(uuid, numeric, text), public.anular_retiro(text, text) to authenticated;

-- El tablero cuenta como "retirado" lo neto de retiros y sus anulaciones
create or replace view public.caja_ganancia_resumen with (security_invoker = true) as
select l.id as libro_id, l.nombre, l.prefijo,
       coalesce(sum(c.entrada - c.salida) filter (where c.tipo <> 'RETIRO' and c.codigo not like 'ANU-RET-%'), 0) as utilidad_total,
       coalesce(sum(c.salida - c.entrada) filter (where c.tipo = 'RETIRO' or c.codigo like 'ANU-RET-%'), 0) as total_retirado,
       coalesce(sum(c.entrada - c.salida), 0) as disponible,
       count(*) filter (where c.tipo = 'UTILIDAD')::int as operaciones,
       count(*) filter (where c.tipo = 'RETIRO')::int as retiros,
       max(c.fecha) as ultimo_movimiento,
       l.usa_retiros
  from public.libro l left join public.caja_ganancia c on c.libro_id = l.id
 where l.usa_ganancias
 group by l.id, l.nombre, l.prefijo, l.usa_retiros;

-- ---------------------------------------------------------------------
-- STW-59: al importar (sin usuario de la app) se conserva el código G- de Sheets
-- ---------------------------------------------------------------------
create or replace function public.preparar_gasto()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  new.tipo := normalizar_texto(new.tipo);
  new.proveedor := nullif(btrim(new.proveedor), '');
  new.descripcion := nullif(btrim(new.descripcion), '');
  new.tipo_abono := nullif(normalizar_texto(new.tipo_abono), '');
  new.oficina := nullif(normalizar_texto(new.oficina), '');
  new.periodo := to_char(new.fecha, 'YYYY-MM');
  if new.fecha > (now() at time zone 'America/Bogota')::date + 1 then raise exception 'La fecha del gasto está en el futuro'; end if;
  if tg_op = 'INSERT' then
    if auth.uid() is null and new.id is not null then          -- importación: conserva el código de Sheets
      new.estado := coalesce(new.estado, 'ACTIVO');
      return new;
    end if;
    insert into consecutivo_finanzas (serie) values ('G') on conflict do nothing;
    update consecutivo_finanzas set ultimo = ultimo + 1 where serie = 'G' returning ultimo into v_n;
    new.id := 'G-' || lpad(v_n::text, 4, '0');
    new.estado := 'ACTIVO';
    new.creado_por := auth.uid();
    new.creado_en := now();
    return new;
  end if;
  if old.estado = 'ANULADO' then raise exception 'El gasto % está anulado', old.id; end if;
  if new.estado <> 'ANULADO' then raise exception 'Un gasto no se edita: anúlelo con motivo y regístrelo de nuevo'; end if;
  if (to_jsonb(new) - array['estado', 'anulado_motivo', 'anulado_por', 'anulado_en']) <> (to_jsonb(old) - array['estado', 'anulado_motivo', 'anulado_por', 'anulado_en']) then
    raise exception 'Al anular solo cambian el estado y el motivo';
  end if;
  new.anulado_por := auth.uid();
  new.anulado_en := now();
  return new;
end $$;

-- Datos de la migración en cada movimiento (docs/web/05 §Movimientos: codigo_origen, orden_origen, fuente_migracion ya existen)
alter table public.movimiento add column importado_en timestamptz;

-- ---------------------------------------------------------------------
-- STW-50: conciliación de saldos web vs Sheets (una corrida por exportación)
-- ---------------------------------------------------------------------
create table public.conciliacion_corrida (
  id            bigint generated always as identity primary key,
  creada_en     timestamptz not null default now(),
  fuente        text not null,                    -- nombre del export de Sheets
  corte_sheets  timestamptz,                      -- cuándo se generó ese export
  buckets       int not null default 0,
  con_diferencia int not null default 0,
  creada_por    uuid references public.usuario default auth.uid()
);
create table public.conciliacion_saldo (
  corrida_id     bigint not null references public.conciliacion_corrida on delete cascade,
  contraparte_id text not null,
  moneda         text not null,
  modalidad      text not null,
  saldo_sheets   numeric(20,2),                   -- último saldo del bucket en MOVIMIENTOS (orden físico)
  saldo_web      numeric(20,2),
  movimientos_sheets int,
  movimientos_web    int,
  diferencia     numeric(20,2) generated always as (coalesce(saldo_web, 0) - coalesce(saldo_sheets, 0)) stored,
  primary key (corrida_id, contraparte_id, moneda, modalidad)
);
alter table public.conciliacion_corrida enable row level security;
alter table public.conciliacion_saldo enable row level security;
create policy conciliacion_corrida_leer on public.conciliacion_corrida for select to authenticated using (public.tiene_permiso('APROBAR_MOVIMIENTO'));
create policy conciliacion_saldo_leer on public.conciliacion_saldo for select to authenticated using (public.tiene_permiso('APROBAR_MOVIMIENTO'));
revoke insert, update, delete, truncate on public.conciliacion_corrida, public.conciliacion_saldo from anon, authenticated;
