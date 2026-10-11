"""Importacion PDF -> edicion (fondos rasterizados para el editor).

Desde el lote DOC-1 (11-oct-2026, RECETA §31) el PDF ya no se abre en Contabo 1:
se envia al servicio compartido cetrix-docproc (worker aislado en Contabo 2),
que devuelve:
  - el PDF OPTIMIZADO (Ghostscript perfil ebook + qpdf linealizado), que
    SUSTITUYE al original en MinIO (misma clave => pdf_url no cambia; nunca se
    guardan dos copias del mismo documento), y
  - una imagen WebP por pagina (144 ppp, rasterizada desde el original).
"""
from io import BytesIO
import logging
import uuid

from celery.exceptions import Retry

from app.workers.celery_app import celery_app
from app.db.session import SessionLocal
from app.models.publication import Publication
from app.models.page import Page
from app.models.page_element import PageElement
from app.api.assets import minio_client, ensure_bucket, BUCKET_NAME, build_asset_url
from app.services import docproc
from app.config import settings

logger = logging.getLogger(__name__)

# Los elementos usan unidades de lienzo y las medidas de la publicación se
# almacenan en milímetros. Debe coincidir con CanvasEditorV2 para llenar hoja.
PX_PER_MM = 3


def _mark_failed(db, publication_id, keys=()):
    db.rollback()
    for key in keys:
        try:
            minio_client.remove_object(BUCKET_NAME, key)
        except Exception:  # objeto huerfano: lo limpia la purga de la papelera
            pass
    publication = db.query(Publication).filter(Publication.id == publication_id).first()
    if publication and publication.status == "processing":
        publication.status = "failed"
        db.commit()


@celery_app.task(name="flipbook.pdf_import", bind=True, max_retries=12, default_retry_delay=300)
def import_pdf_task(self, publication_id: str, source_key: str):
    db = SessionLocal()
    job_id = None
    keys = []  # objetos WebP ya subidos (se borran si la importacion falla)
    try:
        publication = db.query(Publication).filter(Publication.id == publication_id).first()
        if not publication or publication.status != "processing":
            return
        # Worker de Contabo 2 desconectado: no bloquear la cola, reintentar en 5 min
        # (la edicion sigue «procesando»; el broker conserva el orden de llegada).
        try:
            if not docproc.health().get("worker_online"):
                raise docproc.DocprocUnavailable("worker docproc sin conexion")
        except docproc.DocprocUnavailable as exc:
            raise self.retry(exc=exc)

        ensure_bucket()
        response = minio_client.get_object(BUCKET_NAME, source_key)
        pdf_bytes = response.read()
        response.close(); response.release_conn()

        try:
            job_id, job = docproc.optimize_pdf(pdf_bytes, render_pages=True)
        except docproc.DocprocUnavailable as exc:
            raise self.retry(exc=exc)
        result = job["result"]
        pages = result.get("page_images") or []
        if not pages:
            raise docproc.DocprocError("El PDF no contiene páginas convertibles")

        # 1) Paginas WebP
        for pg in pages:
            data = docproc.fetch(job_id, pg["file"])
            key = f"tenant-{publication.tenant_id}/publications/{publication.id}/pages/{pg['n']}-{uuid.uuid4()}.webp"
            minio_client.put_object(BUCKET_NAME, key, BytesIO(data), len(data), content_type="image/webp")
            keys.append(key)

        # 2) El optimizado sustituye al original (misma clave). Si el original
        #    ya era lo mas ligero, el worker devuelve method="original".
        if result.get("method") != "original":
            optimized = docproc.fetch(job_id, "document.pdf")
            if optimized[:5] == b"%PDF-" and len(optimized) < len(pdf_bytes):
                minio_client.put_object(BUCKET_NAME, source_key, BytesIO(optimized), len(optimized),
                                        content_type="application/pdf",
                                        metadata={"docproc": settings.DOCPROC_PDF_PROFILE})
        logger.info("pdf_import %s: %s paginas, PDF %s -> %s bytes (%s)", publication.id, len(pages),
                    result.get("input_bytes"), result.get("output_bytes"), result.get("method"))

        first = pages[0]
        publication.total_pages = len(pages)
        publication.orientation = "landscape" if first["width_px"] > first["height_px"] else "portrait"
        publication.page_size = "Custom"
        publication.page_width = 210
        publication.page_height = round(210 * first["height_px"] / first["width_px"])
        for index, key in enumerate(keys, start=1):
            page = Page(publication_id=publication.id, page_number=index,
                        page_type="cover" if index == 1 else "back_cover" if index == len(keys) else "content",
                        content={})
            db.add(page); db.flush()
            db.add(PageElement(
                page_id=page.id, kind="image", x=0, y=0,
                width=publication.page_width * PX_PER_MM,
                height=publication.page_height * PX_PER_MM,
                z_index=0,
                props={"src": build_asset_url(key), "locked": True, "pdf_background": True},
            ))
        publication.status = "draft"
        db.commit()
    except Retry:
        raise
    except docproc.DocprocError as exc:
        # Incluye DocprocUnavailable con reintentos agotados: la edicion queda «fallida».
        logger.warning("pdf_import %s fallo: %s", publication_id, exc)
        _mark_failed(db, publication_id, keys)
    except Exception:
        _mark_failed(db, publication_id, keys)
        raise
    finally:
        if job_id:
            docproc.delete(job_id)
        db.close()
