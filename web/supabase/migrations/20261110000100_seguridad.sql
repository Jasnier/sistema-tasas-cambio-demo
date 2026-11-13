-- =====================================================================
-- STW-9 / STW-10: usuarios, roles y permisos (docs/web/04 y 05, P-22, P-30)
-- =====================================================================
create extension if not exists btree_gist;

create table public.rol (
  id          text primary key,
  nombre      text not null,
  descripcion text
);

create table public.permiso (
  codigo          text primary key,
  descripcion     text not null,
  solo_superadmin boolean not null default false   -- no se puede asignar ni delegar
);

create table public.rol_permiso (
  rol_id  text not null references public.rol on delete cascade,
  permiso text not null references public.permiso on delete cascade,
  primary key (rol_id, permiso)
);

create table public.usuario (
  id        uuid primary key references auth.users on delete cascade,
  correo    text not null unique,
  nombre    text not null,
  activo    boolean not null default true,
  creado_en timestamptz not null default now()
);

create table public.usuario_rol (
  usuario_id uuid not null references public.usuario on delete cascade,
  rol_id     text not null references public.rol on delete cascade,
  primary key (usuario_id, rol_id)
);

-- P-30: la administradora puede ceder un permiso a una persona concreta
create table public.usuario_permiso (
  usuario_id    uuid not null references public.usuario on delete cascade,
  permiso       text not null references public.permiso on delete cascade,
  otorgado_por  uuid references public.usuario,
  otorgado_en   timestamptz not null default now(),
  primary key (usuario_id, permiso)
);

-- ---------------------------------------------------------------------
-- Funciones de autorización (security definer: no dependen de RLS)
-- ---------------------------------------------------------------------
create or replace function public.es_superadmin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from usuario_rol ur join usuario u on u.id = ur.usuario_id
    where ur.usuario_id = uid and ur.rol_id = 'superadmin' and u.activo
  );
$$;

create or replace function public.tiene_permiso(codigo text, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_superadmin(uid) or exists (
    select 1 from usuario u
    where u.id = uid and u.activo and (
      exists (select 1 from usuario_rol ur join rol_permiso rp on rp.rol_id = ur.rol_id
              where ur.usuario_id = uid and rp.permiso = codigo)
      or exists (select 1 from usuario_permiso up where up.usuario_id = uid and up.permiso = codigo)
    )
  );
$$;

create or replace function public.mis_permisos()
returns setof text language sql stable security definer set search_path = public as $$
  select p.codigo from permiso p where public.tiene_permiso(p.codigo);
$$;

-- Nadie, salvo el superadmin, asigna o delega permisos "solo_superadmin" ni el rol superadmin
create or replace function public.proteger_superadmin()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_permiso text; v_rol text;
begin
  -- Solo se controla a los usuarios de la aplicación; migraciones, semillas y service_role pasan
  if coalesce(auth.role(), '') <> 'authenticated' then
    return new;
  end if;
  if tg_table_name = 'usuario_rol' then
    v_rol := new.rol_id;
    if v_rol = 'superadmin' and not public.es_superadmin() then
      raise exception 'Solo el superadmin puede asignar el rol superadmin';
    end if;
    return new;
  end if;
  v_permiso := new.permiso;
  if (select solo_superadmin from permiso where codigo = v_permiso) and not public.es_superadmin() then
    raise exception 'El permiso % solo puede tenerlo el superadmin', v_permiso;
  end if;
  return new;
end $$;

create trigger trg_proteger_rol_permiso   before insert or update on public.rol_permiso     for each row execute function public.proteger_superadmin();
create trigger trg_proteger_usuario_perm  before insert or update on public.usuario_permiso for each row execute function public.proteger_superadmin();
create trigger trg_proteger_usuario_rol   before insert or update on public.usuario_rol     for each row execute function public.proteger_superadmin();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.rol             enable row level security;
alter table public.permiso         enable row level security;
alter table public.rol_permiso     enable row level security;
alter table public.usuario         enable row level security;
alter table public.usuario_rol     enable row level security;
alter table public.usuario_permiso enable row level security;

create policy rol_leer        on public.rol         for select to authenticated using (true);
create policy permiso_leer    on public.permiso     for select to authenticated using (true);
create policy rol_permiso_leer on public.rol_permiso for select to authenticated using (true);
create policy rol_permiso_escribir on public.rol_permiso for all to authenticated
  using (public.tiene_permiso('GESTIONAR_ROLES')) with check (public.tiene_permiso('GESTIONAR_ROLES'));

create policy usuario_leer on public.usuario for select to authenticated
  using (id = auth.uid() or public.tiene_permiso('GESTIONAR_USUARIOS'));
create policy usuario_escribir on public.usuario for update to authenticated
  using (public.tiene_permiso('GESTIONAR_USUARIOS')) with check (public.tiene_permiso('GESTIONAR_USUARIOS'));

create policy usuario_rol_leer on public.usuario_rol for select to authenticated
  using (usuario_id = auth.uid() or public.tiene_permiso('GESTIONAR_USUARIOS'));
create policy usuario_rol_escribir on public.usuario_rol for all to authenticated
  using (public.tiene_permiso('GESTIONAR_ROLES')) with check (public.tiene_permiso('GESTIONAR_ROLES'));

create policy usuario_permiso_leer on public.usuario_permiso for select to authenticated
  using (usuario_id = auth.uid() or public.tiene_permiso('GESTIONAR_ROLES'));
create policy usuario_permiso_escribir on public.usuario_permiso for all to authenticated
  using (public.tiene_permiso('GESTIONAR_ROLES')) with check (public.tiene_permiso('GESTIONAR_ROLES'));

-- ---------------------------------------------------------------------
-- Datos base: roles y permisos (docs/web/04 §Roles)
-- ---------------------------------------------------------------------
insert into public.rol (id, nombre, descripcion) values
  ('superadmin',      'Superadmin',            'Administrador del sistema'),
  ('administradora',  'Administradora',        'Aprueba, corrige, tasas, reportes, finanzas, roles y permisos'),
  ('operador',        'Operador',              'Registra y verifica movimientos de sus clientes'),
  ('cliente_grande',  'Cliente grande',        'Registra sus movimientos y ve su saldo, ganancias y retiros'),
  ('brasil',          'Brasil (comprobantes)', 'Sube comprobantes de las cuentas de Brasil'),
  ('brasil_operador', 'Brasil (apropiación)',  'Asigna comprobantes a clientes u operadores');

insert into public.permiso (codigo, descripcion, solo_superadmin) values
  ('VER_MOVIMIENTOS',           'Ver movimientos',                                    false),
  ('REGISTRAR_MOVIMIENTO',      'Registrar movimientos',                              false),
  ('VERIFICAR_MOVIMIENTO',      'Verificar / desbloquear movimientos',                false),
  ('APROBAR_MOVIMIENTO',        'Aprobar lotes (Motor)',                              false),
  ('RECHAZAR_MOVIMIENTO',       'Rechazar movimientos con motivo',                    false),
  ('CORREGIR_MOVIMIENTO',       'Corregir movimientos con recálculo de saldos',       false),
  ('EDITAR_MOVIMIENTOS_MASIVO', 'Editar varios movimientos a la vez',                 false),
  ('ANULAR_MOVIMIENTO',         'Anular movimientos',                                 false),
  ('AJUSTAR_UTILIDAD',          'Quitar utilidad o restar puntos',                    false),
  ('APLICAR_DESCUENTO',         'Aplicar descuento ×0,95 (penalización)',             false),
  ('GESTIONAR_TASAS',           'Crear y cerrar tasas y tabla de utilidad',           false),
  ('GESTIONAR_CATALOGOS',       'Monedas, contrapartes, empresas, ajustes',           false),
  ('VER_REPORTES',              'Ver reportes de saldos y estados de cuenta',         false),
  ('FINANZAS',                  'Gastos, negociaciones, estado de resultados',        false),
  ('CERRAR_PERIODO',            'Cerrar períodos',                                    false),
  ('GESTIONAR_USUARIOS',        'Crear y desactivar usuarios',                        false),
  ('GESTIONAR_ROLES',           'Asignar roles y delegar permisos',                   false),
  ('BRASIL_CARGAR',             'Cargar comprobantes de Brasil',                      false),
  ('BRASIL_APROPIAR',           'Apropiar comprobantes de Brasil',                    false),
  ('REGISTRAR_RETIRO',          'Registrar retiros de la caja de ganancias',          false),
  ('VER_AUDITORIA',             'Ver el registro de auditoría',                       false),
  ('RECALCULAR_BUCKET',         'Recalcular saldo completo de un bucket',             true),
  ('RECALCULAR_GANANCIAS',      'Recalcular ganancias congeladas',                    true);

insert into public.rol_permiso (rol_id, permiso)
select 'administradora', codigo from public.permiso where not solo_superadmin;

insert into public.rol_permiso (rol_id, permiso) values
  ('operador', 'VER_MOVIMIENTOS'), ('operador', 'REGISTRAR_MOVIMIENTO'), ('operador', 'RECHAZAR_MOVIMIENTO'), ('operador', 'VER_REPORTES'),
  ('cliente_grande', 'VER_MOVIMIENTOS'), ('cliente_grande', 'REGISTRAR_MOVIMIENTO'), ('cliente_grande', 'REGISTRAR_RETIRO'),
  ('brasil', 'BRASIL_CARGAR'),
  ('brasil_operador', 'BRASIL_APROPIAR'), ('brasil_operador', 'VER_MOVIMIENTOS');
