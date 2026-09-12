-- 0002_lote4_gallery_kind.sql -- Lote 4 (Galeria/Collage/GIF).
--
-- Galeria y Collage comparten el nuevo PageElementKind.gallery (ver
-- backend/app/schemas/page_element.py y backend/app/models/page_element.py);
-- GIF reutiliza kind='image' y no necesita cambios de esquema. Este archivo
-- es SOLO para bases de datos EXISTENTES (creadas antes del Lote 4) -- para
-- una base de datos nueva, 0001_editor_v2.sql ya crea la tabla con el CHECK
-- actualizado, no hace falta correr este archivo.
ALTER TABLE page_elements DROP CONSTRAINT IF EXISTS ck_page_elements_kind;
ALTER TABLE page_elements ADD CONSTRAINT ck_page_elements_kind
    CHECK (kind IN ('image','text','shape','video','audio','hotspot','gallery'));
