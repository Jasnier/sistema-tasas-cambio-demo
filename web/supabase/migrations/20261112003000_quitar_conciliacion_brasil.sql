-- =====================================================================
-- Se retira la conciliación de Brasil (STW-19 / T-11), por decisión de producto (2026-11-12).
--
-- En Sheets, "reconciliar" volvía a llamar los registros de Paula que quedaron marcados como
-- procesados sin haber llegado (se caía la señal). En la web hay una sola tabla: un comprobante no
-- puede quedar "procesado pero sin llegar", así que esa función no tiene equivalente. La pantalla
-- /brasil/conciliacion solo listaba situaciones que ya se ven en la bandeja (pendientes antiguos,
-- tomas vencidas, errores) y nadie la usaba.
--
-- Se quitan la vista y la función. Las columnas comprobante_brasil.revisado_por / revisado_en /
-- revisado_nota se DEJAN: el trigger de la 1100 las limpia al cambiar de estado (quitarlas lo
-- rompería) y vacías no ocupan espacio. No se borra ningún dato.
-- =====================================================================
drop view if exists public.conciliacion_brasil;
drop function if exists public.marcar_revisado_brasil(uuid, text);
