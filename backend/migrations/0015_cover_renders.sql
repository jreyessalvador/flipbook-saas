-- Lote L7a (2026-10-16): portada completa renderizada + imagen Open Graph.
-- El worker de render (Contabo 2) pinta la hoja 1 del snapshot publicado con
-- todas sus capas y sube cover-400.webp, cover-800.webp y og-1200x630.jpg.
-- Estos punteros referencian la version publicada vigente: se limpian al
-- publicar y el worker los rellena al terminar (mientras tanto, fallback a la
-- imagen de mayor area del snapshot). cover_version_id evita servir una
-- portada de una version ya reemplazada. Idempotente.
BEGIN;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS cover_key TEXT NULL;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS og_key TEXT NULL;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS cover_version_id UUID NULL;
CREATE INDEX IF NOT EXISTS ix_render_jobs_kind ON render_jobs(kind, status);
-- Estanteria publica: cinta «NUEVO» automatica segun la fecha real de publicacion de la version vigente.
ALTER TABLE publications ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NULL;
UPDATE publications p SET published_at = v.created_at
  FROM publication_versions v
 WHERE v.id = p.published_version_id AND p.published_at IS NULL;
COMMIT;
