"""Lote F (2026-10-04): «Descargar PDF» desde el panel (editor o superior)."""
from typing import Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.rbac import require_role
from app.core.slugs import slugify
from app.db.session import get_db
from app.models.publication import Publication
from app.models.publication_version import PublicationVersion
from app.models.render_job import RenderJob
from app.models.user import User
from app.services.render_jobs import request_pdf, serialize_job

router = APIRouter()


class PdfRequest(BaseModel):
    source: Optional[str] = "published"  # published | draft


def _pub(db, publication_id, user) -> Publication:
    try:
        pid = uuid.UUID(str(publication_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="Publication not found")
    pub = db.query(Publication).filter(Publication.id == pid, Publication.tenant_id == user.effective_tenant_id).first()
    if not pub:
        raise HTTPException(status_code=404, detail="Publication not found")
    return pub


@router.post("/{publication_id}/pdf", status_code=202)
def create_pdf(publication_id: str, data: PdfRequest, db: Session = Depends(get_db), current_user: User = Depends(require_role("editor"))):
    from app.api.publications import _serialize_publication_snapshot
    pub = _pub(db, publication_id, current_user)
    source = data.source if data.source in ("published", "draft") else "published"
    version = None
    draft = None
    if source == "published":
        if pub.published_version_id:
            version = db.query(PublicationVersion).filter(PublicationVersion.id == pub.published_version_id).first()
    else:
        draft = _serialize_publication_snapshot(db, pub)
    job, reused = request_pdf(db, pub, source, current_user, draft_snapshot=draft, version=version)
    return {**serialize_job(job), "reused": reused}


@router.get("/{publication_id}/pdf")
def list_pdfs(publication_id: str, db: Session = Depends(get_db), current_user: User = Depends(require_role("editor"))):
    pub = _pub(db, publication_id, current_user)
    jobs = db.query(RenderJob).filter(RenderJob.publication_id == pub.id).order_by(RenderJob.created_at.desc()).limit(5).all()
    return {"has_published": bool(pub.published_version_id), "jobs": [serialize_job(j) for j in jobs]}


@router.get("/{publication_id}/pdf/{job_id}/download")
def download_pdf(publication_id: str, job_id: str, db: Session = Depends(get_db), current_user: User = Depends(require_role("editor"))):
    from app.api.assets import minio_client, BUCKET_NAME
    pub = _pub(db, publication_id, current_user)
    try:
        jid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="PDF no encontrado")
    job = db.query(RenderJob).filter(RenderJob.id == jid, RenderJob.publication_id == pub.id, RenderJob.status == "done").first()
    if not job or not job.result_key:
        raise HTTPException(status_code=404, detail="PDF no encontrado")
    try:
        obj = minio_client.get_object(BUCKET_NAME, job.result_key)
    except Exception:
        raise HTTPException(status_code=404, detail="PDF no encontrado")

    def stream():
        try:
            for chunk in obj.stream(64 * 1024):
                yield chunk
        finally:
            obj.close(); obj.release_conn()

    suffix = "-borrador" if job.source == "draft" else ""
    name = slugify(pub.slug or pub.title or "revista", 80) + suffix + ".pdf"
    headers = {"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "private, no-store"}
    if job.size_bytes:
        headers["Content-Length"] = str(job.size_bytes)
    return StreamingResponse(stream(), media_type="application/pdf", headers=headers)
