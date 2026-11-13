-- =====================================================================
-- STW-12: catálogos del CORE (docs/web/05 §Catálogos, docs/web/02 §1.7)
-- Monedas, modalidades, empresas, recibido_en, contrapartes, bancos Brasil.
-- Depende de: 0100_seguridad (tiene_permiso), 0200_auditoria (auditar), 0300_libros (libro).
-- Reglas: nada se borra (se desactiva con activo = false); textos normalizados (T-6).
-- =====================================================================

-- ---------------------------------------------------------------------
-- T-6: normalización de textos. Hoy el Motor compara exacto, con trim o en
-- mayúsculas según el script, y los catálogos traen " TRUE" con espacio.
-- En la web todo identificador y nombre de catálogo se guarda en MAYÚSCULAS,
-- sin espacios al borde y con un solo espacio interno.
-- ---------------------------------------------------------------------
create or replace function public.normalizar_texto(t text)
returns text language sql immutable as $$
  select nullif(upper(regexp_replace(btrim(t), '\s+', ' ', 'g')), '');
$$;

create or replace function public.normalizar_catalogo()
returns trigger language plpgsql as $$
begin
  new.id := public.normalizar_texto(new.id);
  new.nombre := public.normalizar_texto(new.nombre);
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
create table public.moneda (
  id        text primary key,                  -- id del CORE (MONEDAS!A)
  nombre    text not null unique,              -- 'COP', 'USD', 'SOL', 'REAL'… (lo usan tasas y movimientos)
  activo    boolean not null default true,
  orden     int,
  creado_en timestamptz not null default now()
);

-- P-6: solo dos modalidades. No se editan desde la app.
create table public.modalidad (
  id text primary key check (id in ('EFECTIVO', 'TRANSFERENCIA'))
);
insert into public.modalidad (id) values ('EFECTIVO'), ('TRANSFERENCIA');

create table public.empresa (
  id        text primary key,
  nombre    text not null,
  activo    boolean not null default true,
  orden     int,
  creado_en timestamptz not null default now()
);

-- P-4 / P-36: descuento fijo por "recibido en" (AGENTE BCP = 15), solo para la moneda indicada (SOL).
create table public.recibido_en (
  id               text primary key,
  nombre           text not null,
  activo           boolean not null default true,
  orden            int,
  descuento_fijo   numeric(20,2) not null default 0 check (descuento_fijo >= 0),
  descuento_moneda text references public.moneda (nombre) on update cascade,  -- null = cualquier moneda
  creado_en        timestamptz not null default now()
);

create type public.tipo_contraparte as enum ('CLIENTE', 'ALIADO');

create table public.contraparte (
  id        text primary key check (id ~ '^CT-[0-9]+$'),   -- 'CT-69'; el saldo se agrupa por código (P-32)
  tipo      public.tipo_contraparte not null,
  nombre    text not null,
  activo    boolean not null default true,
  creado_en timestamptz not null default now()
);

-- P-17 (pendiente): la lista oficial de bancos se carga cuando Mariana la entregue.
create table public.banco_brasil (
  id        text primary key,
  nombre    text not null unique,
  activo    boolean not null default true,
  orden     int,
  creado_en timestamptz not null default now()
);

-- libro.contraparte_id (migración 0300) apunta ahora al catálogo
alter table public.libro
  add constraint libro_contraparte_fk foreign key (contraparte_id) references public.contraparte (id);

-- ---------------------------------------------------------------------
-- Normalización, auditoría y RLS (iguales para todos los catálogos editables)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['moneda', 'empresa', 'recibido_en', 'contraparte', 'banco_brasil'] loop
    execute format('create trigger norm_%1$s before insert or update on public.%1$I
                    for each row execute function public.normalizar_catalogo()', t);
    execute format('create trigger aud_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.auditar(''id'')', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %1$s_leer on public.%1$I for select to authenticated using (true)', t);
    execute format('create policy %1$s_crear on public.%1$I for insert to authenticated
                    with check (public.tiene_permiso(''GESTIONAR_CATALOGOS''))', t);
    execute format('create policy %1$s_editar on public.%1$I for update to authenticated
                    using (public.tiene_permiso(''GESTIONAR_CATALOGOS''))
                    with check (public.tiene_permiso(''GESTIONAR_CATALOGOS''))', t);
    -- sin política de delete: nadie borra desde la app (se desactiva)
  end loop;
end $$;

alter table public.modalidad enable row level security;
create policy modalidad_leer on public.modalidad for select to authenticated using (true);

-- recibido_en.descuento_moneda y moneda.nombre se normalizan igual
create or replace function public.normalizar_recibido_moneda()
returns trigger language plpgsql as $$
begin
  new.descuento_moneda := public.normalizar_texto(new.descuento_moneda);
  return new;
end $$;
create trigger norm_recibido_moneda before insert or update on public.recibido_en
  for each row execute function public.normalizar_recibido_moneda();

-- ---------------------------------------------------------------------
-- P-4 / P-36: descuento fijo que aplica a un movimiento (lo usará calcular_movimiento, STW-28)
-- ---------------------------------------------------------------------
create or replace function public.descuento_recibido(p_recibido_en text, p_moneda_origen text)
returns numeric language sql stable as $$
  select coalesce((
    select r.descuento_fijo from public.recibido_en r
    where r.id = public.normalizar_texto(p_recibido_en)
      and (r.descuento_moneda is null or r.descuento_moneda = public.normalizar_texto(p_moneda_origen))
  ), 0);
$$;
