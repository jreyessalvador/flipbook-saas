"""Tareas periodicas (Celery beat, embebido en el pdf-worker con ``-B``)."""
import logging

from app.workers.celery_app import celery_app
from app.db.session import SessionLocal

logger = logging.getLogger("flipbook.maintenance")


@celery_app.task(name="flipbook.purge_trash")
def purge_trash_task():
    """Lote L5: purga las ediciones con mas de 30 dias en la papelera."""
    from app.services.trash import purge_expired
    db = SessionLocal()
    try:
        results = purge_expired(db)
        logger.info("Purga de papelera: %d edicion(es) eliminadas definitivamente", len(results))
        return {"purged": len(results)}
    finally:
        db.close()


@celery_app.task(name="flipbook.cleanup_exports")
def cleanup_exports_task():
    """Lote F: borra PDFs exportados con mas de 30 dias (y el exceso por edicion)."""
    from app.services.render_jobs import cleanup_exports
    db = SessionLocal()
    try:
        n = cleanup_exports(db)
        logger.info("Limpieza de PDFs exportados: %d eliminados", n)
        return {"removed": n}
    finally:
        db.close()
