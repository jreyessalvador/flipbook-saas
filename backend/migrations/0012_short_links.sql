-- Lote S1 (2026-10-04): enlace corto propio por edicion.
-- revistas.cetrix.com.mx/s/{code} -> 302 a la URL canonica /r/{empresa}/{coleccion}/{edicion}.
-- El codigo es FIJO por edicion: no cambia aunque se renombre, cambie el slug o
-- se mueva de coleccion, asi los QR impresos nunca se rompen. clicks = visitas
-- humanas por el enlace corto (sin cookies; los bots de vista previa no cuentan).
-- Si en el futuro se compra un dominio corto propio, los mismos codigos sirven
-- (solo nginx + certificado). Idempotente.
BEGIN;
CREATE TABLE IF NOT EXISTS short_links (
    code            VARCHAR(16) PRIMARY KEY,
    publication_id  UUID NOT NULL UNIQUE REFERENCES publications(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    clicks          BIGINT NOT NULL DEFAULT 0,
    last_click_at   TIMESTAMPTZ NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_short_links_code CHECK (code ~ '^[A-Za-z0-9]{4,16}$')
);
CREATE INDEX IF NOT EXISTS ix_short_links_tenant ON short_links(tenant_id);

-- Backfill: un codigo base62 de 6 caracteres para cada edicion existente.
DO $$
DECLARE
    alphabet CONSTANT TEXT := '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
    r RECORD;
    c TEXT;
    i INT;
BEGIN
    FOR r IN SELECT p.id, p.tenant_id FROM publications p
             WHERE NOT EXISTS (SELECT 1 FROM short_links s WHERE s.publication_id = p.id) LOOP
        LOOP
            c := '';
            FOR i IN 1..6 LOOP
                c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
            END LOOP;
            EXIT WHEN NOT EXISTS (SELECT 1 FROM short_links WHERE code = c);
        END LOOP;
        INSERT INTO short_links(code, publication_id, tenant_id) VALUES (c, r.id, r.tenant_id);
    END LOOP;
END $$;
COMMIT;
