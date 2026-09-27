-- Lote Kiosco (2026-09-27): URL amigable por edicion /r/{empresa}/{coleccion}/{edicion}.
-- publications.slug es unico dentro de su coleccion. Se rellena a partir de
-- edition_label (o del titulo) sin acentos. Idempotente.
BEGIN;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS slug TEXT;

WITH base AS (
  SELECT id, collection_id,
         COALESCE(NULLIF(trim(both '-' from regexp_replace(
           translate(lower(COALESCE(NULLIF(btrim(edition_label), ''), title)),
                     'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
                     'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc'),
           '[^a-z0-9]+', '-', 'g')), ''), 'edicion') AS s
  FROM publications WHERE slug IS NULL
), numbered AS (
  SELECT b.id,
         CASE WHEN row_number() OVER (PARTITION BY b.collection_id, b.s ORDER BY p.created_at) = 1
              THEN left(b.s, 80)
              ELSE left(b.s, 76) || '-' || row_number() OVER (PARTITION BY b.collection_id, b.s ORDER BY p.created_at)
         END AS slug
  FROM base b JOIN publications p ON p.id = b.id
)
UPDATE publications p SET slug = n.slug FROM numbered n WHERE p.id = n.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_publications_collection_slug ON publications(collection_id, slug) WHERE slug IS NOT NULL;
COMMIT;
