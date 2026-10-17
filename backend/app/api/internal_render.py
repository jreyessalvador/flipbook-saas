"""Lote F (2026-10-04): API INTERNA del worker de render (Contabo 2).

Solo accesible por el gateway nginx de Contabo 1 en el tunel wg-flipbook.
Tres barreras:
 1. nginx publico (revistas / dev-revistas) devuelve 404 a /api/internal/.
 2. X-Real-IP debe ser la IP del worker en el tunel (el nginx publico pone la
    IP real del cliente, asi que desde internet no se puede falsificar).
 3. X-Render-Token = RENDER_WORKER_TOKEN (comparacion en tiempo constante).
Sin token configurado, todo responde 404 (funcion desactivada).
"""
import hmac
import re
import uuid
import urllib.request
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.config import settings
from app.db.session import get_db
from app.models.render_job import RenderJob
from app.services.render_jobs import export_key, requeue_stale
from app.services.trash import utcnow

router = APIRouter()
YT_ID = re.compile(r"^[A-Za-z0-9_-]{6,20}$")


def require_worker(request: Request):
    token = settings.RENDER_WORKER_TOKEN or ""
    given = request.headers.get("x-render-token", "")
    real_ip = request.headers.get("x-real-ip", "")
    if not token or real_ip != settings.RENDER_GATEWAY_CLIENT_IP or not hmac.compare_digest(given, token):
        raise HTTPException(status_code=404, detail="Not Found")
    return True


def _running_job(db, job_id) -> RenderJob:
    try:
        jid = uuid.UUID(str(job_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="Not Found")
    job = db.query(RenderJob).filter(RenderJob.id == jid, RenderJob.status == "running").first()
    if job is None:
        raise HTTPException(status_code=404, detail="Not Found")
    return job


@router.post("/claim")
def claim(db: Session = Depends(get_db), _=Depends(require_worker)):
    """Reclama el siguiente trabajo (FOR UPDATE SKIP LOCKED). 204 si no hay."""
    requeue_stale(db)
    row = db.execute(text("""
        SELECT id FROM render_jobs WHERE status = 'queued'
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    """)).first()
    if row is None:
        db.rollback()
        return Response(status_code=204)
    job = db.query(RenderJob).filter(RenderJob.id == row[0]).first()
    job.status, job.claimed_at, job.attempts = "running", utcnow(), (job.attempts or 0) + 1
    db.commit()
    return {"job_id": str(job.id), "kind": job.kind or "pdf", "render_path": f"/render/{job.id}", "page_count": job.page_count,
            "page_width": job.page_width, "page_height": job.page_height, "title": job.title}


@router.get("/jobs/{job_id}/data")
def job_data(job_id: str, db: Session = Depends(get_db), _=Depends(require_worker)):
    """Contenido congelado del trabajo (solo mientras esta en curso)."""
    from app.api.public import _get_snapshot_pages
    job = _running_job(db, job_id)
    snap = job.snapshot or {}
    return {
        "job_id": str(job.id), "title": job.title, "page_width": job.page_width, "page_height": job.page_height,
        "orientation": snap.get("orientation"), "total_pages": job.page_count,
        "pages": _get_snapshot_pages(snap),
    }


@router.post("/jobs/{job_id}/result")
async def job_result(job_id: str, request: Request, db: Session = Depends(get_db), _=Depends(require_worker)):
    from app.api.assets import minio_client, BUCKET_NAME, ensure_bucket
    job = _running_job(db, job_id)
    if (job.kind or "pdf") != "pdf":
        raise HTTPException(status_code=404, detail="Not Found")
    body = await request.body()
    if not body.startswith(b"%PDF") or len(body) > settings.RENDER_MAX_PDF_BYTES:
        raise HTTPException(status_code=422, detail="PDF no valido")
    ensure_bucket()
    key = export_key(job)
    minio_client.put_object(BUCKET_NAME, key, BytesIO(body), len(body), content_type="application/pdf")
    job.result_key, job.size_bytes, job.status, job.finished_at, job.error = key, len(body), "done", utcnow(), None
    try:
        job.page_count = int(request.headers.get("x-page-count") or job.page_count)
    except ValueError:
        pass
    db.commit()
    return {"ok": True}


# Lote L7a: resultado de un trabajo de portada (tres imagenes, validadas por firma y tamano)
COVER_FILES = {
    "cover_400": ("cover-400.webp", "image/webp", 120 * 1024),
    "cover_800": ("cover-800.webp", "image/webp", 400 * 1024),
    "og": ("og-1200x630.jpg", "image/jpeg", 600 * 1024),
}
COVER_MAX_REQUEST = 1_200_000


def _valid_cover_file(field: str, data: bytes) -> bool:
    if field in ("cover_400", "cover_800"):
        return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    return data[:3] == b"\xff\xd8\xff"


@router.post("/jobs/{job_id}/cover-result")
async def cover_result(job_id: str, request: Request, db: Session = Depends(get_db), _=Depends(require_worker)):
    """El worker sube cover-400.webp, cover-800.webp y og-1200x630.jpg (multipart).
    Solo para trabajos 'cover' en curso. Si la edicion sigue en esa misma version
    publicada, se actualizan sus punteros; si ya se republico, las imagenes se descartan."""
    from app.api.assets import minio_client, BUCKET_NAME, ensure_bucket
    from app.models.publication import Publication
    from app.services.render_jobs import cover_object_keys
    job = _running_job(db, job_id)
    if job.kind != "cover" or job.version_id is None:
        raise HTTPException(status_code=404, detail="Not Found")
    try:
        if int(request.headers.get("content-length") or 0) > COVER_MAX_REQUEST:
            raise HTTPException(status_code=413, detail="Demasiado grande")
    except ValueError:
        raise HTTPException(status_code=400, detail="Solicitud no valida")
    form = await request.form()
    blobs = {}
    for field, (_name, _ctype, limit) in COVER_FILES.items():
        up = form.get(field)
        if up is None or not hasattr(up, "read"):
            raise HTTPException(status_code=422, detail=f"Falta {field}")
        data = await up.read(limit + 1)
        if not data or len(data) > limit or not _valid_cover_file(field, data):
            raise HTTPException(status_code=422, detail=f"{field} no valido")
        blobs[field] = data

    pub = db.query(Publication).filter(Publication.id == job.publication_id).first()
    ensure_bucket()
    k400, k800, kog = cover_object_keys(job.tenant_id, job.version_id, job.id)
    for field, key in (("cover_400", k400), ("cover_800", k800), ("og", kog)):
        minio_client.put_object(BUCKET_NAME, key, BytesIO(blobs[field]), len(blobs[field]),
                                content_type=COVER_FILES[field][1])
    new_keys = [k400, k800, kog]
    old_keys = []
    if pub is not None and pub.cover_key:  # portada anterior (otra version o un re-render de esta)
        old_keys = [pub.cover_key, pub.cover_key.replace("/cover-400.webp", "/cover-800.webp")] + ([pub.og_key] if pub.og_key else [])
    if pub is not None and pub.published_version_id == job.version_id:
        pub.cover_key, pub.og_key, pub.cover_version_id = k400, kog, job.version_id
        applied = True
    else:
        applied = False  # ya hay una version mas nueva (o se despublico): no se usa
    job.result_key, job.size_bytes = k400, sum(len(b) for b in blobs.values())
    job.status, job.finished_at, job.error = "done", utcnow(), None
    db.commit()
    # limpieza best-effort: las imagenes que ya no referencia nadie (la portada anterior si se
    # aplico la nueva; las recien subidas si no se aplico)
    for key in ([k for k in old_keys if k not in new_keys] if applied else new_keys):
        try:
            minio_client.remove_object(BUCKET_NAME, key)
        except Exception:
            pass
    return {"ok": True, "applied": applied}


@router.post("/jobs/{job_id}/fail")
async def job_fail(job_id: str, request: Request, db: Session = Depends(get_db), _=Depends(require_worker)):
    job = _running_job(db, job_id)
    try:
        msg = ((await request.json()) or {}).get("error") or "Error de render"
    except Exception:
        msg = "Error de render"
    job.status, job.error, job.finished_at = "failed", str(msg)[:500], utcnow()
    db.commit()
    return {"ok": True}


@router.get("/yt/{video_id}")
def youtube_thumb(video_id: str, _=Depends(require_worker)):
    """Miniatura de YouTube para pintar el video en el PDF (el worker no tiene
    internet). Host fijo + id validado: no es un proxy abierto (sin SSRF)."""
    if not YT_ID.match(video_id):
        raise HTTPException(status_code=404, detail="Not Found")
    for name in ("maxresdefault", "hqdefault"):
        try:
            with urllib.request.urlopen(f"https://i.ytimg.com/vi/{video_id}/{name}.jpg", timeout=8) as r:
                data = r.read(5 * 1024 * 1024)
                if r.status == 200 and data:
                    return Response(content=data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})
        except Exception:
            continue
    raise HTTPException(status_code=404, detail="Not Found")
