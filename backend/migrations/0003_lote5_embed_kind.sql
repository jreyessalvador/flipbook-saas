-- 0003_lote5_embed_kind.sql -- Lote 5 (YouTube/Vimeo).
--
-- Nuevo PageElementKind.embed (ver backend/app/schemas/page_element.py y
-- backend/app/models/page_element.py) para embeds de YouTube/Vimeo:
-- props = {provider, video_id, url}. Este archivo es SOLO para bases de
-- datos EXISTENTES (creadas antes del Lote 5) -- para una base de datos
-- nueva, 0001_editor_v2.sql ya crea la tabla con el CHECK actualizado, no
-- hace falta correr este archivo.
--
-- De paso corrige una inconsistencia real (no bloqueante, ya que el CHECK
-- real en Postgres se administra via SQL crudo, no via SQLAlchemy
-- metadata.create_all): el CheckConstraint declarado en el modelo Python
-- (backend/app/models/page_element.py) se habia quedado sin 'gallery' desde
-- el Lote 4 -- se corrige junto con este cambio para que el string quede
-- consistente con el CHECK real de la base de datos.
ALTER TABLE page_elements DROP CONSTRAINT IF EXISTS ck_page_elements_kind;
ALTER TABLE page_elements ADD CONSTRAINT ck_page_elements_kind
    CHECK (kind IN ('image','text','shape','video','audio','hotspot','gallery','embed'));
