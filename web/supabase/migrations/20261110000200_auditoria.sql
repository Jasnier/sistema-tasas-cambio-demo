-- =====================================================================
-- STW-11: auditoría por trigger (quién, cuándo, tabla, antes, después)
-- =====================================================================
create table public.auditoria (
  id          bigserial primary key,
  tabla       text not null,
  registro_id text,
  accion      text not null check (accion in ('INSERT','UPDATE','DELETE')),
  antes       jsonb,
  despues     jsonb,
  usuario_id  uuid default auth.uid(),
  en          timestamptz not null default now()
);
create index on public.auditoria (tabla, registro_id);
create index on public.auditoria (en desc);

create or replace function public.auditar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_antes   jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_despues jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_id      text;
begin
  v_id := coalesce(v_despues, v_antes) ->> coalesce(tg_argv[0], 'id');
  if tg_op = 'UPDATE' and v_antes = v_despues then
    return new;  -- sin cambios reales
  end if;
  insert into auditoria (tabla, registro_id, accion, antes, despues)
  values (tg_table_name, v_id, tg_op, v_antes, v_despues);
  return coalesce(new, old);
end $$;

-- Tablas de seguridad (las de negocio se agregan en sus migraciones)
create trigger aud_usuario         after insert or update or delete on public.usuario         for each row execute function public.auditar('id');
create trigger aud_usuario_rol     after insert or update or delete on public.usuario_rol     for each row execute function public.auditar('usuario_id');
create trigger aud_usuario_permiso after insert or update or delete on public.usuario_permiso for each row execute function public.auditar('usuario_id');
create trigger aud_rol_permiso     after insert or update or delete on public.rol_permiso     for each row execute function public.auditar('rol_id');

-- Nadie modifica ni borra la auditoría (ni siquiera con permisos de la app)
alter table public.auditoria enable row level security;
create policy auditoria_leer on public.auditoria for select to authenticated using (public.tiene_permiso('VER_AUDITORIA'));
revoke update, delete, truncate on public.auditoria from authenticated, anon;
