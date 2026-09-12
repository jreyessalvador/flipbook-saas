-- Fase A: fundaciones de datos del editor v2 (ver docs/arquitectura-editor-2026-09-12.md)
-- Idempotente (IF NOT EXISTS donde aplica) para poder re-ejecutarse sin romper nada.
-- Ejecutar sobre la BD "flipbook" ya existente (no reemplaza Base.metadata.create_all,
-- es la version SQL explicita para entornos donde no se quiere depender del ORM al arrancar).

BEGIN;

-- 1) assets: metadatos de archivos subidos a MinIO
CREATE TABLE IF NOT EXISTS assets (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id),
    kind              TEXT NOT NULL CHECK (kind IN ('image','video','audio')),
    storage_key       TEXT NOT NULL,
    mime_type         TEXT NOT NULL,
    size_bytes        BIGINT NOT NULL,
    width_px          INT,
    height_px         INT,
    duration_seconds  NUMERIC,
    created_by        UUID NOT NULL REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2) publication_versions: snapshot inmutable (debe existir ANTES de la columna
--    publications.published_version_id que la referencia)
CREATE TABLE IF NOT EXISTS publication_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publication_id  UUID NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
    snapshot        JSONB NOT NULL,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_publication_versions_publication_id ON publication_versions(publication_id);

-- 3) publications: nuevas columnas (orientation/page_width/page_height/total_pages
--    YA EXISTEN en este repo desde antes -- solo se agregan las dos nuevas)
ALTER TABLE publications ADD COLUMN IF NOT EXISTS page_turn_sound_asset_id UUID REFERENCES assets(id);
ALTER TABLE publications ADD COLUMN IF NOT EXISTS published_version_id UUID REFERENCES publication_versions(id);

-- 4) pages: version para concurrencia optimista
ALTER TABLE pages ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1;

-- 5) page_elements: reemplaza el uso de pages.content (JSON blob compartido,
--    causa raiz de la fuga de contenido entre paginas del editor anterior)
CREATE TABLE IF NOT EXISTS page_elements (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id       UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL CHECK (kind IN ('image','text','shape','video','audio','hotspot','gallery')),
    x             NUMERIC NOT NULL,
    y             NUMERIC NOT NULL,
    width         NUMERIC NOT NULL,
    height        NUMERIC NOT NULL,
    rotation_deg  NUMERIC NOT NULL DEFAULT 0,
    z_index       INT NOT NULL DEFAULT 0,
    props         JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_page_elements_page_id ON page_elements(page_id);

-- 6) edit_locks: "un editor a la vez por publicacion"
CREATE TABLE IF NOT EXISTS edit_locks (
    publication_id  UUID PRIMARY KEY REFERENCES publications(id) ON DELETE CASCADE,
    locked_by_user  UUID NOT NULL REFERENCES users(id),
    locked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    heartbeat_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
