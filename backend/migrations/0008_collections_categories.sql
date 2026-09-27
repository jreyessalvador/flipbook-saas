-- Lote C (2026-09-27): Colecciones -> Ediciones + categorias comunes del kiosco.
-- Una "Coleccion" agrupa ediciones (las filas de `publications`) de UN tenant.
-- El aislamiento por tenant se garantiza en la BD: FK compuesta
-- (collection_id, tenant_id) -> collections(id, tenant_id), asi una edicion
-- nunca puede apuntar a una coleccion de otra empresa aunque falle la API.
-- Idempotente: se puede re-ejecutar sin efectos.
BEGIN;

-- Categorias: lista COMUN de la plataforma (la gestiona Super Admin CETRIX).
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO categories(slug, name, sort_order) VALUES
  ('turismo-viajes','Turismo y viajes',10),
  ('negocios-economia','Negocios y economía',20),
  ('moda-belleza','Moda y belleza',30),
  ('estilo-de-vida','Estilo de vida',40),
  ('gastronomia','Gastronomía',50),
  ('bodas-eventos','Bodas y eventos',60),
  ('arte-cultura','Arte y cultura',70),
  ('salud-bienestar','Salud y bienestar',80),
  ('deportes','Deportes',90),
  ('tecnologia','Tecnología',100),
  ('educacion','Educación',110),
  ('inmobiliaria','Inmobiliaria',120),
  ('motor','Motor',130),
  ('hogar-decoracion','Hogar y decoración',140),
  ('catalogos-producto','Catálogos de producto',150),
  ('institucional','Institucional y corporativo',160),
  ('otros','Otros',999)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  slug TEXT NOT NULL,
  description TEXT,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_collections_tenant_slug UNIQUE (tenant_id, slug),
  CONSTRAINT uq_collections_id_tenant UNIQUE (id, tenant_id)
);
CREATE INDEX IF NOT EXISTS ix_collections_tenant ON collections(tenant_id);
-- Como maximo una coleccion por defecto por tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_collections_default_per_tenant ON collections(tenant_id) WHERE is_default;

-- Coleccion por defecto para cada tenant existente
INSERT INTO collections(tenant_id, name, slug, description, is_default)
SELECT t.id, 'General', 'general', 'Colección creada automáticamente con las ediciones existentes.', TRUE
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM collections c WHERE c.tenant_id = t.id AND c.is_default);

-- Ediciones: pertenencia a coleccion + etiqueta de edicion ("Sep 2026", "No. 34")
ALTER TABLE publications ADD COLUMN IF NOT EXISTS collection_id UUID;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS edition_label VARCHAR(100);

UPDATE publications p
SET collection_id = c.id
FROM collections c
WHERE p.collection_id IS NULL AND c.tenant_id = p.tenant_id AND c.is_default;

ALTER TABLE publications ALTER COLUMN collection_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_publications_collection_same_tenant') THEN
    ALTER TABLE publications
      ADD CONSTRAINT fk_publications_collection_same_tenant
      FOREIGN KEY (collection_id, tenant_id) REFERENCES collections(id, tenant_id)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_publications_collection ON publications(collection_id);

-- Toda empresa nueva nace con su coleccion "General"
CREATE OR REPLACE FUNCTION trg_tenant_default_collection() RETURNS trigger AS $$
BEGIN
  INSERT INTO collections(tenant_id, name, slug, description, is_default)
  VALUES (NEW.id, 'General', 'general', 'Colección por defecto.', TRUE)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenant_default_collection ON tenants;
CREATE TRIGGER tenant_default_collection AFTER INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION trg_tenant_default_collection();

COMMIT;
