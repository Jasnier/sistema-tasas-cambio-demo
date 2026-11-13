-- =====================================================================
-- Las secuencias de los ids TB-, UT- y AJ- (migración 0500) quedaron sueltas: al recrear una base
-- remota (`supabase db reset --remote`) se borraron las tablas pero no las secuencias, y la 0500
-- falló con "relation tasa_cliente_seq already exists". Al asociarlas a su columna se borran con
-- la tabla. No cambia ningún id ni el siguiente valor.
-- =====================================================================
alter sequence public.tasa_cliente_seq   owned by public.tasa_cliente.id;
alter sequence public.tasa_utilidad_seq  owned by public.tasa_utilidad.id;
alter sequence public.ajuste_cliente_seq owned by public.ajuste_cliente.id;
