-- Orden manual de las ediciones dentro de su coleccion (kiosco: izquierda -> derecha,
-- la mas reciente a la derecha). Aditiva: columna nula + indice. Idempotente.
ALTER TABLE publications ADD COLUMN IF NOT EXISTS sort_index integer;

-- Relleno inicial: por fecha de publicacion (o de alta), la mas antigua primero.
UPDATE publications p
   SET sort_index = s.rn
  FROM (SELECT id,
               row_number() OVER (PARTITION BY collection_id
                                  ORDER BY COALESCE(published_at, created_at) ASC, created_at ASC, id) AS rn
          FROM publications) s
 WHERE p.id = s.id AND p.sort_index IS NULL;

CREATE INDEX IF NOT EXISTS ix_publications_collection_sort ON publications (collection_id, sort_index);
