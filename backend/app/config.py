from pydantic_settings import BaseSettings
from typing import List
import os

class Settings(BaseSettings):
    # App
    APP_NAME: str = "Cetrix Revistas"
    DEBUG: bool = False
    API_VERSION: str = "v1"
    
    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://flipbook:password@postgresql:5432/flipbook")
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    
    # Redis
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://redis:6379/0")
    
    # MinIO (S3)
    MINIO_ENDPOINT: str = os.getenv("MINIO_ENDPOINT", "minio:9000")
    MINIO_ACCESS_KEY: str = os.getenv("MINIO_ACCESS_KEY", "admin")
    MINIO_SECRET_KEY: str = os.getenv("MINIO_SECRET_KEY", "password")
    MINIO_SECURE: bool = False
    MINIO_BUCKET_PREFIX: str = "tenant-"
    
    # JWT
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "change-this-secret-key-in-production")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    
    # CORS -- configurable por entorno via variable CORS_ORIGINS (coma-separada).
    # Antes main.py ignoraba esto y traia una lista hardcodeada (incluia un
    # dominio/IP de produccion) -- roto para cualquier otro entorno (p.ej. el
    # de desarrollo en ia-lavatur, accesible solo por Tailscale). Se deja aqui
    # el default de produccion conocido + localhost para no romper nada, y se
    # añaden los origenes de cada entorno de desarrollo via .env.
    CORS_ORIGINS_RAW: str = os.getenv(
        "CORS_ORIGINS",
        "http://flipbook.local,http://192.168.2.12,http://localhost:5173,http://localhost:3000",
    )

    @property
    def CORS_ORIGINS(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS_RAW.split(",") if o.strip()]
    
    # Upload limits (bytes)
    MAX_IMAGE_SIZE: int = 10 * 1024 * 1024  # 10MB
    MAX_VIDEO_SIZE: int = 100 * 1024 * 1024  # 100MB
    MAX_AUDIO_SIZE: int = 20 * 1024 * 1024  # 20MB
    # DOC-1 (11-oct-2026): 100 MB. Se puede subir el limite porque ya no se
    # guarda el PDF bruto: docproc lo sustituye por la version optimizada.
    MAX_PDF_SIZE: int = int(os.getenv("MAX_PDF_SIZE", str(100 * 1024 * 1024)))
    MAX_PDF_PAGES: int = int(os.getenv("MAX_PDF_PAGES", "500") or 500)
    
    # Celery
    # Cola dedicada: un procesamiento pesado nunca comparte el Redis operativo.
    CELERY_BROKER_URL: str = os.getenv("PDF_QUEUE_URL", "redis://pdf-queue:6379/0")
    CELERY_RESULT_BACKEND: str = os.getenv("PDF_QUEUE_URL", "redis://pdf-queue:6379/0")
    
    # Correo saliente (Lote L9, 29-sep-2026). SMTP generico: hoy buzon
    # no-reply@cetrix.com.mx de IONOS (smtp.ionos.mx:587 STARTTLS); cambiar a
    # Resend u otro proveedor es solo cambiar estas variables en .env.
    # La contraseña NUNCA va en el repo: solo en el .env del servidor.
    SMTP_HOST: str = os.getenv("SMTP_HOST", "")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587") or 587)
    SMTP_USER: str = os.getenv("SMTP_USER", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    SMTP_SECURITY: str = os.getenv("SMTP_SECURITY", "starttls")  # starttls | ssl | none
    SMTP_TIMEOUT: int = int(os.getenv("SMTP_TIMEOUT", "20") or 20)
    MAIL_FROM: str = os.getenv("MAIL_FROM", "")
    MAIL_REPLY_TO: str = os.getenv("MAIL_REPLY_TO", "")
    # true = no envia: escribe el correo en el log (DEV / pruebas).
    MAIL_DRY_RUN: bool = os.getenv("MAIL_DRY_RUN", "false").lower() in ("1", "true", "yes")
    # URL publica base para los enlaces de los correos (sin barra final).
    APP_PUBLIC_URL: str = os.getenv("APP_PUBLIC_URL", "")

    # Lote F: worker de render (Contabo 2) via tunel wg-flipbook + gateway nginx.
    # Sin token configurado los endpoints internos responden 404 (desactivados).
    RENDER_WORKER_TOKEN: str = os.getenv("RENDER_WORKER_TOKEN", "")
    # IP que el gateway escribe en X-Real-IP (el nginx publico la sobrescribe con
    # la IP real del cliente, asi que no se puede falsificar desde internet).
    RENDER_GATEWAY_CLIENT_IP: str = os.getenv("RENDER_GATEWAY_CLIENT_IP", "10.253.43.2")
    RENDER_MAX_ACTIVE_PER_TENANT: int = int(os.getenv("RENDER_MAX_ACTIVE_PER_TENANT", "3") or 3)
    RENDER_MAX_PDF_BYTES: int = int(os.getenv("RENDER_MAX_PDF_BYTES", str(400 * 1024 * 1024)))

    # DOC-1 (11-oct-2026): servicio compartido cetrix-docproc (RECETA §31).
    # Broker en Contabo 1 (red docker docproc-c-flipbook-<entorno>), worker
    # aislado en Contabo 2. El token va SOLO en el .env del servidor.
    DOCPROC_URL: str = os.getenv("DOCPROC_URL", "")
    DOCPROC_CLIENT: str = os.getenv("DOCPROC_CLIENT", "")
    DOCPROC_TOKEN: str = os.getenv("DOCPROC_TOKEN", "")
    DOCPROC_PDF_PROFILE: str = os.getenv("DOCPROC_PDF_PROFILE", "ebook")  # web | ebook | print
    DOCPROC_PAGE_DPI: int = int(os.getenv("DOCPROC_PAGE_DPI", "144") or 144)
    DOCPROC_PAGE_QUALITY: int = int(os.getenv("DOCPROC_PAGE_QUALITY", "82") or 82)

    class Config:
        env_file = ".env"
        case_sensitive = True

settings = Settings()
