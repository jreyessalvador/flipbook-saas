"""Lote F (2026-10-04): exportacion a PDF.

Flujo: el panel pide un PDF -> se congela el contenido (snapshot) en un
RenderJob 'queued' -> el worker aislado de Contabo 2 lo reclama por el tunel
(api/internal_render.py), abre /render/{job} con Chromium, captura cada hoja,
monta el PDF (con hotspots como enlaces clicables) y lo sube -> 'done' -> el
panel lo descarga. Mismo contenido = mismo hash = se reutiliza el PDF.
"""
import hashlib
import json
from datetime import timedelta

from fastapi import HTTPException

from app.config import settings
from app.models.render_job import RenderJob
from app.services.trash import utcnow

RETENTION_DAYS = 30          # los PDF generados se borran solos a los 30 dias
KEEP_PER_PUBLICATION = 5     # y como mucho se guardan los 5 ultimos por edicion
STALE_RUNNING_MINUTES = 15   # un trabajo 'running' sin terminar se reintenta
MAX_ATTEMPTS = 3


def snapshot_hash(snapshot: dict) -> str:
    return hashlib.sha256(json.dumps(snapshot, sort_keys=True, default=str).encode()).hexdigest()


def export_key(job) -> str:
    return f"tenant-{job.tenant_id}/exports/{job.publication_id}/{job.id}.pdf"


def serialize_job(job) -> dict:
    return {
        "id": str(job.id),
        "status": job.status,
        "source": job.source,
        "page_count": job.page_count,
        "size_bytes": job.size_bytes,
        "error": job.error if job.status == "failed" else None,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
        "download_path": f"/api/publications/{job.publication_id}/pdf/{job.id}/download" if job.status == "done" else None,
    }


def request_pdf(db, pub, source: str, user, draft_snapshot: dict = None, version=None):
    """Crea (o reutiliza) un trabajo de PDF. Devuelve (job, reused)."""
    if source == "published":
        if version is None:
            raise HTTPException(status_code=409, detail="La edición no está publicada: publica primero o elige «Borrador actual».")
        snap = version.snapshot
    else:
        snap = draft_snapshot
    h = snapshot_hash(snap)
    # 1) Cache: mismo contenido ya exportado (o en curso)
    existing = (
        db.query(RenderJob)
        .filter(RenderJob.publication_id == pub.id, RenderJob.kind == "pdf", RenderJob.snapshot_hash == h,
                RenderJob.source == source, RenderJob.status.in_(["done", "queued", "running"]))
        .order_by(RenderJob.created_at.desc())
        .first()
    )
    if existing is not None:
        return existing, True
    # 2) Anti-abuso: trabajos activos por empresa
    active = db.query(RenderJob).filter(RenderJob.tenant_id == pub.tenant_id, RenderJob.kind == "pdf",
                                        RenderJob.status.in_(["queued", "running"])).count()
    if active >= settings.RENDER_MAX_ACTIVE_PER_TENANT:
        raise HTTPException(status_code=429, detail="Ya hay varias exportaciones en curso en tu empresa. Espera a que terminen.")
    pages = snap.get("pages") or []
    job = RenderJob(
        tenant_id=pub.tenant_id, publication_id=pub.id,
        version_id=getattr(version, "id", None) if source == "published" else None,
        source=source, status="queued", snapshot=snap, snapshot_hash=h,
        title=(pub.title or "Revista")[:200],
        page_width=int(snap.get("page_width") or pub.page_width or 210),
        page_height=int(snap.get("page_height") or pub.page_height or 297),
        page_count=len(pages), requested_by=user.id,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job, False


def requeue_stale(db) -> int:
    """Trabajos 'running' abandonados (worker caido) vuelven a la cola o fallan."""
    limit = utcnow() - timedelta(minutes=STALE_RUNNING_MINUTES)
    n = 0
    for job in db.query(RenderJob).filter(RenderJob.status == "running", RenderJob.claimed_at < limit).all():
        if job.attempts >= MAX_ATTEMPTS:
            job.status, job.error, job.finished_at = "failed", "El motor de render no respondió a tiempo", utcnow()
        else:
            job.status = "queued"
        n += 1
    if n:
        db.commit()
    return n


def cleanup_exports(db) -> int:
    """Borra PDFs caducados (>30 dias) y el exceso por edicion (mas de 5)."""
    from app.api.assets import minio_client, BUCKET_NAME
    removed = 0
    old = db.query(RenderJob).filter(RenderJob.kind == "pdf", RenderJob.created_at < utcnow() - timedelta(days=RETENTION_DAYS)).all()
    doomed = list(old)
    pubs = {j.publication_id for j in db.query(RenderJob.publication_id).filter(RenderJob.kind == "pdf").distinct()}
    for pid in pubs:
        jobs = db.query(RenderJob).filter(RenderJob.publication_id == pid, RenderJob.kind == "pdf").order_by(RenderJob.created_at.desc()).all()
        doomed += jobs[KEEP_PER_PUBLICATION:]
    seen = set()
    for job in doomed:
        if job.id in seen or job.status in ("queued", "running"):
            continue
        seen.add(job.id)
        if job.result_key:
            try:
                minio_client.remove_object(BUCKET_NAME, job.result_key)
            except Exception:
                pass
        db.delete(job)
        removed += 1
    db.commit()
    return removed


# --- Lote L7a: portada completa + imagen OG -----------------------------------
COVER_JOB_KEEP_DAYS = 7


def _first_page(snap: dict):
    pages = snap.get("pages") or []
    for pg in pages:
        if pg.get("page_type") == "front_cover" or pg.get("page_number") == 1:
            return pg
    return pages[0] if pages else None


def request_cover(db, pub, version, user_id=None, force=False):
    """Encola el render de la portada (hoja 1) de una version publicada.

    El trabajo lleva SOLO la hoja 1 (snapshot recortado): el worker no pinta ni
    descarga el resto de la revista. Si ya existe un trabajo de portada para esa
    version (en cola, en curso o terminado) se reutiliza. Devuelve el job o None."""
    snap = version.snapshot or {}
    first = _first_page(snap)
    if first is None:
        return None
    existing = (
        db.query(RenderJob)
        .filter(RenderJob.publication_id == pub.id, RenderJob.version_id == version.id, RenderJob.kind == "cover",
                RenderJob.status.in_(["queued", "running"] if force else ["queued", "running", "done"]))
        .first()
    )
    if existing is not None:
        return existing
    cover_snap = {**snap, "pages": [first]}
    job = RenderJob(
        tenant_id=pub.tenant_id, publication_id=pub.id, version_id=version.id,
        source="published", kind="cover", status="queued",
        snapshot=cover_snap, snapshot_hash=snapshot_hash(cover_snap),
        title=(pub.title or "Revista")[:200],
        page_width=int(snap.get("page_width") or pub.page_width or 210),
        page_height=int(snap.get("page_height") or pub.page_height or 297),
        page_count=1, requested_by=user_id,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def cleanup_cover_jobs(db) -> int:
    """Los trabajos de portada terminados no hacen falta pasados unos dias (los
    punteros viven en la edicion; las imagenes en MinIO no dependen del job)."""
    limit = utcnow() - timedelta(days=COVER_JOB_KEEP_DAYS)
    n = (db.query(RenderJob)
         .filter(RenderJob.kind == "cover", RenderJob.status.in_(["done", "failed"]), RenderJob.created_at < limit)
         .delete(synchronize_session=False))
    db.commit()
    return n


def cover_prefix(tenant_id, version_id) -> str:
    return f"tenant-{tenant_id}/covers/{version_id}/"


def cover_object_keys(tenant_id, version_id, job_id) -> list:
    """Claves de un renderizado concreto. Cada trabajo escribe en su propia subcarpeta
    (…/{version}/{job8}/): las portadas se sirven con cache inmutable de un ano, asi que
    re-renderizar la misma version NUNCA puede reutilizar la clave anterior."""
    base = f"{cover_prefix(tenant_id, version_id)}{str(job_id)[:8]}"
    return [f"{base}/cover-400.webp", f"{base}/cover-800.webp", f"{base}/og-1200x630.jpg"]
