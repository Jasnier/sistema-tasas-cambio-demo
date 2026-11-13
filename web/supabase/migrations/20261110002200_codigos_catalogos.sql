-- =====================================================================
-- Códigos automáticos en los catálogos (pedido del usuario, 2026-11-11). Si el código llega vacío,
-- se asigna el siguiente; si se escribe a mano (p. ej. para igualar un CT que ya existe en Sheets
-- durante el paralelo), se respeta. La importación sigue trayendo sus propios códigos.
--   contraparte   CT-<mayor + 1>          (CT-184 → CT-185, sin ceros a la izquierda, como en Sheets)
--   moneda        <mayor número + 1>      (id del CORE: 1, 2, 3…)
--   recibido_en   RE-<mayor + 1, 2 dígitos>
--   empresa       EM-<mayor + 1, 2 dígitos>
--   banco_brasil  a partir del nombre      ("Nu Bank São Paulo" → NU_BANK_SAO_PAULO); va en el código
--                                          de cada comprobante (BR-<banco>-00001)
-- =====================================================================

create or replace function public.asignar_codigo_catalogo()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_n int; v_base text; v_id text; v_i int := 1;
begin
  new.id := nullif(upper(btrim(coalesce(new.id, ''))), '');
  if new.id is not null then return new; end if;
  -- Dos altas a la vez en el mismo catálogo no sacan el mismo número
  perform pg_advisory_xact_lock(hashtext('codigo_catalogo:' || tg_table_name));

  if tg_table_name = 'contraparte' then
    select coalesce(max(substring(id from '^CT-(\d+)$')::int), 0) + 1 into v_n from contraparte;
    new.id := 'CT-' || v_n;
  elsif tg_table_name = 'moneda' then
    select coalesce(max(id::int) filter (where id ~ '^\d+$'), 0) + 1 into v_n from moneda;
    new.id := v_n::text;
  elsif tg_table_name = 'recibido_en' then
    select coalesce(max(substring(id from '^RE-(\d+)$')::int), 0) + 1 into v_n from recibido_en;
    new.id := 'RE-' || lpad(v_n::text, 2, '0');
  elsif tg_table_name = 'empresa' then
    select coalesce(max(substring(id from '^EM-(\d+)$')::int), 0) + 1 into v_n from empresa;
    new.id := 'EM-' || lpad(v_n::text, 2, '0');
  elsif tg_table_name = 'banco_brasil' then
    v_base := left(btrim(regexp_replace(upper(translate(coalesce(new.nombre, ''),
                'áéíóúàèìòùâêîôûãõäëïöüçñÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÃÕÄËÏÖÜÇÑ', 'aeiouaeiouaeiouaoaeioucnAEIOUAEIOUAEIOUAOAEIOUCN')),
                '[^A-Z0-9]+', '_', 'g'), '_'), 24);
    if v_base = '' then raise exception 'Escriba el nombre del banco'; end if;
    v_id := v_base;
    while exists (select 1 from banco_brasil where id = v_id) loop
      v_i := v_i + 1; v_id := v_base || '_' || v_i;
    end loop;
    new.id := v_id;
  end if;
  return new;
end $$;
revoke execute on function public.asignar_codigo_catalogo() from public, anon, authenticated;

create trigger codigo_automatico before insert on public.contraparte  for each row execute function public.asignar_codigo_catalogo();
create trigger codigo_automatico before insert on public.moneda       for each row execute function public.asignar_codigo_catalogo();
create trigger codigo_automatico before insert on public.recibido_en  for each row execute function public.asignar_codigo_catalogo();
create trigger codigo_automatico before insert on public.empresa      for each row execute function public.asignar_codigo_catalogo();
create trigger codigo_automatico before insert on public.banco_brasil for each row execute function public.asignar_codigo_catalogo();

-- La función que da el código que se va a asignar, para mostrarlo en el formulario (solo lectura)
create or replace function public.siguiente_codigo_catalogo(p_tabla text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_n int;
begin
  if not tiene_permiso('GESTIONAR_CATALOGOS') then raise exception 'No tiene permiso' using errcode = '42501'; end if;
  case p_tabla
    when 'contraparte' then select coalesce(max(substring(id from '^CT-(\d+)$')::int), 0) + 1 into v_n from contraparte; return 'CT-' || v_n;
    when 'moneda' then select coalesce(max(id::int) filter (where id ~ '^\d+$'), 0) + 1 into v_n from moneda; return v_n::text;
    when 'recibido_en' then select coalesce(max(substring(id from '^RE-(\d+)$')::int), 0) + 1 into v_n from recibido_en; return 'RE-' || lpad(v_n::text, 2, '0');
    when 'empresa' then select coalesce(max(substring(id from '^EM-(\d+)$')::int), 0) + 1 into v_n from empresa; return 'EM-' || lpad(v_n::text, 2, '0');
    else return null;   -- banco_brasil: sale del nombre
  end case;
end $$;
revoke execute on function public.siguiente_codigo_catalogo(text) from public, anon;
grant execute on function public.siguiente_codigo_catalogo(text) to authenticated;
