-- Lote L4 (2026-09-28): ajustes por edicion -- SEO y sonido del visor.
-- Los ajustes se leen EN VIVO de publications (no del snapshot publicado):
-- no son contenido, y cambiarlos no debe exigir "volver a publicar".
-- Idempotente.
BEGIN;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS seo_title VARCHAR(70);
ALTER TABLE publications ADD COLUMN IF NOT EXISTS seo_description VARCHAR(160);
ALTER TABLE publications ADD COLUMN IF NOT EXISTS seo_indexable BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS sound_enabled BOOLEAN NOT NULL DEFAULT TRUE;
COMMIT;
