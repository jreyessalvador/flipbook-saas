-- Lote L5 (2026-10-03): descarga del PDF por edicion + papelera 30 dias.
-- allow_download: el lector publico puede descargar el PDF original (solo
--   ediciones importadas desde PDF, que son las que tienen pdf_url).
--   Desactivado por defecto (decision de Carlos: protege el contenido).
-- deleted_at / deleted_by: borrado logico. Las borradas desaparecen del panel,
--   kiosco y lector; se purgan solas a los 30 dias (tarea Celery beat diaria).
--   El indice unico de slug sigue aplicando a las borradas: asi restaurar
--   nunca choca con una edicion nueva (unique_publication_slug las tiene en
--   cuenta).
-- Idempotente.
BEGIN;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS allow_download BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS deleted_by UUID NULL REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_publications_deleted_at ON publications(deleted_at) WHERE deleted_at IS NOT NULL;
COMMIT;
