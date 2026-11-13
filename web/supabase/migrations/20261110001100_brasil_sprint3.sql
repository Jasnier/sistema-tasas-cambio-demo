-- =====================================================================
-- Sprint 3 — Brasil: resumen y Binance (STW-17), bandeja y apropiación (STW-18),
-- conciliación (STW-19, T-11) y datos para el puente a Sheets (STW-20). P-15, P-18.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Clase de registro. En la hoja de Paula hay filas que NO son comprobantes a apropiar:
--    saldo inicial y ventas a Binance (obs "BINANCE", tasa escrita en el nombre). El paso a la
--    bandeja las excluye (doc 03 §5.2 regla 5) pero cuentan en el saldo y en el dashboard.
-- ---------------------------------------------------------------------
create type public.clase_comprobante as enum ('COMPROBANTE', 'SALDO_INICIAL', 'BINANCE');

alter table public.comprobante_brasil
  add column clase public.clase_comprobante not null default 'COMPROBANTE',
  add column tasa_binance numeric check (tasa_binance > 0),
  add column usdt numeric generated always as (case when tasa_binance > 0 then round(valor / tasa_binance, 8) end) stored;

-- id_tx: obligatorio en entradas de comprobantes; salidas, saldo inicial y Binance pueden no tenerlo (doc 03 §5.2 regla 2)
alter table public.comprobante_brasil alter column id_tx drop not null;
alter table public.comprobante_brasil
  add constraint comprobante_entrada_con_idtx check (clase <> 'COMPROBANTE' or tipo = 'SALIDA' or id_tx is not null),
  add constraint binance_es_salida_con_tasa check (clase <> 'BINANCE' or (tipo = 'SALIDA' and tasa_binance is not null)),
  add constraint tasa_solo_binance check (clase = 'BINANCE' or tasa_binance is null),
  add constraint saldo_inicial_es_entrada check (clase <> 'SALDO_INICIAL' or tipo = 'ENTRADA');

-- ---------------------------------------------------------------------
-- 2. Apropiación (doc 03 §5.3): a qué libro va y con qué datos; código BRS- que devuelve el destino
-- ---------------------------------------------------------------------
alter table public.comprobante_brasil
  add column libro_destino_id  uuid references public.libro,
  add column hora_operacion    time,
  add column modalidad         text references public.modalidad,
  add column moneda_destino    text references public.moneda (nombre) on update cascade,
  add column recibido_en_id    text references public.recibido_en,
  add column empresa_id        text references public.empresa,
  add column contraparte_id    text references public.contraparte,
  add column codigo_brs        text unique,                 -- BRS-LN-00822 (lo devuelve el libro destino)
  add column apropiado_por     uuid references public.usuario,
  add column apropiado_en      timestamptz,
  add column envio_mensaje     text,                        -- "ENVIADO CORRECTAMENTE" o el error
  -- T-11: marca propia de revisión en la conciliación
  add column revisado_por      uuid references public.usuario,
  add column revisado_en       timestamptz,
  add column revisado_nota     text;

-- URL de la web app de cada libro destino (CONFIG de Brasil Operadores, col E). La clave va en el
-- servidor (variable BRASIL_API_KEY), nunca en la base.
alter table public.libro add column webapp_url text
  check (webapp_url is null or webapp_url ~ '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$');

-- Quien apropia necesita ver los libros destino (solo lectura)
create policy libro_leer_brasil on public.libro for select to authenticated using (public.tiene_permiso('BRASIL_APROPIAR'));

-- Limpieza del trigger de 0900: id_tx vacío = null; los campos de apropiación/revisión no los toca la app
create or replace function public.preparar_comprobante()
returns trigger language plpgsql set search_path = public as $$
begin
  new.id_tx := nullif(btrim(new.id_tx), '');
  new.remitente := nullif(btrim(new.remitente), '');
  new.observacion := nullif(btrim(new.observacion), '');
  if new.clase <> 'BINANCE' then new.tasa_binance := null; end if;

  if tg_op = 'INSERT' then
    if current_user in ('authenticated', 'anon') then
      new.estado := 'PENDIENTE';
      new.creado_por := auth.uid();
      new.libro_destino_id := null; new.codigo_brs := null; new.apropiado_por := null; new.apropiado_en := null;
      new.bloqueado_por := null; new.bloqueado_en := null; new.revisado_por := null; new.revisado_en := null;
    end if;
    new.codigo := siguiente_codigo_comprobante(new.banco_id);
    return new;
  end if;

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
    if (to_jsonb(new) - array['id_tx','remitente','observacion','tipo','valor','fecha','archivo_path','archivo_nombre',
                              'estado','anulado_motivo','anulado_por','anulado_en','clase','tasa_binance','usdt'])
       is distinct from
       (to_jsonb(old) - array['id_tx','remitente','observacion','tipo','valor','fecha','archivo_path','archivo_nombre',
                              'estado','anulado_motivo','anulado_por','anulado_en','clase','tasa_binance','usdt']) then
      raise exception 'Campos de apropiación o revisión no editables desde la carga';
    end if;
  end if;
  if new.estado = 'ANULADO' and old.estado <> 'ANULADO' then
    new.anulado_por := auth.uid();
    new.anulado_en := now();
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3. Flujo de apropiación (RPC; solo BRASIL_APROPIAR). P-18: "en proceso" se libera solo a los 10 min.
-- ---------------------------------------------------------------------
create or replace function public.minutos_toma_brasil() returns interval language sql immutable as $$ select interval '10 minutes' $$;

create or replace function public.tomar_comprobante(p_id uuid)
returns public.comprobante_brasil language plpgsql security definer set search_path = public as $$
declare c comprobante_brasil;
begin
  if not tiene_permiso('BRASIL_APROPIAR') then raise exception 'No tiene permiso BRASIL_APROPIAR' using errcode = '42501'; end if;
  select * into c from comprobante_brasil where id = p_id for update;
  if not found then raise exception 'El comprobante no existe'; end if;
  if c.clase <> 'COMPROBANTE' then raise exception '% es % y no se apropia', c.codigo, c.clase; end if;
  if c.estado = 'EN_PROCESO' and c.bloqueado_por is distinct from auth.uid() and c.bloqueado_en > now() - minutos_toma_brasil() then
    raise exception '% lo está apropiando otra persona (se libera a las %)', c.codigo,
      to_char((c.bloqueado_en + minutos_toma_brasil()) at time zone 'America/Bogota', 'HH24:MI');
  end if;
  if c.estado not in ('PENDIENTE', 'ERROR', 'EN_PROCESO') then
    raise exception '% no está disponible (%)', c.codigo, c.estado;
  end if;
  update comprobante_brasil set estado = 'EN_PROCESO', bloqueado_por = auth.uid(), bloqueado_en = now()
   where id = p_id returning * into c;
  return c;
end $$;

create or replace function public.liberar_comprobante(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not tiene_permiso('BRASIL_APROPIAR') then raise exception 'No tiene permiso BRASIL_APROPIAR' using errcode = '42501'; end if;
  update comprobante_brasil set estado = 'PENDIENTE', bloqueado_por = null, bloqueado_en = null
   where id = p_id and estado = 'EN_PROCESO' and (bloqueado_por = auth.uid() or tiene_permiso('APROBAR_MOVIMIENTO'));
end $$;

-- Guarda los datos de la apropiación y deja el comprobante listo para enviar (sigue EN_PROCESO).
-- El servidor envía al libro destino y luego llama a confirmar_apropiacion o error_apropiacion.
create or replace function public.preparar_apropiacion(
  p_id uuid, p_libro uuid, p_hora time, p_modalidad text, p_moneda_destino text,
  p_recibido_en text, p_empresa text, p_contraparte text
) returns public.comprobante_brasil language plpgsql security definer set search_path = public as $$
declare c comprobante_brasil; l libro;
begin
  if not tiene_permiso('BRASIL_APROPIAR') then raise exception 'No tiene permiso BRASIL_APROPIAR' using errcode = '42501'; end if;
  select * into c from comprobante_brasil where id = p_id for update;
  if c.estado <> 'EN_PROCESO' or c.bloqueado_por is distinct from auth.uid() then
    raise exception 'Primero tome el comprobante (o su toma venció a los 10 minutos)';
  end if;
  if c.bloqueado_en <= now() - minutos_toma_brasil() then
    raise exception 'La toma de % venció (10 minutos). Tómelo de nuevo', c.codigo;
  end if;
  select * into l from libro where id = p_libro and activo and tipo in ('operador', 'cliente_grande');
  if not found then raise exception 'Elija un libro destino válido'; end if;
  if p_hora is null then raise exception 'La hora de la operación es obligatoria'; end if;
  update comprobante_brasil set
    libro_destino_id = l.id, hora_operacion = p_hora, modalidad = normalizar_texto(p_modalidad),
    moneda_destino = normalizar_texto(p_moneda_destino), recibido_en_id = p_recibido_en, empresa_id = p_empresa,
    contraparte_id = p_contraparte, bloqueado_en = now()
   where id = p_id returning * into c;
  return c;
end $$;

create or replace function public.confirmar_apropiacion(p_id uuid, p_codigo_brs text, p_mensaje text default 'ENVIADO CORRECTAMENTE')
returns public.comprobante_brasil language plpgsql security definer set search_path = public as $$
declare c comprobante_brasil;
begin
  if not tiene_permiso('BRASIL_APROPIAR') then raise exception 'No tiene permiso BRASIL_APROPIAR' using errcode = '42501'; end if;
  if btrim(coalesce(p_codigo_brs, '')) !~ '^BRS-[A-Z]{2,5}-\d+$' then raise exception 'Código BRS inválido: %', p_codigo_brs; end if;
  update comprobante_brasil set estado = 'APLICADO', codigo_brs = btrim(p_codigo_brs), envio_mensaje = p_mensaje,
         apropiado_por = auth.uid(), apropiado_en = now(), bloqueado_por = null, bloqueado_en = null
   where id = p_id and estado = 'EN_PROCESO' and bloqueado_por = auth.uid() and libro_destino_id is not null
   returning * into c;
  if not found then raise exception 'El comprobante no está en proceso por usted'; end if;
  return c;
end $$;

create or replace function public.error_apropiacion(p_id uuid, p_mensaje text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not tiene_permiso('BRASIL_APROPIAR') then raise exception 'No tiene permiso BRASIL_APROPIAR' using errcode = '42501'; end if;
  update comprobante_brasil set estado = 'ERROR', envio_mensaje = left(p_mensaje, 500), bloqueado_por = null, bloqueado_en = null
   where id = p_id and estado = 'EN_PROCESO' and bloqueado_por = auth.uid();
end $$;

-- T-11: marcar un hallazgo de la conciliación como revisado (con nota)
create or replace function public.marcar_revisado_brasil(p_id uuid, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (tiene_permiso('BRASIL_APROPIAR') or tiene_permiso('APROBAR_MOVIMIENTO')) then
    raise exception 'No tiene permiso para revisar la conciliación' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_nota, ''))) < 3 then raise exception 'Escriba una nota de revisión'; end if;
  update comprobante_brasil set revisado_por = auth.uid(), revisado_en = now(), revisado_nota = btrim(p_nota) where id = p_id;
end $$;

revoke execute on function public.tomar_comprobante(uuid), public.liberar_comprobante(uuid),
  public.preparar_apropiacion(uuid, uuid, time, text, text, text, text, text),
  public.confirmar_apropiacion(uuid, text, text), public.error_apropiacion(uuid, text),
  public.marcar_revisado_brasil(uuid, text) from anon;

-- ---------------------------------------------------------------------
-- 4. STW-17: saldo de cierre por banco y día (= hoja RESUMEN: último total del día) y Binance
--    El saldo es el acumulado de entradas − salidas (incluye saldo inicial y Binance), sin anulados.
-- ---------------------------------------------------------------------
create view public.resumen_brasil_dia with (security_invoker = true) as
select banco_id, fecha,
       sum(valor) filter (where tipo = 'ENTRADA') as entradas,
       sum(valor) filter (where tipo = 'SALIDA')  as salidas,
       sum(case when tipo = 'ENTRADA' then valor else -valor end) as neto,
       sum(sum(case when tipo = 'ENTRADA' then valor else -valor end)) over (partition by banco_id order by fecha) as saldo_cierre,
       count(*) as registros
from public.comprobante_brasil
where estado <> 'ANULADO'
group by banco_id, fecha;

-- ---------------------------------------------------------------------
-- 5. STW-19: conciliación. En la web no hay copias que se desincronicen (no hace falta "recuperar"
--    filas como reconciliar.js); se reportan las situaciones que sí pueden pasar.
-- ---------------------------------------------------------------------
create view public.conciliacion_brasil with (security_invoker = true) as
with c as (select * from public.comprobante_brasil where estado <> 'ANULADO')
select 'DUPLICADO_PROBABLE'::text as hallazgo, c.id, c.codigo, c.banco_id, c.fecha, c.valor, c.estado::text,
       'Mismo banco, fecha, tipo, valor y remitente que ' || string_agg(o.codigo, ', ') as detalle,
       c.revisado_en, c.revisado_nota
  from c join c o on o.id <> c.id and o.banco_id = c.banco_id and o.fecha = c.fecha and o.tipo = c.tipo
                 and o.valor = c.valor and lower(coalesce(o.remitente, '')) = lower(coalesce(c.remitente, ''))
                 and o.clase = c.clase
 group by c.id, c.codigo, c.banco_id, c.fecha, c.valor, c.estado, c.revisado_en, c.revisado_nota
union all
select 'EN_PROCESO_VENCIDO', id, codigo, banco_id, fecha, valor, estado::text,
       'Tomado hace más de 10 minutos sin terminar (se puede volver a tomar)', revisado_en, revisado_nota
  from c where estado = 'EN_PROCESO' and bloqueado_en <= now() - public.minutos_toma_brasil()
union all
select 'ERROR_ENVIO', id, codigo, banco_id, fecha, valor, estado::text, coalesce(envio_mensaje, 'Error sin mensaje'), revisado_en, revisado_nota
  from c where estado = 'ERROR'
union all
select 'PENDIENTE_ANTIGUO', id, codigo, banco_id, fecha, valor, estado::text,
       'Pendiente de apropiar desde hace ' || (current_date - fecha) || ' días', revisado_en, revisado_nota
  from c where estado = 'PENDIENTE' and clase = 'COMPROBANTE' and fecha < current_date - 3
union all
select 'APLICADO_SIN_CODIGO', id, codigo, banco_id, fecha, valor, estado::text, 'Aplicado sin código BRS del libro destino', revisado_en, revisado_nota
  from c where estado = 'APLICADO' and codigo_brs is null;

grant select on public.resumen_brasil_dia, public.conciliacion_brasil to authenticated;
