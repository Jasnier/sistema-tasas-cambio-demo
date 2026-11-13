-- =====================================================================
-- STW-57: el resumen operativo filtra "ocultar utilidad 0 o negativa" como el original (prod/otros/dashboard.js:213):
-- descarta cada OPERACIÓN con utilidad <= 0 antes de agrupar, no el grupo ya sumado. Para eso la vista suma también
-- solo las operaciones con utilidad positiva (columnas *_pos). Solo se agregan columnas al final: lo que ya usa la
-- vista (estado de resultados) no cambia.
-- =====================================================================
create or replace view public.resumen_operativo with (security_invoker = true) as
select m.periodo_id, m.contraparte_id, k.nombre, m.moneda_origen,
       count(*)::int as operaciones, sum(m.monto_origen) as volumen,
       avg(u.tasa_adquisicion - m.tasa_aplicada) as puntos_promedio, sum(u.utilidad) as utilidad,
       (count(*) filter (where u.utilidad > 0))::int as operaciones_pos,
       sum(m.monto_origen) filter (where u.utilidad > 0) as volumen_pos,
       avg(u.tasa_adquisicion - m.tasa_aplicada) filter (where u.utilidad > 0) as puntos_promedio_pos,
       sum(u.utilidad) filter (where u.utilidad > 0) as utilidad_pos
  from public.movimiento m
  join public.movimiento_utilidad u on u.movimiento_id = m.id
  join public.contraparte k on k.id = m.contraparte_id
 where m.estado = 'APROBADO'
 group by m.periodo_id, m.contraparte_id, k.nombre, m.moneda_origen;
