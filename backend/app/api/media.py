from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session
from sqlalchemy import func
import uuid
from datetime import datetime, timedelta

from app.db.session import get_db
from app.api.auth import get_current_user
from app.models.user import User
from app.models.publication import Publication
from app.models.page import Page
from app.models.asset import Asset
from app.models.analytics import PageView
from app.schemas.publication import AssetResponse, AnalyticsResponse
from app.services.minio_service import minio_service
from app.services.pdf_service import pdf_processor
from app.config import settings

router = APIRouter()

@router.post("/publications/{pub_id}/upload-pdf", status_code=status.HTTP_202_ACCEPTED)
async def upload_pdf(
    pub_id: uuid.UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    pub = db.query(Publication).filter(
        Publication.id == pub_id,
        Publication.tenant_id == current_user.tenant_id
    ).first()
    if not pub:
        raise HTTPException(status_code=404, detail="Publicacion no encontrada")
    if not file.content_type == "application/pdf":
        raise HTTPException(status_code=400, detail="Solo se aceptan archivos PDF")
    pdf_bytes = await file.read()
    if len(pdf_bytes) > settings.MAX_PDF_SIZE:
        raise HTTPException(status_code=413, detail="PDF demasiado grande (max 50MB)")
    bucket = minio_service.get_bucket_name(str(current_user.tenant_id))
    try:
        pages_data = pdf_processor.process_pdf_upload(pdf_bytes, str(pub_id), bucket)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error procesando PDF: {str(e)}")
    db.query(Page).filter(Page.publication_id == pub_id).delete()
    for p in pages_data:
        page = Page(
            id=uuid.uuid4(),
            publication_id=pub_id,
            page_number=p["page_number"],
            image_url=p["image_url"],
            thumbnail_url=p["thumbnail_url"],
            width=p["width"],
            height=p["height"]
        )
        db.add(page)
    pub.page_count = len(pages_data)
    if pages_data:
        pub.cover_url = pages_data[0]["thumbnail_url"]
    pub.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(pub)
    return {"message": f"PDF procesado: {len(pages_data)} paginas", "page_count": len(pages_data), "publication_id": str(pub_id)}

@router.post("/assets/upload", response_model=AssetResponse, status_code=status.HTTP_201_CREATED)
async def upload_asset(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    content_type = file.content_type or "application/octet-stream"
    if content_type.startswith("image/"):
        asset_type = "image"
        max_size = settings.MAX_IMAGE_SIZE
    elif content_type.startswith("video/"):
        asset_type = "video"
        max_size = settings.MAX_VIDEO_SIZE
    elif content_type == "application/pdf":
        asset_type = "pdf"
        max_size = settings.MAX_PDF_SIZE
    else:
        asset_type = "file"
        max_size = settings.MAX_IMAGE_SIZE
    file_bytes = await file.read()
    if len(file_bytes) > max_size:
        raise HTTPException(status_code=413, detail="Archivo demasiado grande")
    bucket = minio_service.get_bucket_name(str(current_user.tenant_id))
    ext = file.filename.split(".")[-1] if "." in file.filename else "bin"
    object_key = f"assets/{uuid.uuid4()}.{ext}"
    try:
        if asset_type == "image":
            file_bytes = pdf_processor.optimize_image(file_bytes)
        url = minio_service.upload_file(bucket, object_key, file_bytes, content_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error subiendo archivo: {str(e)}")
    asset = Asset(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        filename=f"{uuid.uuid4()}.{ext}",
        original_filename=file.filename,
        content_type=content_type,
        file_size=len(file_bytes),
        asset_type=asset_type,
        url=url,
        bucket=bucket,
        object_key=object_key
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset

@router.get("/publications/{pub_id}/analytics", response_model=AnalyticsResponse)
def get_analytics(
    pub_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    pub = db.query(Publication).filter(
        Publication.id == pub_id,
        Publication.tenant_id == current_user.tenant_id
    ).first()
    if not pub:
        raise HTTPException(status_code=404, detail="Publicacion no encontrada")
    stats = db.query(
        func.count(PageView.id).label("total"),
        func.avg(PageView.pages_read).label("avg_pages"),
        func.avg(PageView.time_spent).label("avg_time")
    ).filter(PageView.publication_id == pub_id).first()
    views_by_day = db.query(
        func.date(PageView.created_at).label("date"),
        func.count(PageView.id).label("views")
    ).filter(
        PageView.publication_id == pub_id,
        PageView.created_at >= datetime.utcnow() - timedelta(days=30)
    ).group_by(func.date(PageView.created_at)).order_by("date").all()
    return AnalyticsResponse(
        publication_id=pub_id,
        total_views=pub.view_count,
        unique_views=pub.unique_views,
        avg_pages_read=float(stats.avg_pages or 0),
        avg_time_spent=float(stats.avg_time or 0),
        views_by_day=[{"date": str(r.date), "views": r.views} for r in views_by_day]
    )

@router.get("/p/{slug}")
def view_publication_public(slug: str, db: Session = Depends(get_db)):
    """Endpoint publico para ver flipbook por slug"""
    pub = db.query(Publication).filter(
        Publication.slug == slug,
        Publication.status == "published"
    ).first()
    if not pub:
        raise HTTPException(status_code=404, detail="Publicacion no encontrada o no publicada")
    pub.view_count += 1
    db.commit()
    pages = db.query(Page).filter(Page.publication_id == pub.id).order_by(Page.page_number).all()
    return {
        "id": str(pub.id),
        "title": pub.title,
        "description": pub.description,
        "flip_duration": pub.flip_duration,
        "background_color": pub.background_color,
        "show_controls": pub.show_controls,
        "allow_download": pub.allow_download,
        "page_count": pub.page_count,
        "pages": [{"page_number": p.page_number, "image_url": p.image_url, "thumbnail_url": p.thumbnail_url, "width": p.width, "height": p.height} for p in pages]
    }
