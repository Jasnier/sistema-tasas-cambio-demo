-- =====================================================================
-- STW-16: carga de comprobantes por banco (Brasil Paula → web).    P-15, P-17, P-18
-- Hoy: una hoja por banco con fecha, id_tx, nombre, observación, entra/sale y estado PENDIENTE
-- (prod/brasil-paula/Código.js:27-64). Sin archivo y sin control de id_tx repetido.
-- Web: una tabla, código BR-<banco>-00001 por banco, archivo en Storage privado, id_tx único por banco.
-- La apropiación (EN_PROCESO / APLICADO, P-18) es STW-18.
-- =====================================================================

do $$ begin
  create type public.tipo_mov as enum ('ENTRADA', 'SALIDA');   -- lo reutiliza movimiento (STW-22)
exception when duplicate_object then null; end $$;

create type public.estado_comprobante as enum ('PENDIENTE', 'EN_PROCESO', 'APLICADO', 'ERROR', 'ANULADO');

create table public.consecutivo_banco (
  banco_id text primary key references public.banco_brasil on update cascade,
  ultimo   int not null default 0
);
alter table public.consecutivo_banco enable row level security;   -- solo lo usa el trigger

create table public.comprobante_brasil (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique,                      -- BR-CORA_ALFA-00001 (lo pone el trigger)
  banco_id       text not null references public.banco_brasil on update cascade,
  fecha          date not null,
  id_tx          text not null check (btrim(id_tx) <> ''),
  remitente      text,                                       -- "Nombre" en la hoja actual
  observacion    text,
  tipo           public.tipo_mov not null,
  valor          numeric(20,2) not null check (valor > 0),
  archivo_path   text unique,                                -- objeto en el bucket privado "comprobantes"
  archivo_nombre text,                                       -- nombre original, para mostrar
  estado         public.estado_comprobante not null default 'PENDIENTE',
  bloqueado_por  uuid references public.usuario,             -- EN_PROCESO (P-18, STW-18)
  bloqueado_en   timestamptz,
  movimiento_id  uuid,                                       -- FK a movimiento cuando exista (STW-18/22)
  anulado_motivo text,
  anulado_por    uuid references public.usuario,
  anulado_en     timestamptz,
  creado_por     uuid references public.usuario default auth.uid(),
  creado_en      timestamptz not null default now(),
  constraint anulado_con_motivo check (estado <> 'ANULADO' or btrim(coalesce(anulado_motivo, '')) <> '')
);
-- P-15: el comprobante es único por banco (mismo id_tx sin importar espacios ni mayúsculas)
create unique index comprobante_brasil_banco_idtx on public.comprobante_brasil (banco_id, lower(btrim(id_tx)));
create index on public.comprobante_brasil (banco_id, fecha desc);
create index on public.comprobante_brasil (estado);

-- ---------------------------------------------------------------------
-- Reglas
-- ---------------------------------------------------------------------
-- Consecutivo por banco sin carreras (UPDATE … RETURNING bloquea la fila del banco)
create or replace function public.siguiente_codigo_comprobante(p_banco text)
returns text language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  -- Lo llama el trigger con el usuario de la app (o la migración, sin usuario)
  if auth.uid() is not null and not tiene_permiso('BRASIL_CARGAR') then
    raise exception 'No tiene permiso BRASIL_CARGAR' using errcode = '42501';
  end if;
  insert into consecutivo_banco (banco_id) values (p_banco) on conflict do nothing;
  update consecutivo_banco set ultimo = ultimo + 1 where banco_id = p_banco returning ultimo into v_n;
  return 'BR-' || p_banco || '-' || lpad(v_n::text, 5, '0');
end $$;
revoke execute on function public.siguiente_codigo_comprobante(text) from public, anon;
grant execute on function public.siguiente_codigo_comprobante(text) to authenticated;

-- El trigger NO es security definer: así current_user distingue a la app (authenticated) de la migración
create or replace function public.preparar_comprobante()
returns trigger language plpgsql set search_path = public as $$
begin
  new.id_tx := btrim(new.id_tx);
  new.remitente := nullif(btrim(new.remitente), '');
  new.observacion := nullif(btrim(new.observacion), '');

  if tg_op = 'INSERT' then
    if current_user in ('authenticated', 'anon') then
      new.estado := 'PENDIENTE';
      new.creado_por := auth.uid();
    end if;
    new.codigo := siguiente_codigo_comprobante(new.banco_id);
    return new;
  end if;

  -- UPDATE
  if new.codigo <> old.codigo or new.banco_id <> old.banco_id or new.creado_por is distinct from old.creado_por
     or new.creado_en <> old.creado_en then
    raise exception 'El banco y el código de un comprobante no se cambian (anúlelo y cárguelo de nuevo)';
  end if;
  if current_user in ('authenticated', 'anon') then
    if old.estado <> 'PENDIENTE' then
      raise exception 'El comprobante % ya no está pendiente (%): no se puede modificar', old.codigo, old.estado;
    end if;
    if new.estado not in ('PENDIENTE', 'ANULADO') then
      raise exception 'El estado % lo asigna la apropiación, no la carga', new.estado;
    end if;
    if new.bloqueado_por is distinct from old.bloqueado_por or new.movimiento_id is distinct from old.movimiento_id then
      raise exception 'Campos de apropiación no editables desde la carga';
    end if;
  end if;
  if new.estado = 'ANULADO' and old.estado <> 'ANULADO' then
    new.anulado_por := auth.uid();
    new.anulado_en := now();
  end if;
  return new;
end $$;

create trigger preparar_comprobante before insert or update on public.comprobante_brasil
  for each row execute function public.preparar_comprobante();
create trigger aud_comprobante_brasil after insert or update or delete on public.comprobante_brasil
  for each row execute function public.auditar('id');

-- ---------------------------------------------------------------------
-- RLS. Cargar: BRASIL_CARGAR (Paula). Ver: además quien apropia y la administración. Nadie borra.
-- ---------------------------------------------------------------------
alter table public.comprobante_brasil enable row level security;

create policy comprobante_leer on public.comprobante_brasil for select to authenticated using (
  public.tiene_permiso('BRASIL_CARGAR') or public.tiene_permiso('BRASIL_APROPIAR') or public.tiene_permiso('APROBAR_MOVIMIENTO'));
create policy comprobante_crear on public.comprobante_brasil for insert to authenticated
  with check (public.tiene_permiso('BRASIL_CARGAR'));
create policy comprobante_editar on public.comprobante_brasil for update to authenticated
  using (public.tiene_permiso('BRASIL_CARGAR') and estado = 'PENDIENTE')
  with check (public.tiene_permiso('BRASIL_CARGAR'));

-- ---------------------------------------------------------------------
-- Storage: bucket privado "comprobantes" (PDF e imágenes, hasta 10 MB). Los archivos no se
-- reemplazan ni se borran: un archivo nuevo es otro objeto.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes', 'comprobantes', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy comprobantes_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'comprobantes' and public.tiene_permiso('BRASIL_CARGAR'));
create policy comprobantes_ver on storage.objects for select to authenticated
  using (bucket_id = 'comprobantes' and (public.tiene_permiso('BRASIL_CARGAR')
         or public.tiene_permiso('BRASIL_APROPIAR') or public.tiene_permiso('APROBAR_MOVIMIENTO')));
