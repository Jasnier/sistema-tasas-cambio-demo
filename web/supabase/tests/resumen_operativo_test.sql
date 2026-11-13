-- Migración 2700 (STW-57): las columnas *_pos de resumen_operativo cuentan solo las operaciones con utilidad positiva,
-- como "ocultar utilidad 0 o negativa" de dashboard.js (filtra cada operación antes de agrupar).
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into public.contraparte (id, tipo, nombre) values ('CT-97701', 'CLIENTE', 'Resumen T27') on conflict do nothing;
insert into public.moneda (id, nombre) values ('T27-M', 'T27MON') on conflict do nothing;
-- Tres operaciones del mismo cliente y moneda: utilidad 100, 0 y -20 (montos 1000, 500, 200; puntos 10, 0, -4)
with m as (
  insert into public.movimiento (codigo, libro_id, id_transaccion, tipo, fecha_operacion, modalidad, contraparte_id, moneda_origen,
    moneda_destino, monto_origen, estado, aprobado_en, tasa_aplicada, monto_destino, entrada, salida, saldo_post, periodo_id)
  select 'T27-' || n, (select id from public.libro where codigo = 'OPERADOR_LAURA'), 'T27-TX-' || n, 'ENTRADA', '2026-11-05 12:00-05',
         'TRANSFERENCIA', 'CT-97701', 'T27MON', 'T27MON', v.monto, 'APROBADO', now(), 100, v.monto, v.monto, 0, 0, null
    from (values (1, 1000), (2, 500), (3, 200)) v(n, monto)
  returning id, codigo)
insert into public.movimiento_utilidad (movimiento_id, puntos_utilidad, tasa_adquisicion, valor_adquisicion, utilidad)
select m.id, 0, 100 + v.puntos, 0, v.utilidad from m join (values ('T27-1', 10, 100), ('T27-2', 0, 0), ('T27-3', -4, -20)) v(codigo, puntos, utilidad) on v.codigo = m.codigo;

create temp table r as select * from public.resumen_operativo where contraparte_id = 'CT-97701';
select is((select operaciones from r), 3, 'sin filtro: las tres operaciones');
select is((select utilidad from r), 80.00::numeric, 'sin filtro: utilidad 100 + 0 − 20');
select is((select operaciones_pos from r), 1, 'ocultar ≤0: solo la operación con utilidad positiva');
select is((select (volumen_pos, utilidad_pos) from r), (1000.00::numeric, 100.00::numeric), 'ocultar ≤0: volumen y utilidad de esa operación');
select is((select round(puntos_promedio_pos, 2) from r), 10.00::numeric, 'ocultar ≤0: puntos promedio de esa operación');

select * from finish();
rollback;
