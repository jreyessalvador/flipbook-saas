from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, Query
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

from app.db.session import get_db
from app.api.auth import get_current_user
from app.models.user import User
from app.models.asset import Asset
from app.config import settings

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
    current_user: User = Depends(get_current_user)
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
            tenant_id=current_user.tenant_id,
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
    query = db.query(Asset).filter(Asset.tenant_id == current_user.tenant_id)
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

@router.get("/serve/{object_name:path}")
async def serve_asset(
    object_name: str
):

    """
    Proxy: el backend descarga de MinIO y sirve al navegador.
    Fabric.js puede cargar la imagen sin problemas de CORS.
    """
    try:
        response = minio_client.get_object(BUCKET_NAME, object_name)
        content_type = response.headers.get("Content-Type", "image/jpeg")

        def stream():
            for chunk in response.stream(32 * 1024):
                yield chunk

        return StreamingResponse(stream(), media_type=content_type)

    except S3Error as e:
        raise HTTPException(status_code=404, detail="Asset no encontrado")
