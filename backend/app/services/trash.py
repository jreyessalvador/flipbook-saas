"""Papelera de ediciones (Lote L5, 2026-10-03).

- Borrar una edicion = moverla a la papelera (``deleted_at``); sale del
  kiosco al instante (``is_public = False``) y deja de verse en todo el panel
  (ver app/db/soft_delete.py).
- Restaurar (admin+) la devuelve PRIVADA a su coleccion, con su slug intacto.
- Purgar (owner, o automatico a los ``TRASH_RETENTION_DAYS`` dias) la borra de
  verdad: filas en BD (paginas, elementos, versiones y bloqueos caen por
  ON DELETE CASCADE) y los objetos de MinIO que SOLO usaba esa edicion.

Archivos compartidos: un clon reutiliza por referencia las imagenes del
original, y la biblioteca de la empresa (tabla ``assets``) es independiente
de las ediciones. Por eso solo se borran objetos de MinIO propios de la
edicion (su PDF original y ``tenant-*/publications/{id}/...``) y SOLO si
ningun otro elemento, snapshot, edicion o asset los referencia.
"""
from datetime import datetime, timedelta, timezone
import logging

from sqlalchemy import text

from app.models.publication import Publication

logger = logging.getLogger("flipbook.trash")

TRASH_RETENTION_DAYS = 30
SERVE_PREFIX = "/api/assets/serve/"


def utcnow():
    return datetime.now(timezone.utc)


def days_left(deleted_at) -> int:
    if deleted_at is None:
        return TRASH_RETENTION_DAYS
    if deleted_at.tzinfo is None:
        deleted_at = deleted_at.replace(tzinfo=timezone.utc)
    remaining = deleted_at + timedelta(days=TRASH_RETENTION_DAYS) - utcnow()
    return max(0, remaining.days + (1 if remaining.seconds > 0 else 0))


def storage_key_from_url(url):
    """'/api/assets/serve/tenant-x/...' -> 'tenant-x/...' (None si no es nuestro)."""
    if not url:
        return None
    idx = url.find(SERVE_PREFIX)
    if idx < 0:
        return None
    return url[idx + len(SERVE_PREFIX):] or None


def _like_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _is_referenced(db, key: str) -> bool:
    pat = f"%{_like_escape(key)}%"
    row = db.execute(text("""
        SELECT 1 WHERE
          EXISTS (SELECT 1 FROM page_elements WHERE props::text LIKE :pat ESCAPE '\\')
          OR EXISTS (SELECT 1 FROM publication_versions WHERE snapshot::text LIKE :pat ESCAPE '\\')
          OR EXISTS (SELECT 1 FROM publications WHERE pdf_url LIKE :pat ESCAPE '\\')
          OR EXISTS (SELECT 1 FROM assets WHERE storage_key = :key)
    """), {"pat": pat, "key": key}).first()
    return row is not None


def _candidate_keys(pub, minio_client, bucket):
    keys = set()
    pdf_key = storage_key_from_url(pub.pdf_url)
    if pdf_key:
        keys.add(pdf_key)
    prefix = f"tenant-{pub.tenant_id}/publications/{pub.id}/"
    try:
        for obj in minio_client.list_objects(bucket, prefix=prefix, recursive=True):
            keys.add(obj.object_name)
    except Exception as exc:  # MinIO caido: se purga la BD igual, los objetos quedan huerfanos
        logger.warning("No se pudo listar %s en MinIO: %s", prefix, exc)
    return keys


def purge_publication(db, pub) -> dict:
    """Borrado fisico de una edicion YA en la papelera. Hace commit."""
    from app.api.assets import minio_client, BUCKET_NAME

    candidates = _candidate_keys(pub, minio_client, BUCKET_NAME)
    pub_id = str(pub.id)
    db.delete(pub)
    db.commit()

    removed, kept = 0, 0
    for key in sorted(candidates):
        if _is_referenced(db, key):
            kept += 1
            continue
        try:
            minio_client.remove_object(BUCKET_NAME, key)
            removed += 1
        except Exception as exc:
            logger.warning("No se pudo borrar %s de MinIO: %s", key, exc)
    logger.info("Edicion %s purgada: %d objetos borrados, %d conservados (en uso)", pub_id, removed, kept)
    return {"publication_id": pub_id, "objects_removed": removed, "objects_kept": kept}


def purge_expired(db, retention_days: int = TRASH_RETENTION_DAYS) -> list:
    """Purga las ediciones con mas de ``retention_days`` dias en la papelera."""
    limit = utcnow() - timedelta(days=retention_days)
    expired = (
        db.query(Publication)
        .execution_options(include_deleted=True)
        .filter(Publication.deleted_at.isnot(None), Publication.deleted_at < limit)
        .all()
    )
    results = []
    for pub in expired:
        try:
            results.append(purge_publication(db, pub))
        except Exception:
            db.rollback()
            logger.exception("Fallo purgando la edicion %s", pub.id)
    return results
