-- =====================================================================
-- P-17 (respondida 2026-11-10): lista oficial de bancos de Brasil.
-- Son las 7 hojas por banco del libro Brasil Paula (prod/brasil-paula/resumen.js:17-24).
-- id = código corto que irá en el comprobante (BR-<id>-00001); orden = el de las hojas actuales.
-- hoja_origen = nombre exacto de la hoja en Sheets (con sus espacios), para la migración (STW-49).
-- =====================================================================
alter table public.banco_brasil add column if not exists hoja_origen text unique;

insert into public.banco_brasil (id, nombre, orden, hoja_origen) values
  ('CORA_ALFA',  'CORA ALFA',         1, 'BANCO  CORA ALFA'),
  ('SICOOB_ALFA','SICOOB ALFA',       2, 'BANCO SICOOB ALFA'),
  ('SICOOB_GAMMA', 'SICOOB GAMMA',  3, 'BANCO SICOOB GAMMA'),
  ('CORA_BETA',     'CORA BETA',    4, 'BANCO CORA BETA '),
  ('INTER_BETA',    'INTER BETA',   5, 'BANCO INTER BETA'),
  ('BTG_GAMMA',    'BTG GAMMA',     6, 'BANCO BTG GAMMA'),
  ('INTER_GAMMA',  'INTER GAMMA',   7, 'BANCO INTER GAMMA')
on conflict (id) do nothing;
