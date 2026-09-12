from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from fastapi.responses import StreamingResponse
from typing import List
from sqlalchemy.orm import Session
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
        allowed_types = ["image/jpeg", "image/png", "image/gif", "image/webp"]
        if file.content_type not in allowed_types:
            raise HTTPException(status_code=400, detail="Tipo de archivo no permitido")

        file_ext = file.filename.split(".")[-1].lower()
        unique_filename = f"{uuid.uuid4()}.{file_ext}"
        object_name = f"user-{current_user.id}/library/{unique_filename}"

        file_data = await file.read()
        file_size = len(file_data)

        if file_size > settings.MAX_IMAGE_SIZE:
            raise HTTPException(status_code=400, detail="Archivo demasiado grande (máx 10MB)")

        minio_client.put_object(
            BUCKET_NAME,
            object_name,
            BytesIO(file_data),
            length=file_size,
            content_type=file.content_type
        )

        return {
            "success": True,
            "filename": file.filename,
            "object_name": object_name,
            "url": build_asset_url(object_name),
            "size": file_size,
            "content_type": file.content_type
        }

    except S3Error as e:
        raise HTTPException(status_code=500, detail=f"Error MinIO: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")


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
