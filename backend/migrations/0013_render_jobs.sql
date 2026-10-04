-- Lote F (2026-10-04): exportacion a PDF desde el panel (render fiel en el
-- worker aislado de Contabo 2, via tunel wg-flipbook).
-- Cada fila es un trabajo de render con una COPIA CONGELADA del contenido
-- (snapshot) en el momento de pedirlo: el PDF siempre corresponde a lo que el
-- editor vio al pulsar el boton, aunque luego se siga editando. snapshot_hash
-- permite reutilizar un PDF ya generado del mismo contenido (cache).
-- Idempotente.
BEGIN;
CREATE TABLE IF NOT EXISTS render_jobs (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    publication_id  UUID NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
    version_id      UUID NULL,
    source          VARCHAR(12) NOT NULL DEFAULT 'published',
    kind            VARCHAR(12) NOT NULL DEFAULT 'pdf',
    status          VARCHAR(12) NOT NULL DEFAULT 'queued',
    snapshot        JSONB NOT NULL,
    snapshot_hash   VARCHAR(64) NOT NULL,
    title           VARCHAR(200) NOT NULL DEFAULT '',
    page_width      INTEGER NOT NULL,
    page_height     INTEGER NOT NULL,
    page_count      INTEGER NOT NULL DEFAULT 0,
    requested_by    UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    result_key      TEXT NULL,
    size_bytes      BIGINT NULL,
    error           TEXT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at      TIMESTAMPTZ NULL,
    finished_at     TIMESTAMPTZ NULL,
    CONSTRAINT ck_render_jobs_status CHECK (status IN ('queued','running','done','failed')),
    CONSTRAINT ck_render_jobs_source CHECK (source IN ('published','draft'))
);
CREATE INDEX IF NOT EXISTS ix_render_jobs_queue ON render_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS ix_render_jobs_pub ON render_jobs(publication_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_render_jobs_cache ON render_jobs(publication_id, snapshot_hash) WHERE status = 'done';
COMMIT;
