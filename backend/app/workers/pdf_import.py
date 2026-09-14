"""Conversión aislada PDF -> fondos rasterizados para el editor."""
from io import BytesIO
from pathlib import Path
import uuid
from pdf2image import convert_from_bytes
from app.workers.celery_app import celery_app
from app.db.session import SessionLocal
from app.models.publication import Publication
from app.models.page import Page
from app.models.page_element import PageElement
from app.api.assets import minio_client, ensure_bucket, BUCKET_NAME, build_asset_url

# Los elementos usan unidades de lienzo y las medidas de la publicación se
# almacenan en milímetros. Debe coincidir con CanvasEditorV2 para llenar hoja.
PX_PER_MM = 3


@celery_app.task(name="flipbook.pdf_import")
def import_pdf_task(publication_id: str, source_key: str):
    db = SessionLocal()
    try:
        publication = db.query(Publication).filter(Publication.id == publication_id).first()
        if not publication or publication.status != "processing":
            return
        ensure_bucket()
        response = minio_client.get_object(BUCKET_NAME, source_key)
        pdf_bytes = response.read()
        response.close(); response.release_conn()
        images = convert_from_bytes(pdf_bytes, dpi=144, fmt="jpeg", jpegopt={"quality": 88, "optimize": True})
        if not images:
            raise ValueError("El PDF no contiene páginas convertibles")
        publication.total_pages = len(images)
        first = images[0]
        publication.orientation = "landscape" if first.width > first.height else "portrait"
        publication.page_size = "Custom"
        publication.page_width = 210
        publication.page_height = round(210 * first.height / first.width)
        for index, image in enumerate(images, start=1):
            data = BytesIO(); image.save(data, format="JPEG", quality=88, optimize=True); data.seek(0)
            key = f"tenant-{publication.tenant_id}/publications/{publication.id}/pages/{index}-{uuid.uuid4()}.jpg"
            minio_client.put_object(BUCKET_NAME, key, data, data.getbuffer().nbytes, content_type="image/jpeg")
            page = Page(publication_id=publication.id, page_number=index, page_type="cover" if index == 1 else "back_cover" if index == len(images) else "content", content={})
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
    except Exception:
        db.rollback()
        publication = db.query(Publication).filter(Publication.id == publication_id).first()
        if publication:
            publication.status = "failed"; db.commit()
        raise
    finally:
        db.close()
