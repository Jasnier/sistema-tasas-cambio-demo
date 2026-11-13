-- =====================================================================
-- Libros: quién origina movimientos (operador, cliente grande, Brasil)
-- docs/web/05 §Libros, P-1, P-25
-- =====================================================================
create type public.tipo_libro as enum ('operador', 'cliente_grande', 'brasil');

create table public.libro (
  id                 uuid primary key default gen_random_uuid(),
  tipo               public.tipo_libro not null,
  codigo             text not null unique,          -- = libro_origen actual: 'OPERADOR_LAURA', 'COMNORTE'…
  prefijo            text not null unique check (prefijo ~ '^[A-Z]{2,5}$'),
  nombre             text not null,
  operador_id        uuid references public.libro,  -- P-1: cliente grande → operador (un operador, varios clientes)
  contraparte_id     text,                          -- CT-nn (FK al catálogo en la migración de catálogos)
  usa_ganancias      boolean not null default false, -- P-25: activable por la administradora
  usa_retiros        boolean not null default false,
  activo             boolean not null default true,
  creado_en          timestamptz not null default now(),
  constraint operador_solo_en_clientes check (operador_id is null or tipo = 'cliente_grande')
);

create table public.libro_usuario (
  libro_id   uuid not null references public.libro on delete cascade,
  usuario_id uuid not null references public.usuario on delete cascade,
  primary key (libro_id, usuario_id)
);

-- Consecutivo sin carreras: LN-0001, CN-0001… (STW-6 / STW-22)
create table public.consecutivo (
  libro_id uuid primary key references public.libro on delete cascade,
  ultimo   int not null default 0
);

create or replace function public.siguiente_codigo(p_libro uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_n int; v_prefijo text;
begin
  insert into consecutivo (libro_id) values (p_libro) on conflict do nothing;
  update consecutivo set ultimo = ultimo + 1 where libro_id = p_libro returning ultimo into v_n;
  select prefijo into v_prefijo from libro where id = p_libro;
  return v_prefijo || '-' || lpad(v_n::text, 4, '0');
end $$;
revoke execute on function public.siguiente_codigo(uuid) from anon, authenticated;

-- ¿El usuario pertenece a este libro (o a un cliente de su operador)?
create or replace function public.puede_ver_libro(p_libro uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.tiene_permiso('APROBAR_MOVIMIENTO', uid)          -- administración ve todos los libros
      or exists (select 1 from libro_usuario lu where lu.usuario_id = uid and lu.libro_id = p_libro)
      or exists (select 1 from libro c join libro_usuario lu on lu.libro_id = c.operador_id
                 where c.id = p_libro and lu.usuario_id = uid);
$$;

alter table public.libro         enable row level security;
alter table public.libro_usuario enable row level security;
alter table public.consecutivo   enable row level security;

create policy libro_leer on public.libro for select to authenticated using (public.puede_ver_libro(id));
create policy libro_escribir on public.libro for all to authenticated
  using (public.tiene_permiso('GESTIONAR_CATALOGOS')) with check (public.tiene_permiso('GESTIONAR_CATALOGOS'));
create policy libro_usuario_leer on public.libro_usuario for select to authenticated
  using (usuario_id = auth.uid() or public.tiene_permiso('GESTIONAR_USUARIOS'));
create policy libro_usuario_escribir on public.libro_usuario for all to authenticated
  using (public.tiene_permiso('GESTIONAR_USUARIOS')) with check (public.tiene_permiso('GESTIONAR_USUARIOS'));

create trigger aud_libro         after insert or update or delete on public.libro         for each row execute function public.auditar('id');
create trigger aud_libro_usuario after insert or update or delete on public.libro_usuario for each row execute function public.auditar('usuario_id');

-- Libros activos (docs/web/01). Contrapartes y operador de cada cliente: se completan al migrar (P-1).
insert into public.libro (tipo, codigo, prefijo, nombre, usa_ganancias, usa_retiros) values
  ('operador',       'OPERADOR_LAURA',      'LN',   'Laura',             false, false),
  ('operador',       'OPERADOR_SANTIAGO', 'SB',   'Santiago',        false, false),
  ('brasil',         'BRASIL',             'BRS',  'Brasil',           false, false),
  ('cliente_grande', 'COMNORTE',             'CN',   'Comnorte',           false, false),
  ('cliente_grande', 'SURCARIBE',        'SCR',  'Surcaribe',      false, false),
  ('cliente_grande', 'JULIAN_GOMEZ',          'JG',   'Julián Gómez',        false, false),
  ('cliente_grande', 'TURISMOJG',         'TJG',  'TurismoJG',       false, false),
  ('cliente_grande', 'GLOBAL_BRIDGE',   'GBC',  'Global Bridge', false, false),
  ('cliente_grande', 'DIANA',            'DN',   'Diana',          false, false),
  ('cliente_grande', 'JARAMILLO',            'JMZ',  'Jaramillo',          false, false),
  ('cliente_grande', 'VALERIA_ROJAS',     'VRJ', 'Valeria Rojas',   true,  true),
  ('cliente_grande', 'LUCAS_ALZATE',      'LAZ',  'Lucas Alzate',    true,  true);

-- ---------------------------------------------------------------------
-- Alta automática del perfil cuando se crea un usuario en Auth
-- ---------------------------------------------------------------------
create or replace function public.crear_perfil_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.usuario (id, correo, nombre)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.crear_perfil_usuario();
