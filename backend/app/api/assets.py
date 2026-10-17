from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import desc
from minio import Minio
from minio.error import S3Error
import uuid
import time
import logging
from io import BytesIO
import os
import re
from email.utils import format_datetime

from app.db.session import get_db
from app.api.auth import get_current_user
from app.core.rbac import require_role
from app.models.user import User
from app.models.asset import Asset
from app.config import settings
from app.services.quota import require_storage_quota

logger = logging.getLogger("flipbook.assets")

router = APIRouter(prefix="/assets", tags=["assets"])

# Cliente MinIO
minio_client = Minio(
    settings.MINIO_ENDPOINT,
    access_key=settings.MINIO_ACCESS_KEY,
    secret_key=settings.MINIO_SECRET_KEY,
    secure=settings.MINIO_SECURE
)

BUCKET_NAME = "flipbook-assets"
_bucket_ready = False


def ensure_bucket(retries: int = 5, backoff_seconds: float = 1.5) -> bool:
    """
    Verifica/crea el bucket con reintentos. NO se ejecuta a nivel de import:
    se llama desde el evento de startup de FastAPI (ver main.py) y, como
    respaldo, de forma perezosa antes de cada upload. Antes, este chequeo
    corria al importar el modulo y cualquier fallo de DNS/red durante el
    arranque (MinIO aun no resuelto por CoreDNS) tumbaba el proceso entero
    con exit code 1, causando el crash loop observado en produccion.
    """
    global _bucket_ready
    if _bucket_ready:
        return True

    for attempt in range(1, retries + 1):
        try:
            if not minio_client.bucket_exists(BUCKET_NAME):
                minio_client.make_bucket(BUCKET_NAME)
            _bucket_ready = True
            logger.info("Bucket '%s' listo (intento %d)", BUCKET_NAME, attempt)
            return True
        except Exception as e:
            logger.warning(
                "No se pudo verificar/crear bucket '%s' (intento %d/%d): %s",
                BUCKET_NAME, attempt, retries, e
            )
            if attempt < retries:
                time.sleep(backoff_seconds * attempt)

    logger.error(
        "Bucket '%s' no disponible tras %d intentos. La API seguira arrancando; "
        "se reintentara en el primer upload.", BUCKET_NAME, retries
    )
    return False


def build_asset_url(object_name: str) -> str:
    """
    Ruta RELATIVA (no host hardcodeado) servida por este mismo backend via
    /api/assets/serve/{object_name}. Antes devolvia un host fijo
    (http://api.flipbook.local/...) que solo resolvia en produccion -- rompia
    cualquier otro entorno (dev en ia-lavatur via Tailscale, etc.). El
    frontend antepone su propio VITE_API_URL (services/api.js) al mostrar la
    imagen, asi que esta funcion no necesita saber en que host corre.
    """
    return f"/api/assets/serve/{object_name}"


@router.post("/upload")
async def upload_asset(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("editor"))
):
    try:
        ensure_bucket()
        # Tipos permitidos: imagen (Fase B) + audio (Lote 3) + video (Lote 7
        # -- subida de video real, pedido explicito de Carlos: "Tambien
        # permitir subir video real"). Cada categoria tiene su propio limite
        # de tamano en app.config.settings (MAX_IMAGE_SIZE / MAX_AUDIO_SIZE /
        # MAX_VIDEO_SIZE) -- nunca se valida el tamano de un tipo contra el
        # limite de otro.
        allowed_image_types = ["image/jpeg", "image/png", "image/gif", "image/webp"]
        allowed_audio_types = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm"]
        allowed_video_types = ["video/mp4", "video/webm", "video/quicktime"]
        if file.content_type in allowed_image_types:
            asset_kind = "image"
            max_size = settings.MAX_IMAGE_SIZE
            max_size_label = "10MB"
        elif file.content_type in allowed_audio_types:
            asset_kind = "audio"
            max_size = settings.MAX_AUDIO_SIZE
            max_size_label = "20MB"
        elif file.content_type in allowed_video_types:
            asset_kind = "video"
            max_size = settings.MAX_VIDEO_SIZE
            max_size_label = "100MB"
        else:
            raise HTTPException(status_code=400, detail="Tipo de archivo no permitido")

        file_ext = file.filename.split(".")[-1].lower()
        unique_filename = f"{uuid.uuid4()}.{file_ext}"
        object_name = f"user-{current_user.id}/library/{unique_filename}"

        file_data = await file.read()
        file_size = len(file_data)

        if file_size > max_size:
            raise HTTPException(status_code=400, detail=f"Archivo demasiado grande (máx {max_size_label})")
        require_storage_quota(db, current_user.effective_tenant_id, file_size)

        minio_client.put_object(
            BUCKET_NAME,
            object_name,
            BytesIO(file_data),
            length=file_size,
            content_type=file.content_type
        )

        # Catalogar la subida en `assets` (tabla ya existente, hasta ahora
        # nunca poblada -- Lote 7). Es la pieza que permite reciclar
        # imagenes/audio/video ya subidos por el tenant en vez de resubirlos
        # (biblioteca, GET /assets abajo). width_px/height_px/duration_seconds
        # quedan en None por ahora -- extraer metadatos del archivo (dimension
        # de imagen, duracion de audio/video) es una mejora futura opcional,
        # no bloqueante para este lote.
        asset_row = Asset(
            tenant_id=current_user.effective_tenant_id,
            kind=asset_kind,
            storage_key=object_name,
            mime_type=file.content_type,
            size_bytes=file_size,
            created_by=current_user.id,
        )
        db.add(asset_row)
        db.commit()

        return {
            "success": True,
            "filename": file.filename,
            "object_name": object_name,
            "url": build_asset_url(object_name),
            "size": file_size,
            "content_type": file.content_type,
            "asset_id": str(asset_row.id)
        }

    except HTTPException:
        # Bug real encontrado durante la verificacion del Lote 3 (audio):
        # el except Exception generico de abajo atrapaba tambien las
        # HTTPException ya deliberadas de arriba (400 tipo no permitido /
        # archivo demasiado grande) y las reenvolvia como 500, ocultando el
        # codigo de estado correcto. Re-lanzar tal cual antes de que el
        # except generico las alcance.
        raise
    except S3Error as e:
        raise HTTPException(status_code=500, detail=f"Error MinIO: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")


@router.get("")
async def list_library_assets(
    kind: Optional[str] = Query(None, description="Filtrar por tipo: image, video o audio"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Biblioteca de assets reciclables del tenant (Lote 7) -- a diferencia de
    /assets/list (legado, lista objetos de MinIO por USUARIO desde el
    editor v1), esto lee la tabla `assets` y es por TENANT: cualquier
    imagen/audio/video subido por cualquier usuario del mismo tenant puede
    reutilizarse sin volver a subir el archivo. Sin paginacion en este MVP
    (limite fijo de 100, orden mas reciente primero) -- si el volumen crece
    lo suficiente para que haga falta, se agrega cursor/paginacion despues.
    """
    query = db.query(Asset).filter(Asset.tenant_id == current_user.effective_tenant_id)
    if kind:
        if kind not in ("image", "video", "audio"):
            raise HTTPException(status_code=400, detail="kind debe ser image, video o audio")
        query = query.filter(Asset.kind == kind)
    rows = query.order_by(desc(Asset.created_at)).limit(100).all()

    return {
        "success": True,
        "count": len(rows),
        "assets": [
            {
                "id": str(row.id),
                "kind": row.kind,
                "url": build_asset_url(row.storage_key),
                "mime_type": row.mime_type,
                "size_bytes": row.size_bytes,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ]
    }


@router.get("/list")
async def list_user_assets(
    current_user: User = Depends(get_current_user)
):
    try:
        prefix = f"user-{current_user.id}/library/"
        objects = minio_client.list_objects(BUCKET_NAME, prefix=prefix, recursive=True)

        assets = []
        for obj in objects:
            assets.append({
                "object_name": obj.object_name,
                "url": build_asset_url(obj.object_name),
                "size": obj.size,
                "last_modified": str(obj.last_modified)
            })

        return {
            "success": True,
            "count": len(assets),
            "assets": assets
        }

    except S3Error as e:
        raise HTTPException(status_code=500, detail=f"Error MinIO: {str(e)}")

# --- VID-2: servicio de objetos con soporte HTTP Range (RFC 9110 §14) ---------
# Safari/iOS exige 206 para reproducir mp4 y permite saltar en la barra de
# progreso; ademas evita transferir el archivo completo si solo se ve un tramo.
_RANGE_RE = re.compile(r"^bytes=(\d{0,15})-(\d{0,15})$")


class _RangeNotSatisfiable(Exception):
    pass


def _parse_byte_range(header: Optional[str], size: int):
    """Devuelve (inicio, fin) inclusivos para un unico tramo valido.

    None  -> sin Range utilizable: se ignora la cabecera y se sirve 200 completo
             (unidad desconocida, multi-rango o sintaxis invalida; lo permite la RFC).
    Lanza _RangeNotSatisfiable -> 416.
    """
    if not header:
        return None
    m = _RANGE_RE.match(header.strip())
    if not m:
        return None
    first, last = m.group(1), m.group(2)
    if first == "" and last == "":
        return None
    if first == "":  # sufijo: ultimos N bytes
        n = int(last)
        if n == 0 or size == 0:
            raise _RangeNotSatisfiable()
        return max(size - n, 0), size - 1
    start = int(first)
    if last == "":
        end = size - 1
    else:
        end = int(last)
        if end < start:
            return None
        end = min(end, size - 1)
    if start >= size:
        raise _RangeNotSatisfiable()
    return start, end


def _etag_matches(header: str, etag: str) -> bool:
    """If-None-Match: comparacion debil (RFC 9110 §8.8.3.2)."""
    if header.strip() == "*":
        return True
    wanted = etag.removeprefix("W/")
    return any(t.strip().removeprefix("W/") == wanted for t in header.split(","))


def _if_range_ok(header: str, etag: str, last_modified: str) -> bool:
    """If-Range: solo valida con ETag fuerte o fecha exacta; si no, se ignora Range."""
    h = header.strip()
    if h.startswith("W/"):
        return False
    if h.startswith('"'):
        return h == etag
    return h == last_modified


def _iter_object(resp, chunk_size: int = 64 * 1024):
    """Genera los bytes y SIEMPRE cierra/libera la conexion con MinIO."""
    try:
        for chunk in resp.stream(chunk_size):
            yield chunk
    finally:
        resp.close()
        resp.release_conn()


@router.api_route("/serve/{object_name:path}", methods=["GET", "HEAD"])
def serve_asset(object_name: str, request: Request):
    """
    Proxy: el backend descarga de MinIO y sirve al navegador (mismo origen,
    sin problemas de CORS para Fabric/Konva). Soporta Range (206/416), HEAD,
    ETag/If-None-Match (304) e If-Range. Es `def` (no async) para que las
    llamadas bloqueantes a MinIO corran en el threadpool y no frenen el loop.
    """
    try:
        st = minio_client.stat_object(BUCKET_NAME, object_name)
    except (S3Error, ValueError) as e:
        if isinstance(e, ValueError) or getattr(e, "code", "") in ("NoSuchKey", "NoSuchBucket", "NoSuchObject"):
            raise HTTPException(status_code=404, detail="Asset no encontrado")
        logger.error("serve_asset stat %s: %s", object_name, e)
        raise HTTPException(status_code=502, detail="Almacenamiento no disponible")

    size = int(st.size or 0)
    raw_etag = (st.etag or "").strip('"')
    etag = f'"{raw_etag}"' if raw_etag else ""
    last_modified = format_datetime(st.last_modified, usegmt=True) if st.last_modified else ""
    content_type = st.content_type or "image/jpeg"

    # Las portadas renderizadas (L7a) llevan el id de version en la clave: nunca cambian.
    immutable = "/covers/" in object_name
    validators = {"Accept-Ranges": "bytes",
                  "Cache-Control": "public, max-age=31536000, immutable" if immutable else "no-cache"}
    if etag:
        validators["ETag"] = etag
    if last_modified:
        validators["Last-Modified"] = last_modified

    # Precondicion antes que Range (RFC 9110 §13.2.2)
    inm = request.headers.get("if-none-match")
    if inm and etag and _etag_matches(inm, etag):
        return Response(status_code=304, headers=validators)

    range_header = request.headers.get("range")
    if range_header:
        if_range = request.headers.get("if-range")
        if if_range and not _if_range_ok(if_range, etag, last_modified):
            range_header = None  # el recurso cambio: se sirve completo
    try:
        rng = _parse_byte_range(range_header, size)
    except _RangeNotSatisfiable:
        return Response(status_code=416, headers={**validators, "Content-Range": f"bytes */{size}"})

    if rng is None:
        status, start, length = 200, 0, size
        headers = {**validators, "Content-Length": str(size)}
    else:
        start, end = rng
        length = end - start + 1
        status = 206
        headers = {**validators, "Content-Length": str(length),
                   "Content-Range": f"bytes {start}-{end}/{size}"}

    if request.method == "HEAD" or length == 0:
        return Response(status_code=status, headers={**headers, "Content-Type": content_type})

    try:
        # If-Match: si el objeto se reemplazo entre stat y get (misma clave), no mezclar bytes
        resp = minio_client.get_object(
            BUCKET_NAME, object_name,
            offset=start, length=(length if status == 206 else 0),
            request_headers=({"If-Match": etag} if etag else None))
    except S3Error as e:
        if e.code in ("NoSuchKey", "NoSuchObject"):
            raise HTTPException(status_code=404, detail="Asset no encontrado")
        if e.code == "PreconditionFailed":
            raise HTTPException(status_code=503, detail="Recurso actualizandose, reintenta",
                                headers={"Retry-After": "1"})
        logger.error("serve_asset get %s: %s", object_name, e)
        raise HTTPException(status_code=502, detail="Almacenamiento no disponible")

    return StreamingResponse(_iter_object(resp), status_code=status,
                             media_type=content_type, headers=headers)
